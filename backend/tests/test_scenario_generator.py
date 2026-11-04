"""
Unit and Integration Tests for AI Scenario Generation Service & API Endpoints
ROBOTRISK AI — PHASE 5.5C (Step 2 Verification)
"""

import math
import json
import pytest
from unittest.mock import patch, MagicMock
import httpx
from fastapi.testclient import TestClient

from backend.app.main import app
from backend.app.schemas.scenario import (
    ScenarioGenerateRequest,
    ScenarioGenerateResponse,
    ScenarioValidateRequest,
    ScenarioValidateResponse,
    GeneratedScenario,
    ActorDefinition,
    StaticHazardDefinition,
    RobotMissionSetup,
    ForkliftCompoundColliderGeometry,
    ActorGeometry,
)
from backend.app.services.scenario_generator import (
    scenario_service,
    detect_unsupported_features,
    DeterministicScenarioEngine,
    call_gemini_scenario_generator,
)


@pytest.fixture
def api_client():
    return TestClient(app)


# ==============================================================================
# TEST SUITE 1: GEMINI STRUCTURED GENERATION
# ==============================================================================

class TestGeminiStructuredGeneration:
    """Verifies that successful Gemini responses are validated and returned with GEMINI_1_5_FLASH engine."""

    def test_gemini_successful_generation(self):
        mock_gemini_payload = {
            "scenario_id": "SCEN-GEMINI-TEST-001",
            "title": "AI Generated Warehouse Challenge",
            "description": "Forklift patrolling Aisle 1 synthesized by Gemini",
            "difficulty": "extreme",
            "seed": 9876,
            "robot_setup": {
                "start_position": [-14.5, 0.22, -10.5],
                "start_rotation_rad": 0.0,
                "destination_id": "bay-4",
                "destination_name": "BAY 4 DELIVERY DROP-OFF",
                "destination_position": [14.0, 0.0, 10.5],
                "navigation_preference": "default",
            },
            "actors": [
                {
                    "id": "fk-gemini-1",
                    "name": "Gemini Forklift",
                    "actor_type": "forklift",
                    "spawn_position": [-6.5, 0.0, -2.0],
                    "patrol_start": [-6.5, -7.0],
                    "patrol_end": [-6.5, 4.0],
                    "patrol_speed": 1.4,
                    "initial_heading_rad": 0.0,
                    "direction": 1,
                    "initial_patrol_progress": 0.45,
                    "role_description": "Pallet replenishment in Aisle 1",
                }
            ],
            "static_hazards": [],
            "provenance_audit": [
                {
                    "field_name": "actors[0].patrol_speed",
                    "provenance": "EXPLICIT_USER",
                    "rationale": "Extracted from user prompt",
                    "original_extracted_value": "1.4 m/s",
                }
            ],
            "unsupported_features": [],
            "generator_engine": "GEMINI_1_5_FLASH",
        }

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "candidates": [
                {
                    "content": {
                        "parts": [{"text": json.dumps(mock_gemini_payload)}]
                    }
                }
            ]
        }

        with patch("httpx.Client.post", return_value=mock_response):
            scenario = call_gemini_scenario_generator(
                prompt="Forklift moving at 1.4 m/s in Aisle 1",
                api_key="fake-test-key",
            )
            assert scenario is not None
            assert scenario.scenario_id == "SCEN-GEMINI-TEST-001"
            assert scenario.generator_engine == "GEMINI_1_5_FLASH"
            assert len(scenario.actors) == 1
            assert scenario.actors[0].name == "Gemini Forklift"


# ==============================================================================
# TEST SUITE 2: GEMINI UNAVAILABLE, TIMEOUT & MALFORMED FALLBACKS
# ==============================================================================

class TestGeminiFallbacks:
    """Verifies seamless deterministic fallback when Gemini is missing, times out, or fails."""

    def test_gemini_unavailable_no_api_key_falls_back(self):
        with patch.dict("os.environ", {}, clear=True):
            req = ScenarioGenerateRequest(prompt="Two forklifts in narrow aisle")
            resp = scenario_service.generate_scenario(req)

            assert resp.scenario is not None
            assert resp.scenario.generator_engine == "DETERMINISTIC_PATTERN_FALLBACK"
            assert resp.validation.is_valid is True
            assert len(resp.scenario.actors) == 2

    def test_gemini_timeout_falls_back_to_deterministic(self):
        with patch.dict("os.environ", {"GEMINI_API_KEY": "fake-key"}):
            with patch("httpx.Client.post", side_effect=httpx.TimeoutException("Connection timed out")):
                req = ScenarioGenerateRequest(prompt="Forklift crossing at blind corner")
                resp = scenario_service.generate_scenario(req)

                assert resp.scenario is not None
                assert resp.scenario.generator_engine == "DETERMINISTIC_PATTERN_FALLBACK"
                assert resp.validation.is_valid is True
                assert "Corner" in resp.scenario.title or "cross" in resp.scenario.title.lower()

    def test_gemini_http_error_falls_back(self):
        mock_response = MagicMock()
        mock_response.status_code = 503  # Service unavailable
        mock_response.text = "Service temporarily overloaded"

        with patch.dict("os.environ", {"GEMINI_API_KEY": "fake-key"}):
            with patch("httpx.Client.post", return_value=mock_response):
                req = ScenarioGenerateRequest(prompt="Fast forklift head-on challenge")
                resp = scenario_service.generate_scenario(req)

                assert resp.scenario is not None
                assert resp.scenario.generator_engine == "DETERMINISTIC_PATTERN_FALLBACK"
                assert resp.validation.is_valid is True

    def test_gemini_malformed_json_falls_back(self):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "candidates": [
                {
                    "content": {
                        "parts": [{"text": "{ invalid JSON response syntax..."}]
                    }
                }
            ]
        }

        with patch.dict("os.environ", {"GEMINI_API_KEY": "fake-key"}):
            with patch("httpx.Client.post", return_value=mock_response):
                req = ScenarioGenerateRequest(prompt="Crowded warehouse with workers")
                resp = scenario_service.generate_scenario(req)

                assert resp.scenario is not None
                assert resp.scenario.generator_engine == "DETERMINISTIC_PATTERN_FALLBACK"
                assert resp.validation.is_valid is True

    def test_gemini_physically_invalid_scenario_is_rejected_and_falls_back(self):
        """
        If Gemini returns syntactically valid JSON that places an actor inside a rack,
        the service must reject the invalid scenario and fall back to a valid deterministic pattern.
        """
        invalid_gemini_payload = {
            "scenario_id": "SCEN-GEMINI-INVALID",
            "title": "Broken AI Scenario",
            "description": "Forklift placed inside Row A storage rack",
            "difficulty": "extreme",
            "seed": 1111,
            "robot_setup": {
                "start_position": [-14.5, 0.22, -10.5],
                "start_rotation_rad": 0.0,
                "destination_id": "bay-4",
                "destination_name": "BAY 4 DELIVERY DROP-OFF",
                "destination_position": [14.0, 0.0, 10.5],
            },
            "actors": [
                {
                    "id": "fk-in-rack",
                    "name": "Crashing Forklift",
                    "actor_type": "forklift",
                    # X=-3.25 is directly inside Row A North Rack [-3.95, -2.55]!
                    "spawn_position": [-3.25, 0.0, -4.0],
                    "patrol_start": [-3.25, -6.0],
                    "patrol_end": [-3.25, 2.0],
                    "patrol_speed": 1.2,
                    "initial_heading_rad": 0.0,
                    "direction": 1,
                }
            ],
            "static_hazards": [],
            "provenance_audit": [],
            "unsupported_features": [],
            "generator_engine": "GEMINI_1_5_FLASH",
        }

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "candidates": [
                {
                    "content": {
                        "parts": [{"text": json.dumps(invalid_gemini_payload)}]
                    }
                }
            ]
        }

        with patch.dict("os.environ", {"GEMINI_API_KEY": "fake-key"}):
            with patch("httpx.Client.post", return_value=mock_response):
                req = ScenarioGenerateRequest(prompt="Two forklifts in narrow aisle")
                resp = scenario_service.generate_scenario(req)

                # The invalid Gemini scenario must be discarded and replaced by fallback
                assert resp.scenario is not None
                assert resp.scenario.generator_engine == "DETERMINISTIC_PATTERN_FALLBACK"
                assert resp.validation.is_valid is True
                assert resp.scenario.scenario_id != "SCEN-GEMINI-INVALID"


# ==============================================================================
# TEST SUITE 3: UNSUPPORTED FEATURE DETECTION
# ==============================================================================

class TestUnsupportedFeatureDetection:
    """Verifies that unsupported capabilities (drones, spills, fire, weather, overhead drops) are flagged as warnings."""

    def test_unsupported_features_detected_cleanly(self):
        prompt = "Create a challenge with an aerial drone, an oil spill on the floor, and overhead falling pallets"
        detected = detect_unsupported_features(prompt)

        assert "Aerial Drone" in detected
        assert "Oil Slick" in detected or "Liquid Spill" in detected
        assert "Overhead Falling Object" in detected

    def test_unsupported_features_emitted_as_warnings(self):
        req = ScenarioGenerateRequest(
            prompt="A forklift in Aisle 1 plus an aerial quadcopter drone and liquid puddle"
        )
        resp = scenario_service.generate_scenario(req)

        assert resp.validation.is_valid is True  # Warnings do not block approval
        assert "Aerial Drone" in resp.scenario.unsupported_features
        assert any(
            w.code == "UNSUPPORTED_FEATURE_REQUESTED" and "Aerial Drone" in w.message
            for w in resp.validation.issues
        )


# ==============================================================================
# TEST SUITE 4: EXPLICIT VS INFERRED PARAMETER PROVENANCE
# ==============================================================================

class TestParameterProvenance:
    """Verifies that user-specified parameters are marked EXPLICIT_USER and unmentioned are INFERRED_DEFAULT."""

    def test_explicit_speed_and_corridor_provenance(self):
        req = ScenarioGenerateRequest(prompt="Two forklifts in narrow aisle at high speed")
        resp = scenario_service.generate_scenario(req)

        provenance_map = {p.field_name: p.provenance for p in resp.scenario.provenance_audit}

        # Actor count and corridor should be explicitly extracted or inferred
        assert "actors.count" in provenance_map
        assert provenance_map["actors.count"] == "EXPLICIT_USER"

        # Coordinates should be constrained by the system geometry
        assert any(p.provenance == "SYSTEM_CONSTRAINED" for p in resp.scenario.provenance_audit)


# ==============================================================================
# TEST SUITE 5: REPRODUCIBILITY & PATTERN MATCHING
# ==============================================================================

class TestDeterministicReproducibility:
    """Verifies deterministic pattern outputs and consistent coordinates across runs."""

    def test_opposing_forklifts_pattern_geometry(self):
        scenario = DeterministicScenarioEngine.generate("Two forklifts approaching head on in narrow aisle")
        assert len(scenario.actors) == 2
        fk1, fk2 = scenario.actors[0], scenario.actors[1]

        # Both in Aisle 1 at X = -6.5
        assert fk1.spawn_position[0] == -6.5
        assert fk2.spawn_position[0] == -6.5

        # Headings oppose each other (0.0 vs pi)
        assert fk1.initial_heading_rad == 0.0
        assert fk2.initial_heading_rad == math.pi

        # Safe separation between spawns
        assert abs(fk1.spawn_position[2] - fk2.spawn_position[2]) >= 7.0

    def test_blind_corner_cross_pattern_geometry(self):
        scenario = DeterministicScenarioEngine.generate("Forklift emerges at blind corner intersection")
        assert len(scenario.actors) == 1
        fk = scenario.actors[0]

        # Crossing along Z = 0.0
        assert fk.spawn_position[2] == 0.0
        assert pytest.approx(fk.initial_heading_rad, 1e-4) == -math.pi / 2  # Westbound

    def test_blocked_corridor_barrier_pattern(self):
        scenario = DeterministicScenarioEngine.generate("Aisle is blocked by barrier with moving forklift")
        assert len(scenario.static_hazards) == 1
        hazard = scenario.static_hazards[0]
        assert hazard.hazard_type == "barrier"
        assert hazard.position[0] == -14.5  # In West Arterial

    def test_dynamic_corridor_and_speed_extraction_corridor_2(self):
        """Verifies that preferred_corridor='aisle-2' and 1.8 m/s are dynamically applied."""
        scenario = DeterministicScenarioEngine.generate(
            prompt="Two heavy industrial forklifts patrolling Corridor 2 at 1.8 m/s with opposite patrol headings.",
            preferred_corridor="aisle-2",
            difficulty="hard",
        )
        assert len(scenario.actors) == 2
        fk1 = scenario.actors[0]
        fk2 = scenario.actors[1]

        # Centered along Aisle 2 (X = 0.0)
        assert fk1.spawn_position[0] == 0.0
        assert fk2.spawn_position[0] == 0.0
        assert fk1.patrol_start[0] == 0.0
        assert fk2.patrol_start[0] == 0.0

        # Speeds match extracted 1.8 m/s
        assert fk1.patrol_speed == 1.8
        assert fk2.patrol_speed == round(1.8 * 0.9, 2)

        # Provenance audit captures explicit user provenance
        prov_map = {p.field_name: p for p in scenario.provenance_audit}
        assert prov_map["scenario.corridor"].provenance == "EXPLICIT_USER"
        assert prov_map["actors[0].patrol_speed"].provenance == "EXPLICIT_USER"
        assert "1.8 m/s" in prov_map["actors[0].patrol_speed"].original_extracted_value

    def test_dynamic_corridor_and_speed_extraction_corridor_3(self):
        """Verifies that Corridor 3 (X=6.5) is extracted from prompt text."""
        scenario = DeterministicScenarioEngine.generate(
            prompt="Fast forklift in Corridor 3 at 2.2 m/s",
        )
        assert len(scenario.actors) >= 1
        actor = scenario.actors[0]
        assert actor.spawn_position[0] == 6.5
        assert actor.patrol_speed == 2.2



# ==============================================================================
# TEST SUITE 6: API ENDPOINT CONTRACTS & HTTP RESPONSES
# ==============================================================================

class TestScenarioAPIEndpoints:
    """Verifies POST /api/scenario/generate and POST /api/scenario/validate."""

    def test_api_generate_endpoint_success(self, api_client):
        response = api_client.post(
            "/api/scenario/generate",
            json={"prompt": "Two forklifts approaching head-on in narrow aisle"},
        )
        assert response.status_code == 200
        data = response.json()

        assert "scenario" in data
        assert "validation" in data
        assert data["validation"]["is_valid"] is True
        assert len(data["scenario"]["actors"]) == 2
        assert data["scenario"]["generator_engine"] in [
            "GEMINI_1_5_FLASH",
            "DETERMINISTIC_PATTERN_FALLBACK",
        ]

    def test_api_generate_endpoint_invalid_payload_fails(self, api_client):
        # Empty prompt violates min_length=2
        response = api_client.post("/api/scenario/generate", json={"prompt": ""})
        assert response.status_code == 422

    def test_api_validate_endpoint_valid_scenario(self, api_client):
        scenario = DeterministicScenarioEngine.generate("Safe Aisle 1 patrol")
        response = api_client.post(
            "/api/scenario/validate",
            json={"scenario": scenario.model_dump()},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["validation"]["is_valid"] is True
        assert len(data["validation"]["issues"]) == 0

    def test_api_validate_endpoint_invalid_scenario_returns_specific_errors(self, api_client):
        scenario = DeterministicScenarioEngine.generate("Opposing dual forklifts")
        # Deliberately move actor 0 into Row A North Rack [-3.95, -2.55]
        scenario.actors[0].spawn_position = [-3.25, 0.0, -4.0]
        scenario.actors[0].patrol_start = [-3.25, -6.0]
        scenario.actors[0].patrol_end = [-3.25, 2.0]

        response = api_client.post(
            "/api/scenario/validate",
            json={"scenario": scenario.model_dump()},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["validation"]["is_valid"] is False
        error_codes = [i["code"] for i in data["validation"]["issues"] if i["severity"] == "ERROR"]
        assert "FORKLIFT_SPAWN_COLLIDES_RACK" in error_codes

    def test_api_generate_endpoint_physical_validation_failure_returns_structured_error(self, api_client):
        """
        Verifies that if scenario generation somehow produces an invalid scenario,
        POST /api/scenario/generate rejects it and returns an explicit structured HTTP 422 error
        instead of returning an invalid scenario.
        """
        broken_scenario = DeterministicScenarioEngine.generate("Safe Aisle 1 patrol")
        # Break the scenario by forcing an invalid spawn inside a rack
        broken_scenario.actors[0].spawn_position = [-3.25, 0.0, -4.0]

        with patch("backend.app.services.scenario_generator.DeterministicScenarioEngine.generate", return_value=broken_scenario):
            response = api_client.post(
                "/api/scenario/generate",
                json={"prompt": "Safe Aisle 1 patrol"},
            )
            assert response.status_code == 422
            detail = response.json()["detail"]
            assert detail["error"] == "SCENARIO_PHYSICAL_VALIDATION_FAILED"
            assert "FORKLIFT_SPAWN_COLLIDES_RACK" in [i["code"] for i in detail["issues"]]


# ==============================================================================
# TEST SUITE 7: EXISTING CORE API REGRESSIONS
# ==============================================================================

class TestCoreAPIRegressions:
    """Verifies that existing core endpoints remain functional after adding scenario routes."""

    def test_health_check_endpoint(self, api_client):
        response = api_client.get("/api/health")
        assert response.status_code == 200
        assert response.json()["status"] == "ok"

    def test_command_parse_endpoint(self, api_client):
        response = api_client.post(
            "/api/command/parse",
            json={"prompt": "Place an obstacle 2 meters ahead of the robot"},
        )
        assert response.status_code == 200
        assert response.json()["action"] == "spawn_obstacle"

    def test_advisor_analyze_endpoint(self, api_client):
        response = api_client.post(
            "/api/advisor/analyze",
            json={
                "incident": {
                    "incident_id": "inc-test-01",
                    "incident_type": "collision",
                    "sim_time": 10.5,
                    "description": "AMR collided with obstacle",
                    "snapshot": {
                        "linear_velocity": 1.2,
                        "min_clearance": 0.05,
                        "ttc": 0.2,
                    },
                },
                "current_robot_config": {
                    "maxLinearSpeed": 1.5,
                    "safetyMargin": 0.3,
                    "brakingDecel": 1.0,
                },
            },
        )
        assert response.status_code == 200
        assert "primary_failure_mode" in response.json()


# ==============================================================================
# TEST SUITE 8: NATURAL LANGUAGE PHYSICAL OBJECT GENERATION
# ==============================================================================

class TestNaturalLanguagePhysicalObjectGeneration:
    """Verifies physical object quantity extraction and placement along robot route."""

    def test_place_four_boxes_in_path(self, api_client):
        resp = api_client.post(
            "/api/scenario/generate",
            json={"prompt": "Place 4 boxes in the path of the robot."},
        )
        assert resp.status_code == 200
        data = resp.json()
        scen = data["scenario"]
        assert len(scen["static_hazards"]) == 4
        for i, h in enumerate(scen["static_hazards"]):
            assert h["hazard_type"] == "cube"
            assert h["position"][0] == -14.5  # West arterial
            assert h["position"][1] == 0.40  # Y=0.4 so sits on floor
            assert h["size"] == [0.8, 0.8, 0.8]
        # Check non-overlapping and spaced along path
        z_coords = [h["position"][2] for h in scen["static_hazards"]]
        assert z_coords == sorted(z_coords)
        for i in range(len(z_coords) - 1):
            assert z_coords[i+1] - z_coords[i] >= 2.0
        assert data["validation"]["is_valid"] is True

    def test_place_three_barriers_across_aisle_2(self, api_client):
        resp = api_client.post(
            "/api/scenario/generate",
            json={"prompt": "Place 3 barriers across aisle 2."},
        )
        assert resp.status_code == 200
        data = resp.json()
        scen = data["scenario"]
        assert len(scen["static_hazards"]) == 3
        for h in scen["static_hazards"]:
            assert h["hazard_type"] == "barrier"
            assert h["position"][0] == 0.0  # Aisle 2
            assert h["size"] == [2.4, 1.1, 0.4]
        assert data["validation"]["is_valid"] is True

    def test_add_two_workers_and_one_forklift_near_blind_corner(self, api_client):
        resp = api_client.post(
            "/api/scenario/generate",
            json={"prompt": "Add 2 workers and 1 forklift near the blind corner."},
        )
        assert resp.status_code == 200
        data = resp.json()
        scen = data["scenario"]
        workers = [a for a in scen["actors"] if a["actor_type"] == "worker"]
        forklifts = [a for a in scen["actors"] if a["actor_type"] == "forklift"]
        assert len(workers) == 2
        assert len(forklifts) == 1
        assert data["validation"]["is_valid"] is True

    def test_put_five_obstacles_between_robot_and_destination(self, api_client):
        resp = api_client.post(
            "/api/scenario/generate",
            json={"prompt": "Put 5 obstacles between the robot and its destination."},
        )
        assert resp.status_code == 200
        data = resp.json()
        scen = data["scenario"]
        assert len(scen["static_hazards"]) == 5
        assert data["validation"]["is_valid"] is True

    def test_place_two_boxes_on_left_side_of_aisle(self, api_client):
        resp = api_client.post(
            "/api/scenario/generate",
            json={"prompt": "Place 2 boxes on the left side of the aisle."},
        )
        assert resp.status_code == 200
        data = resp.json()
        scen = data["scenario"]
        assert len(scen["static_hazards"]) == 2
        for h in scen["static_hazards"]:
            assert h["position"][0] == -13.8  # Left offset from -14.5
        assert data["validation"]["is_valid"] is True

