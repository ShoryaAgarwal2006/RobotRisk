import time
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


def test_test_a_robot_movement_synchronization(client):
    """
    Test A: Robot movement synchronization
    Host moves the robot (telemetry/pose updates) -> Controller receives and updates its robot pose.
    """
    create_res = client.post("/api/session/create", json={"name": "Host Operator", "role": "operator"})
    sid = create_res.json()["sessionId"]
    cid_a = create_res.json()["clientId"]

    join_res = client.post("/api/session/join", json={"sessionId": sid, "name": "Scenario Controller", "role": "controller"})
    cid_b = join_res.json()["clientId"]

    with client.websocket_connect(f"/ws/session/{sid}/{cid_a}") as ws_a:
        ws_a.receive_json()  # welcome
        with client.websocket_connect(f"/ws/session/{sid}/{cid_b}") as ws_b:
            ws_b.receive_json()  # welcome
            ws_a.receive_json()  # peer_joined

            # Host moves robot
            movement_telemetry = {
                "robotPose": {
                    "position": [-7.5, 0.22, 3.4],
                    "rotation": 1.57,
                    "linearVelocity": 1.8,
                    "angularVelocity": 0.12,
                },
                "navState": "MOVING",
                "plannedPath": [[-14.5, -10.5], [-7.5, 3.4], [14.0, 10.5]],
                "currentWaypointIndex": 1,
                "sensorData": {
                    "forwardDist": 4.8,
                    "leftDist": 2.5,
                    "rightDist": 2.5,
                    "riskLevel": "clear",
                },
            }
            ws_a.send_json({
                "type": "sim_telemetry",
                "sessionId": sid,
                "clientId": cid_a,
                "role": "operator",
                "payload": movement_telemetry,
            })

            # Controller receives the real-time pose update
            ctrl_msg = ws_b.receive_json()
            assert ctrl_msg["type"] == "sim_telemetry"
            assert ctrl_msg["payload"]["robotPose"]["position"] == [-7.5, 0.22, 3.4]
            assert ctrl_msg["payload"]["robotPose"]["linearVelocity"] == 1.8
            assert ctrl_msg["payload"]["navState"] == "MOVING"

            # Host rotates robot (Test B: Rotation synchronization)
            ws_a.send_json({
                "type": "sim_telemetry",
                "sessionId": sid,
                "clientId": cid_a,
                "role": "operator",
                "payload": {
                    "robotPose": {
                        "position": [-7.5, 0.22, 3.4],
                        "rotation": 1.5708,
                        "linearVelocity": 0.5,
                        "angularVelocity": 1.2,
                    },
                    "navState": "MOVING",
                },
            })
            rot_msg = ws_b.receive_json()
            assert rot_msg["payload"]["robotPose"]["rotation"] == 1.5708
            assert rot_msg["payload"]["robotPose"]["angularVelocity"] == 1.2

            # Host stops robot (Test C: Stop synchronization)
            ws_a.send_json({
                "type": "sim_telemetry",
                "sessionId": sid,
                "clientId": cid_a,
                "role": "operator",
                "payload": {
                    "robotPose": {
                        "position": [-7.5, 0.22, 3.4],
                        "rotation": 1.5708,
                        "linearVelocity": 0.0,
                        "angularVelocity": 0.0,
                    },
                    "navState": "IDLE",
                },
            })
            stop_msg = ws_b.receive_json()
            assert stop_msg["payload"]["robotPose"]["linearVelocity"] == 0.0
            assert stop_msg["payload"]["robotPose"]["angularVelocity"] == 0.0
            assert stop_msg["payload"]["navState"] == "IDLE"


def test_test_b_obstacle_injection_during_movement(client):
    """
    Test B: Obstacle injection during movement
    Host navigates -> Controller spawns obstacle -> Both share obstacle and Host detects it in sensor scan.
    """
    create_res = client.post("/api/session/create", json={"name": "Host Operator", "role": "operator"})
    sid = create_res.json()["sessionId"]
    cid_a = create_res.json()["clientId"]

    join_res = client.post("/api/session/join", json={"sessionId": sid, "name": "Scenario Controller", "role": "controller"})
    cid_b = join_res.json()["clientId"]

    with client.websocket_connect(f"/ws/session/{sid}/{cid_a}") as ws_a:
        ws_a.receive_json()
        with client.websocket_connect(f"/ws/session/{sid}/{cid_b}") as ws_b:
            ws_b.receive_json()
            ws_a.receive_json()

            # Controller injects obstacle directly ahead of robot
            obstacle = {
                "id": "box-moving-test-1",
                "type": "cube",
                "position": [-7.5, 0.4, 5.5],
                "size": 0.8,
                "name": "Live Hazardous Box",
            }
            ws_b.send_json({
                "type": "spawn_object",
                "sessionId": sid,
                "clientId": cid_b,
                "role": "controller",
                "payload": {"object": obstacle},
            })

            # Both devices receive the obstacle
            spawn_a = ws_a.receive_json()
            assert spawn_a["type"] == "spawn_object"
            assert spawn_a["payload"]["object"]["id"] == "box-moving-test-1"

            spawn_b = ws_b.receive_json()
            assert spawn_b["type"] == "spawn_object"
            assert spawn_b["payload"]["object"]["id"] == "box-moving-test-1"

            # Host streams telemetry showing LiDAR has registered the new obstacle
            ws_a.send_json({
                "type": "sim_telemetry",
                "sessionId": sid,
                "clientId": cid_a,
                "role": "operator",
                "payload": {
                    "robotPose": {"position": [-7.5, 0.22, 3.5], "rotation": 1.57, "linearVelocity": 0.8},
                    "sensorData": {
                        "forwardDist": 2.0,
                        "riskLevel": "warning",
                        "closestObstacle": "Live Hazardous Box",
                    },
                },
            })

            telem_b = ws_b.receive_json()
            assert telem_b["payload"]["sensorData"]["closestObstacle"] == "Live Hazardous Box"
            assert telem_b["payload"]["sensorData"]["riskLevel"] == "warning"


def test_test_c_predefined_challenges(client):
    """
    Test C: Predefined challenges
    Controller triggers challenge while robot is moving -> Both receive obstacles and Host reacts.
    """
    create_res = client.post("/api/session/create", json={"name": "Host Operator", "role": "operator"})
    sid = create_res.json()["sessionId"]
    cid_a = create_res.json()["clientId"]

    join_res = client.post("/api/session/join", json={"sessionId": sid, "name": "Scenario Controller", "role": "controller"})
    cid_b = join_res.json()["clientId"]

    with client.websocket_connect(f"/ws/session/{sid}/{cid_a}") as ws_a:
        ws_a.receive_json()
        with client.websocket_connect(f"/ws/session/{sid}/{cid_b}") as ws_b:
            ws_b.receive_json()
            ws_a.receive_json()

            # Controller triggers falling_box challenge
            ws_b.send_json({
                "type": "trigger_challenge",
                "sessionId": sid,
                "clientId": cid_b,
                "role": "controller",
                "payload": {"challengeId": "falling_box", "challengeName": "Falling Payload Box"},
            })

            ch_a = ws_a.receive_json()
            assert ch_a["type"] == "trigger_challenge"
            assert ch_a["payload"]["challengeId"] == "falling_box"
            assert len(ch_a["payload"]["interactiveObjects"]) > 0

            ch_b = ws_b.receive_json()
            assert ch_b["type"] == "trigger_challenge"
            assert ch_b["payload"]["challengeId"] == "falling_box"


def test_test_d_ai_command_center_scenario_creation(client):
    """
    Test D: AI Command Center scenario creation
    Controller sends natural language scenario -> Both devices receive environment modifications.
    """
    create_res = client.post("/api/session/create", json={"name": "Host Operator", "role": "operator"})
    sid = create_res.json()["sessionId"]
    cid_a = create_res.json()["clientId"]

    join_res = client.post("/api/session/join", json={"sessionId": sid, "name": "Scenario Controller", "role": "controller"})
    cid_b = join_res.json()["clientId"]

    with client.websocket_connect(f"/ws/session/{sid}/{cid_a}") as ws_a:
        ws_a.receive_json()
        with client.websocket_connect(f"/ws/session/{sid}/{cid_b}") as ws_b:
            ws_b.receive_json()
            ws_a.receive_json()

            # Controller executes an approved AI scenario (e.g. Block Aisle 2)
            ws_b.send_json({
                "type": "block_aisle",
                "sessionId": sid,
                "clientId": cid_b,
                "role": "controller",
                "payload": {"aisleId": "aisle-2", "aisleName": "Aisle 2 Center Crossing"},
            })

            b_a = ws_a.receive_json()
            assert b_a["type"] == "block_aisle"
            assert b_a["payload"]["aisleId"] == "aisle-2"

            b_b = ws_b.receive_json()
            assert b_b["type"] == "block_aisle"

            # Controller sends scenario notification
            ws_b.send_json({
                "type": "ai_command_executed",
                "sessionId": sid,
                "clientId": cid_b,
                "role": "controller",
                "payload": {"intent": "Barricaded aisle 2 and spawned obstacle"},
            })

            ai_a = ws_a.receive_json()
            assert ai_a["type"] == "ai_command_executed"
            assert "Barricaded aisle 2" in ai_a["payload"]["intent"]


def test_test_e_role_permission_enforcement(client):
    """
    Test E: Role permission enforcement
    Controller attempts manual movement or E-Stop -> Backend rejects with permission_denied.
    """
    create_res = client.post("/api/session/create", json={"name": "Host Operator", "role": "operator"})
    sid = create_res.json()["sessionId"]
    cid_a = create_res.json()["clientId"]

    join_res = client.post("/api/session/join", json={"sessionId": sid, "name": "Scenario Controller", "role": "controller"})
    cid_b = join_res.json()["clientId"]

    with client.websocket_connect(f"/ws/session/{sid}/{cid_a}") as ws_a:
        ws_a.receive_json()
        with client.websocket_connect(f"/ws/session/{sid}/{cid_b}") as ws_b:
            ws_b.receive_json()
            ws_a.receive_json()

            # Controller attempts manual teleoperation
            ws_b.send_json({
                "type": "robot_teleop",
                "sessionId": sid,
                "clientId": cid_b,
                "role": "controller",
                "payload": {"throttle": 1.0, "steering": 0.5},
            })

            denied_teleop = ws_b.receive_json()
            assert denied_teleop["type"] == "permission_denied"
            assert denied_teleop["payload"]["action"] == "robot_teleop"

            # Controller attempts emergency stop
            ws_b.send_json({
                "type": "emergency_stop",
                "sessionId": sid,
                "clientId": cid_b,
                "role": "controller",
                "payload": {"isEmergencyStopped": True},
            })

            denied_estop = ws_b.receive_json()
            assert denied_estop["type"] == "permission_denied"
            assert denied_estop["payload"]["action"] == "emergency_stop"

            # Controller attempts reset_pose
            ws_b.send_json({
                "type": "reset_pose",
                "sessionId": sid,
                "clientId": cid_b,
                "role": "controller",
                "payload": {},
            })

            denied_reset = ws_b.receive_json()
            assert denied_reset["type"] == "permission_denied"
            assert denied_reset["payload"]["action"] == "reset_pose"


def test_test_f_disconnection_and_reconnection(client):
    """
    Test F: Disconnection and reconnection
    Controller disconnects and reconnects -> Receives current snapshot with all active objects.
    """
    create_res = client.post("/api/session/create", json={"name": "Host Operator", "role": "operator"})
    sid = create_res.json()["sessionId"]
    cid_a = create_res.json()["clientId"]

    join_res = client.post("/api/session/join", json={"sessionId": sid, "name": "Scenario Controller", "role": "controller"})
    cid_b = join_res.json()["clientId"]

    # 1. First connection: inject an obstacle and barricade
    with client.websocket_connect(f"/ws/session/{sid}/{cid_a}") as ws_a:
        ws_a.receive_json()
        with client.websocket_connect(f"/ws/session/{sid}/{cid_b}") as ws_b:
            ws_b.receive_json()
            ws_a.receive_json()

            ws_b.send_json({
                "type": "spawn_object",
                "sessionId": sid,
                "clientId": cid_b,
                "role": "controller",
                "payload": {
                    "object": {
                        "id": "persist-box-1",
                        "type": "cube",
                        "position": [1.0, 0.4, 2.0],
                        "name": "Persistent Box",
                    }
                },
            })
            ws_a.receive_json()
            ws_b.receive_json()

            ws_b.send_json({
                "type": "block_aisle",
                "sessionId": sid,
                "clientId": cid_b,
                "role": "controller",
                "payload": {"aisleId": "aisle-2", "aisleName": "Aisle 2"},
            })
            ws_a.receive_json()
            ws_b.receive_json()

        # Controller ws_b disconnected here
        peer_left = ws_a.receive_json()
        assert peer_left["type"] == "peer_left"

        # 2. Controller reconnects!
        with client.websocket_connect(f"/ws/session/{sid}/{cid_b}") as ws_b_new:
            welcome_new = ws_b_new.receive_json()
            assert welcome_new["type"] == "session_welcome"
            snap = welcome_new["payload"]["snapshot"]
            assert any(o["id"] == "persist-box-1" for o in snap["interactiveObjects"])
            assert any(b["aisleId"] == "aisle-2" for b in snap["activeBarriers"])


def test_test_g_simulation_clock_sync(client):
    """
    Test G: Simulation clock sync
    Pause and resume -> Both reflect simulation status.
    """
    create_res = client.post("/api/session/create", json={"name": "Host Operator", "role": "operator"})
    sid = create_res.json()["sessionId"]
    cid_a = create_res.json()["clientId"]

    join_res = client.post("/api/session/join", json={"sessionId": sid, "name": "Scenario Controller", "role": "controller"})
    cid_b = join_res.json()["clientId"]

    with client.websocket_connect(f"/ws/session/{sid}/{cid_a}") as ws_a:
        ws_a.receive_json()
        with client.websocket_connect(f"/ws/session/{sid}/{cid_b}") as ws_b:
            ws_b.receive_json()
            ws_a.receive_json()

            # Controller pauses simulation
            ws_b.send_json({
                "type": "set_clock_state",
                "sessionId": sid,
                "clientId": cid_b,
                "role": "controller",
                "payload": {"isRunning": False},
            })

            pause_a = ws_a.receive_json()
            assert pause_a["type"] == "set_clock_state"
            assert pause_a["payload"]["isRunning"] is False

            pause_b = ws_b.receive_json()
            assert pause_b["type"] == "set_clock_state"
            assert pause_b["payload"]["isRunning"] is False

            # Operator resumes simulation
            ws_a.send_json({
                "type": "set_clock_state",
                "sessionId": sid,
                "clientId": cid_a,
                "role": "operator",
                "payload": {"isRunning": True},
            })

            run_a = ws_a.receive_json()
            assert run_a["payload"]["isRunning"] is True

            run_b = ws_b.receive_json()
            assert run_b["payload"]["isRunning"] is True
