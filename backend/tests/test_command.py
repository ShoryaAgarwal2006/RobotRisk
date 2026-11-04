import pytest
from fastapi.testclient import TestClient
from backend.app.main import app

client = TestClient(app)

def test_parse_place_box_ahead():
    payload = {
        "prompt": "Place a box three metres ahead of the robot.",
        "context": {
            "robot_position": [-14.5, 0.22, -10.5],
            "robot_yaw": 0.0,
        }
    }
    response = client.post("/api/command/parse", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["action"] == "spawn_obstacle"
    assert data["requires_approval"] is True
    assert data["parameters"]["relativeToRobot"]["distanceAhead"] == 3.0
    assert data["parameters"]["position"][0] == -14.5
    assert data["parameters"]["position"][2] == -7.5

def test_parse_block_aisle_two():
    payload = {
        "prompt": "Block the entire second aisle."
    }
    response = client.post("/api/command/parse", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["action"] == "block_aisle"
    assert data["parameters"]["aisleId"] == "aisle-2"
    assert data["requires_approval"] is True

def test_parse_unblock_aisle():
    payload = {
        "prompt": "Remove the aisle blockage."
    }
    response = client.post("/api/command/parse", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["action"] == "unblock_aisle"
    assert data["requires_approval"] is True

def test_parse_pause_and_resume():
    res_pause = client.post("/api/command/parse", json={"prompt": "Pause the simulation."})
    assert res_pause.status_code == 200
    assert res_pause.json()["action"] == "set_simulation_state"
    assert res_pause.json()["parameters"]["simulationRunning"] is False

    res_resume = client.post("/api/command/parse", json={"prompt": "Resume the simulation."})
    assert res_resume.status_code == 200
    assert res_resume.json()["action"] == "set_simulation_state"
    assert res_resume.json()["parameters"]["simulationRunning"] is True

def test_parse_explain_why_stopped():
    payload = {
        "prompt": "Explain why the robot stopped.",
        "context": {
            "is_running": True,
            "closest_obstacle": "User Cargo Box",
            "forward_clearance": 0.82,
            "risk_level": "critical",
            "stopping_distance": 0.52,
            "braking_status": "emergency_braking",
            "obstacle_position": [-14.5, -8.0],
        }
    }
    response = client.post("/api/command/parse", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["action"] == "query_explanation"
    assert data["requires_approval"] is False
    assert "User Cargo Box" in data["direct_response"]
    assert "0.82m" in data["direct_response"]
    assert "CRITICAL" in data["direct_response"]

def test_parse_crowded_warehouse():
    payload = {
        "prompt": "Create a crowded warehouse with five moving workers."
    }
    response = client.post("/api/command/parse", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["action"] == "spawn_workers"
    assert data["parameters"]["count"] == 5
    assert data["requires_approval"] is True

def test_parse_extreme_difficulty():
    payload = {
        "prompt": "Make the simulation extremely difficult."
    }
    response = client.post("/api/command/parse", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["action"] == "set_difficulty"
    assert data["parameters"]["difficulty"] == "extreme"
    assert data["requires_approval"] is True


# ==========================================
# PHASE 3: NATURAL LANGUAGE ORCHESTRATION TESTS
# ==========================================

def test_parse_synonyms_difficulty_extreme():
    test_prompts = [
        "Make it tough.",
        "Increase the difficulty.",
        "Give the robot a really challenging mission.",
        "Put it in extreme mode.",
        "Make the warehouse extreme.",
    ]
    for prompt in test_prompts:
        res = client.post("/api/command/parse", json={"prompt": prompt})
        assert res.status_code == 200, f"Failed on prompt: {prompt}"
        data = res.json()
        assert data["action"] == "set_difficulty", f"Failed on {prompt}: got {data['action']}"
        assert data["parameters"]["difficulty"] == "extreme", f"Failed on {prompt}: got {data['parameters']['difficulty']}"
        assert data["requires_approval"] is True

def test_parse_synonyms_spawn_obstacle():
    test_prompts = [
        "Put a box in front of the robot.",
        "Drop something three metres ahead.",
        "Create an obstacle in its path.",
    ]
    for prompt in test_prompts:
        res = client.post("/api/command/parse", json={"prompt": prompt, "context": {"robot_position": [0, 0.22, 0]}})
        assert res.status_code == 200, f"Failed on prompt: {prompt}"
        data = res.json()
        assert data["action"] == "spawn_obstacle", f"Failed on {prompt}: got {data['action']}"
        assert data["requires_approval"] is True
        assert data["parameters"]["position"] is not None

def test_parse_synonyms_block_aisle_two():
    test_prompts = [
        "Block the second aisle.",
        "Close aisle two.",
        "Make aisle two inaccessible.",
        "Barricade aisle 2.",
    ]
    for prompt in test_prompts:
        res = client.post("/api/command/parse", json={"prompt": prompt})
        assert res.status_code == 200, f"Failed on prompt: {prompt}"
        data = res.json()
        assert data["action"] == "block_aisle", f"Failed on {prompt}: got {data['action']}"
        assert data["parameters"]["aisleId"] == "aisle-2", f"Failed on {prompt}: got {data['parameters']['aisleId']}"
        assert data["requires_approval"] is True

def test_parse_multi_intent_tough_and_shortest_path():
    """
    User: 'Make it tough and take it through the shortest path.'
    Expected:
      Action 1: set_difficulty(EXTREME)
      Action 2: start_mission with shortest safe route preference
    """
    payload = {
        "prompt": "Make it tough and take it through the shortest path."
    }
    res = client.post("/api/command/parse", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert data["is_multi_intent"] is True
    assert len(data["sub_actions"]) == 2
    assert data["requires_approval"] is True

    # Action 1: set_difficulty extreme
    act1 = data["sub_actions"][0]
    assert act1["action"] == "set_difficulty"
    assert act1["parameters"]["difficulty"] == "extreme"

    # Action 2: start_mission shortest_safe_path
    act2 = data["sub_actions"][1]
    assert act2["action"] == "start_mission"
    assert act2["parameters"]["navigationPreference"] == "shortest_safe_path"

def test_parse_multi_intent_three_actions():
    """
    User: 'Create a crowded warehouse, block aisle two and start the robot.'
    Expected:
      Action 1: spawn_workers (5 workers)
      Action 2: block_aisle (aisle-2)
      Action 3: start_mission
    """
    payload = {
        "prompt": "Create a crowded warehouse, block aisle two and start the robot."
    }
    res = client.post("/api/command/parse", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert data["is_multi_intent"] is True
    assert len(data["sub_actions"]) == 3
    assert data["requires_approval"] is True

    assert data["sub_actions"][0]["action"] == "spawn_workers"
    assert data["sub_actions"][0]["parameters"]["count"] == 5

    assert data["sub_actions"][1]["action"] == "block_aisle"
    assert data["sub_actions"][1]["parameters"]["aisleId"] == "aisle-2"

    assert data["sub_actions"][2]["action"] == "start_mission"

def test_parse_navigation_preferences():
    res1 = client.post("/api/command/parse", json={"prompt": "Take the shortest path."})
    assert res1.status_code == 200
    assert res1.json()["action"] == "start_mission"
    assert res1.json()["parameters"]["navigationPreference"] == "shortest_safe_path"

    res2 = client.post("/api/command/parse", json={"prompt": "Use the quickest route."})
    assert res2.status_code == 200
    assert res2.json()["action"] == "start_mission"
    assert res2.json()["parameters"]["navigationPreference"] == "shortest_safe_path"

def test_parse_contextual_followups():
    # Follow-up: 'Add two more.' with previous action spawn_workers
    res1 = client.post("/api/command/parse", json={
        "prompt": "Add two more.",
        "context": {"last_action_type": "spawn_workers"}
    })
    assert res1.status_code == 200
    assert res1.json()["action"] == "spawn_workers"
    assert res1.json()["parameters"]["count"] == 2

    # Follow-up: 'Remove that obstacle.' with last obstacle id
    res2 = client.post("/api/command/parse", json={
        "prompt": "Remove that obstacle.",
        "context": {"last_spawned_obstacle_id": "obj-box-99"}
    })
    assert res2.status_code == 200
    assert res2.json()["action"] == "remove_target_obstacle"
    assert res2.json()["parameters"]["targetObstacleId"] == "obj-box-99"

    # Follow-up: 'Try another route.'
    res3 = client.post("/api/command/parse", json={"prompt": "Try another route."})
    assert res3.status_code == 200
    assert res3.json()["action"] == "replan_route"

    # Follow-up: 'Run the same test again.'
    res4 = client.post("/api/command/parse", json={"prompt": "Run the same test again."})
    assert res4.status_code == 200
    assert res4.json()["action"] == "start_mission"

    # Follow-up: 'Explain what happened.'
    res5 = client.post("/api/command/parse", json={"prompt": "Explain what happened."})
    assert res5.status_code == 200
    assert res5.json()["action"] == "query_explanation"

def test_parse_ambiguous_command_requires_clarification():
    res1 = client.post("/api/command/parse", json={"prompt": "Block the aisle."})
    assert res1.status_code == 200
    assert res1.json()["action"] == "clarification_needed"
    assert "Which aisle" in res1.json()["clarification_question"]

    res2 = client.post("/api/command/parse", json={"prompt": "Drop something."})
    assert res2.status_code == 200
    assert res2.json()["action"] == "clarification_needed"

def test_parse_out_of_bounds_coordinates():
    res = client.post("/api/command/parse", json={"prompt": "Drop an obstacle at coordinates X 50, Z 80."})
    assert res.status_code == 200
    assert res.json()["action"] == "clarification_needed"
    assert "outside warehouse" in res.json()["clarification_question"].lower()


# ==========================================
# PHASE 4: START, PAUSE, RESUME, EMERGENCY STOP
# ==========================================

def test_parse_start_commands():
    # 1. Start simulation
    res1 = client.post("/api/command/parse", json={"prompt": "Start the simulation."})
    assert res1.status_code == 200
    d1 = res1.json()
    assert d1["action"] == "set_simulation_state"
    assert d1["parameters"]["simulationRunning"] is True
    assert d1["requires_approval"] is False

    # 2. Start autonomous navigation
    res2 = client.post("/api/command/parse", json={"prompt": "Start autonomous navigation."})
    assert res2.status_code == 200
    d2 = res2.json()
    assert d2["action"] == "start_mission"
    assert d2["requires_approval"] is False

    # 3. Start the robot
    res3 = client.post("/api/command/parse", json={"prompt": "Start the robot."})
    assert res3.status_code == 200
    assert res3.json()["action"] == "start_mission"
    assert res3.json()["requires_approval"] is False

    # 4. Begin the mission
    res4 = client.post("/api/command/parse", json={"prompt": "Begin the mission."})
    assert res4.status_code == 200
    assert res4.json()["action"] == "start_mission"
    assert res4.json()["requires_approval"] is False

    # 5. Launch the autonomous robot
    res5 = client.post("/api/command/parse", json={"prompt": "Launch the autonomous robot."})
    assert res5.status_code == 200
    assert res5.json()["action"] == "start_mission"
    assert res5.json()["requires_approval"] is False


def test_parse_pause_commands():
    # 1. Pause simulation
    res1 = client.post("/api/command/parse", json={"prompt": "Pause the simulation."})
    assert res1.status_code == 200
    d1 = res1.json()
    assert d1["action"] == "set_simulation_state"
    assert d1["parameters"]["simulationRunning"] is False
    assert d1["requires_approval"] is False

    # 2. Freeze simulation
    res2 = client.post("/api/command/parse", json={"prompt": "Freeze the simulation."})
    assert res2.status_code == 200
    d2 = res2.json()
    assert d2["action"] == "set_simulation_state"
    assert d2["parameters"]["simulationRunning"] is False
    assert d2["requires_approval"] is False

    # 3. Pause robot (preserves route and destination)
    res3 = client.post("/api/command/parse", json={"prompt": "Pause the robot."})
    assert res3.status_code == 200
    d3 = res3.json()
    assert d3["action"] == "pause_mission"
    assert d3["requires_approval"] is False

    # 4. Stop the robot temporarily
    res4 = client.post("/api/command/parse", json={"prompt": "Stop the robot temporarily."})
    assert res4.status_code == 200
    assert res4.json()["action"] == "pause_mission"
    assert res4.json()["requires_approval"] is False

    # 5. Hold position
    res5 = client.post("/api/command/parse", json={"prompt": "Hold position."})
    assert res5.status_code == 200
    assert res5.json()["action"] == "pause_mission"
    assert res5.json()["requires_approval"] is False


def test_parse_resume_commands():
    # 1. Resume simulation
    res1 = client.post("/api/command/parse", json={"prompt": "Resume the simulation."})
    assert res1.status_code == 200
    d1 = res1.json()
    assert d1["action"] == "set_simulation_state"
    assert d1["parameters"]["simulationRunning"] is True
    assert d1["requires_approval"] is False

    # 2. Continue the mission
    res2 = client.post("/api/command/parse", json={"prompt": "Continue the mission."})
    assert res2.status_code == 200
    d2 = res2.json()
    assert d2["action"] == "resume_mission"
    assert d2["requires_approval"] is False

    # 3. Continue moving
    res3 = client.post("/api/command/parse", json={"prompt": "Continue moving."})
    assert res3.status_code == 200
    assert res3.json()["action"] == "resume_mission"
    assert res3.json()["requires_approval"] is False

    # 4. Restart navigation
    res4 = client.post("/api/command/parse", json={"prompt": "Restart navigation."})
    assert res4.status_code == 200
    assert res4.json()["action"] == "resume_mission"
    assert res4.json()["requires_approval"] is False

    # 5. Resume the robot
    res5 = client.post("/api/command/parse", json={"prompt": "Resume the robot."})
    assert res5.status_code == 200
    assert res5.json()["action"] == "resume_mission"
    assert res5.json()["requires_approval"] is False


def test_parse_emergency_stop_commands():
    # 1. Emergency stop
    res1 = client.post("/api/command/parse", json={"prompt": "Emergency stop."})
    assert res1.status_code == 200
    d1 = res1.json()
    assert d1["action"] == "emergency_stop"
    assert d1["parameters"]["emergencyStopActive"] is True
    assert d1["requires_approval"] is False

    # 2. Stop immediately
    res2 = client.post("/api/command/parse", json={"prompt": "Stop immediately."})
    assert res2.status_code == 200
    d2 = res2.json()
    assert d2["action"] == "emergency_stop"
    assert d2["requires_approval"] is False

    # 3. Halt immediately
    res3 = client.post("/api/command/parse", json={"prompt": "Halt immediately."})
    assert res3.status_code == 200
    d3 = res3.json()
    assert d3["action"] == "emergency_stop"
    assert d3["requires_approval"] is False

