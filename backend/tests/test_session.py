import pytest
from fastapi.testclient import TestClient
from backend.app.main import app
from backend.app.services.session_manager import session_manager

@pytest.fixture(autouse=True)
def clean_sessions():
    session_manager.sessions.clear()
    yield
    session_manager.sessions.clear()

@pytest.fixture
def client():
    return TestClient(app)

def test_session_lifecycle(client):
    # 1. Create a session (Host / Operator)
    create_resp = client.post("/api/session/create", json={"name": "Operator Alpha", "role": "operator"})
    assert create_resp.status_code == 200
    create_data = create_resp.json()
    session_id = create_data["sessionId"]
    host_client_id = create_data["clientId"]
    assert session_id.startswith("RR-")
    assert create_data["role"] == "operator"
    assert create_data["hostRole"] == "operator"

    # 2. Check session info
    info_resp = client.get(f"/api/session/{session_id}")
    assert info_resp.status_code == 200
    info_data = info_resp.json()
    assert info_data["sessionId"] == session_id
    assert len(info_data["participants"]) == 1
    assert info_data["participants"][0]["clientId"] == host_client_id
    assert info_data["participants"][0]["isHost"] is True

    # 3. Join the session as Scenario Controller (Device B)
    join_resp = client.post("/api/session/join", json={"sessionId": session_id, "name": "Controller Beta", "role": "controller"})
    assert join_resp.status_code == 200
    join_data = join_resp.json()
    controller_client_id = join_data["clientId"]
    assert join_data["role"] == "controller"
    assert join_data["sessionId"] == session_id
    assert "sessionInfo" in join_data
    assert "participants" in join_data

    # 4. Check updated session participants
    info_resp2 = client.get(f"/api/session/{session_id}")
    assert info_resp2.status_code == 200
    participants = info_resp2.json()["participants"]
    assert len(participants) == 2
    roles = {p["role"] for p in participants}
    assert "operator" in roles
    assert "controller" in roles

    # 5. Snapshot retrieval
    snap_resp = client.get(f"/api/session/{session_id}/snapshot")
    assert snap_resp.status_code == 200
    snap = snap_resp.json()
    assert snap["sessionId"] == session_id
    assert "robotPose" in snap
    assert "navState" in snap

def test_session_websocket_synchronization(client):
    # Create room
    create_resp = client.post("/api/session/create", json={"name": "Operator DevA", "role": "operator"})
    session_id = create_resp.json()["sessionId"]
    op_client_id = create_resp.json()["clientId"]

    # Join room as Controller
    join_resp = client.post("/api/session/join", json={"sessionId": session_id, "name": "Controller DevB", "role": "controller"})
    ctrl_client_id = join_resp.json()["clientId"]

    # Connect both via WebSocket
    with client.websocket_connect(f"/ws/session/{session_id}/{op_client_id}") as op_ws:
        # Operator receives session_welcome
        op_welcome = op_ws.receive_json()
        assert op_welcome["type"] == "session_welcome"
        assert op_welcome["sessionId"] == session_id

        with client.websocket_connect(f"/ws/session/{session_id}/{ctrl_client_id}") as ctrl_ws:
            # Controller receives session_welcome
            ctrl_welcome = ctrl_ws.receive_json()
            assert ctrl_welcome["type"] == "session_welcome"

            # Operator receives peer_joined notification
            peer_joined = op_ws.receive_json()
            assert peer_joined["type"] == "peer_joined"
            assert peer_joined["clientId"] == ctrl_client_id

            # Test A: Controller injects a box obstacle
            box_obj = {
                "id": "box-test-1",
                "type": "cube",
                "position": [-14.5, 0.4, -7.5],
                "size": 0.8,
                "name": "Test Cargo Box",
            }
            ctrl_ws.send_json({
                "type": "spawn_object",
                "sessionId": session_id,
                "clientId": ctrl_client_id,
                "role": "controller",
                "timestamp": 123456789,
                "payload": {"object": box_obj},
            })

            # Both receive spawn_object broadcast
            op_spawn = op_ws.receive_json()
            assert op_spawn["type"] == "spawn_object"
            assert op_spawn["payload"]["object"]["id"] == "box-test-1"

            ctrl_spawn = ctrl_ws.receive_json()
            assert ctrl_spawn["type"] == "spawn_object"
            assert ctrl_spawn["payload"]["object"]["id"] == "box-test-1"

            # Test B: Operator streams simulation telemetry (e.g. robot pose)
            telemetry_payload = {
                "robotPose": {"position": [-14.0, 0.22, -9.0], "rotation": 0.5, "linearVelocity": 1.2, "angularVelocity": 0.1},
                "navState": "MOVING",
                "missionMetrics": {"distanceTravelled": 2.5, "missionStatus": "running"},
            }
            op_ws.send_json({
                "type": "sim_telemetry",
                "sessionId": session_id,
                "clientId": op_client_id,
                "role": "operator",
                "timestamp": 123456790,
                "payload": telemetry_payload,
            })

            # Controller receives telemetry
            ctrl_telem = ctrl_ws.receive_json()
            assert ctrl_telem["type"] == "sim_telemetry"
            assert ctrl_telem["payload"]["navState"] == "MOVING"
            assert ctrl_telem["payload"]["robotPose"]["position"] == [-14.0, 0.22, -9.0]

            # Test C: Security / Permission Denial Test
            # Controller tries to send forbidden 'robot_teleop'
            ctrl_ws.send_json({
                "type": "robot_teleop",
                "sessionId": session_id,
                "clientId": ctrl_client_id,
                "role": "controller",
                "timestamp": 123456791,
                "payload": {"linear": 2.0, "angular": 1.0},
            })

            # Controller receives permission_denied rejection
            denial = ctrl_ws.receive_json()
            assert denial["type"] == "permission_denied"
            assert "not authorized" in denial["payload"]["reason"].lower()

def test_session_join_not_found(client):
    join_resp = client.post("/api/session/join", json={"sessionId": "RR-NONEXIST", "name": "Spy", "role": "controller"})
    assert join_resp.status_code == 404
    assert "not found" in join_resp.json()["detail"].lower()
