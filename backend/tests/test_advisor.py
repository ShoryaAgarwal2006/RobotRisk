import pytest
from fastapi.testclient import TestClient
from backend.app.main import app

client = TestClient(app)

def test_analyze_collision_failure():
    payload = {
        "incident": {
            "incident_id": "INC-TEST-01",
            "incident_type": "COLLISION",
            "sim_time": 4.5,
            "description": "Physical collision with Pallet Jack",
            "snapshot": {
                "position": [2.5, 0.22, 1.0],
                "rotation": 0.0,
                "linear_velocity": 3.2,
                "angular_velocity": 0.0,
                "ttc": 0.4,
                "min_clearance": 0.1,
                "highest_risk_obstacle": "Pallet Jack",
                "safety_status": "CRITICAL",
                "stopping_distance": 0.85
            }
        },
        "current_robot_config": {
            "maxLinearSpeed": 3.5,
            "linearAcceleration": 6.0,
            "maxAngularSpeed": 2.8,
            "angularAcceleration": 8.0
        },
        "navigation_preference": "default",
        "environment_name": "Warehouse (Baseline)",
        "nearby_spatial_risk_level": "CRITICAL"
    }

    response = client.post("/api/advisor/analyze", json=payload)
    assert response.status_code == 200
    data = response.json()

    assert data["incident_id"] == "INC-TEST-01"
    assert data["primary_failure_mode"] == "INSUFFICIENT_STOPPING_CLEARANCE"
    assert len(data["measured_evidence"]) >= 3
    assert len(data["recommendations"]) >= 2

    # Check software recommendation
    speed_rec = next(r for r in data["recommendations"] if r["category"] == "SOFTWARE_PARAMETER")
    assert speed_rec["proposed_changes"][0]["parameter_key"] == "maxLinearSpeed"
    assert speed_rec["proposed_changes"][0]["proposed_value"] < 3.5
    assert not speed_rec["is_hardware_advisory"]

    # Check hardware advisory
    hw_rec = next(r for r in data["recommendations"] if r["category"] == "HARDWARE_ADVISORY")
    assert hw_rec["is_hardware_advisory"] is True
    assert len(hw_rec["proposed_changes"]) == 0

def test_analyze_emergency_braking_failure():
    payload = {
        "incident": {
            "incident_id": "INC-TEST-02",
            "incident_type": "EMERGENCY_BRAKING",
            "sim_time": 8.2,
            "description": "Emergency braking triggered before intersection",
            "snapshot": {
                "position": [-6.5, 0.22, 0.0],
                "rotation": 1.57,
                "linear_velocity": 2.8,
                "angular_velocity": 1.8,
                "ttc": 1.1,
                "min_clearance": 0.6,
                "highest_risk_obstacle": "Storage Rack Corner",
                "safety_status": "WARNING"
            }
        },
        "current_robot_config": {
            "maxLinearSpeed": 3.5,
            "linearAcceleration": 6.0,
            "maxAngularSpeed": 2.8,
            "angularAcceleration": 8.0
        },
        "navigation_preference": "default"
    }

    response = client.post("/api/advisor/analyze", json=payload)
    assert response.status_code == 200
    data = response.json()

    assert data["primary_failure_mode"] == "SUDDEN_BRAKING_SURGE"
    accel_rec = next(r for r in data["recommendations"] if "Acceleration" in r["title"])
    assert accel_rec["proposed_changes"][0]["parameter_key"] == "linearAcceleration"
    assert accel_rec["proposed_changes"][0]["proposed_value"] < 6.0
