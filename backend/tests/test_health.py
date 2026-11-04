import pytest
from fastapi.testclient import TestClient
from backend.app.main import app

client = TestClient(app)

def test_root_endpoint():
    response = client.get("/")
    assert response.status_code == 200
    data = response.json()
    assert data["service"] == "ROBOTRISK AI Core API"
    assert data["status"] == "online"

def test_health_check_endpoint():
    response = client.get("/api/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["version"] == "0.1.0"
    assert "capabilities" in data
    assert data["capabilities"]["scenario_validation"] is True
    assert "active_modes" in data
    assert "manual" in data["active_modes"]
    assert "autonomous" in data["active_modes"]
    assert "ai_command" in data["active_modes"]
