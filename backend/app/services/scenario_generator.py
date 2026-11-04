"""
AI Scenario Generation Service & Deterministic Fallback Engine
ROBOTRISK AI — PHASE 5.5C (Step 2)

This service transforms natural language safety-testing requests into validated,
structured adversarial AMR scenarios with full parameter provenance tracking,
unsupported feature detection, and deterministic pattern fallbacks.
"""

import os
import re
import json
import math
import time
import uuid
import httpx
from typing import Optional, List, Dict, Any, Tuple

from backend.app.schemas.scenario import (
    GeneratedScenario,
    ActorDefinition,
    StaticHazardDefinition,
    RobotMissionSetup,
    ParameterProvenance,
    ScenarioValidationResult,
    ValidationIssue,
    ScenarioGenerateRequest,
    ScenarioGenerateResponse,
    ScenarioValidateRequest,
    ScenarioValidateResponse,
    ForkliftCompoundColliderGeometry,
    WorkerColliderGeometry,
    ActorGeometry,
)
from backend.app.services.scenario_validator import scenario_validator
from backend.app.models.warehouse_geometry import (
    WAREHOUSE_NAVIGABLE_BOUNDS,
    WAREHOUSE_TOTAL_BOUNDS,
    STATIC_OBSTACLES,
    AISLES,
    DESTINATIONS,
    DEFAULT_ROBOT_SPAWN,
    DEFAULT_ROBOT_ROTATION,
)

class ScenarioPhysicalValidationError(Exception):
    """Raised when a generated scenario fails authoritative physical validation."""
    def __init__(self, validation_result: ScenarioValidationResult):
        self.validation_result = validation_result
        super().__init__("Generated scenario failed physical warehouse geometry validation.")


# Unsupported capability keywords mapping
UNSUPPORTED_FEATURE_KEYWORDS: Dict[str, str] = {
    "drone": "Aerial Drone",
    "drones": "Aerial Drone",
    "uav": "Aerial Drone",
    "quadcopter": "Aerial Drone",
    "flying": "Aerial Object",
    "fire": "Fire Hazard",
    "flame": "Fire Hazard",
    "smoke": "Smoke / Gas Emission",
    "spill": "Liquid Spill",
    "oil": "Oil Slick",
    "water": "Liquid Spill",
    "puddle": "Liquid Puddle",
    "liquid": "Liquid Hazard",
    "falling": "Overhead Falling Object",
    "overhead": "Overhead Falling Object",
    "drop": "Dropping Cargo",
    "dropping": "Dropping Cargo",
    "stair": "Staircase Navigation",
    "stairs": "Staircase Navigation",
    "elevator": "Freight Elevator",
    "escalator": "Escalator",
    "ramp": "Multi-floor Ramp",
    "snow": "Weather / Snow Hazard",
    "ice": "Weather / Ice Hazard",
    "rain": "Weather / Rain Hazard",
    "weather": "Atmospheric Weather Condition",
    "fog": "Atmospheric Fog",
    "truck": "Autonomous Highway Truck",
    "train": "AGV Rail Train",
    "conveyor": "Conveyor Belt System",
    "crane": "Gantry Crane",
    "gantry": "Gantry Crane",
}


def detect_unsupported_features(prompt: str) -> List[str]:
    """Scans the user prompt for requested capabilities not supported by the ground AMR simulation."""
    prompt_lower = prompt.lower()
    detected: List[str] = []
    seen_labels = set()

    # Split prompt into word tokens
    words = re.findall(r"\b[a-z]+\b", prompt_lower)
    for word in words:
        if word in UNSUPPORTED_FEATURE_KEYWORDS:
            label = UNSUPPORTED_FEATURE_KEYWORDS[word]
            if label not in seen_labels:
                seen_labels.add(label)
                detected.append(label)

    return detected


# ==============================================================================
# GEMINI STRUCTURED GENERATION ENGINE
# ==============================================================================

def call_gemini_scenario_generator(
    prompt: str,
    preferred_corridor: Optional[str] = None,
    difficulty: Optional[str] = None,
    api_key: Optional[str] = None,
    timeout: float = 5.0,
) -> Optional[GeneratedScenario]:
    """
    Calls Google Gemini 1.5 Flash to synthesize an adversarial scenario conforming
    to Pydantic GeneratedScenario and physical warehouse bounds.
    Returns None if API key is missing, call times out, JSON is malformed, or
    resulting scenario fails physical validation.
    """
    key = api_key or os.environ.get("GEMINI_API_KEY")
    if not key:
        return None

    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={key}"

    system_instruction = (
        "You are the ROBOTRISK AI Lead Adversarial Scenario Architect. "
        "Generate realistic ground-level autonomous mobile robot (AMR) safety test scenarios inside an industrial warehouse.\n\n"
        "AUTHORITATIVE WAREHOUSE GEOMETRY:\n"
        "- Total Floor: X in [-20.0, 20.0], Z in [-16.0, 16.0]\n"
        "- Navigable Bounds: X in [-19.0, 19.0], Z in [-15.0, 15.0]\n"
        "- Robot Start: [-14.5, 0.22, -10.5], Rotation 0.0 (facing +Z South down West Transit Arterial)\n"
        "- Delivery Destination: Bay 4 at [14.0, 0.0, 10.5]\n"
        "- Aisles:\n"
        "  * aisle-main-west: X = -14.5, Z from -12.0 to 12.0 (width 3.2m)\n"
        "  * aisle-main-east: X = 14.0, Z from -12.0 to 12.0 (width 3.2m)\n"
        "  * aisle-north-cross: Z = -10.5, X from -14.5 to 14.0 (width 3.0m)\n"
        "  * aisle-south-cross: Z = 10.5, X from -14.5 to 14.0 (width 3.0m)\n"
        "  * aisle-1: X = -6.5, Z from -9.0 to 9.0 (width 2.8m)\n"
        "  * aisle-2: X = 0.0, Z from -9.0 to 9.0 (width 2.8m)\n"
        "  * aisle-3: X = 6.5, Z from -9.0 to 9.0 (width 2.8m)\n"
        "- Storage Racks: 4 Double-Bay Rows (Row D: X in [-10.45, -9.05], Row A: X in [-3.95, -2.55], "
        "Row B: X in [2.55, 3.95], Row C: X in [9.05, 10.45]; all Z in [-7.75, -1.25] and [1.25, 7.75]).\n\n"
        "PHYSICAL COLLIDER RULES:\n"
        "1. Forklifts have compound colliders: Width 1.0m, Length 2.30m (Rear -0.80m, Front forks +1.50m). "
        "Forklift heading MUST strictly match its patrol direction vector: yaw = atan2(dx, dz). "
        "Both patrol endpoints MUST have >= 1.50m clearance from perimeter walls and racks to allow 180° turnaround.\n"
        "2. Workers have capsule colliders: Radius 0.30m, Height 1.70m. Speeds between 0.4 and 1.2 m/s.\n"
        "3. Static hazards: hazard_type must be 'barrier', 'cube', or 'sphere'.\n"
        "4. Output MUST be valid JSON adhering strictly to the GeneratedScenario schema."
    )

    request_payload = {
        "contents": [
            {
                "parts": [
                    {
                        "text": (
                            f"{system_instruction}\n\n"
                            f"User Scenario Prompt: \"{prompt}\"\n"
                            f"Preferred Corridor: {preferred_corridor or 'auto'}\n"
                            f"Target Difficulty: {difficulty or 'extreme'}\n\n"
                            "Return PURE JSON adhering to GeneratedScenario structure."
                        )
                    }
                ]
            }
        ],
        "generationConfig": {"response_mime_type": "application/json"},
    }

    try:
        with httpx.Client(timeout=timeout) as client:
            resp = client.post(url, json=request_payload)
            if resp.status_code != 200:
                return None

            data = resp.json()
            content_str = data["candidates"][0]["content"]["parts"][0]["text"]
            parsed_json = json.loads(content_str)

            # Ensure required system fields
            if "scenario_id" not in parsed_json:
                parsed_json["scenario_id"] = f"SCEN-GEMINI-{uuid.uuid4().hex[:6].upper()}"
            if "seed" not in parsed_json:
                parsed_json["seed"] = int(time.time()) % 100000
            parsed_json["generator_engine"] = "GEMINI_1_5_FLASH"

            # Parse through Pydantic
            scenario = GeneratedScenario(**parsed_json)

            # Strict Step 1 physical validation check
            val_res = scenario_validator.validate_scenario(scenario)
            if not val_res.is_valid:
                # Gemini generated a physically invalid scenario (e.g. rack overlap, out of bounds)
                # Discard and return None to trigger reliable deterministic fallback
                return None

            return scenario
    except Exception:
        # Transparent fallback on network error, timeout, JSONDecodeError, or Pydantic ValidationError
        return None


# ==============================================================================
# DETERMINISTIC PATTERN-BASED FALLBACK ENGINE
# ==============================================================================

class DeterministicScenarioEngine:
    """
    Generates physically valid, reproduceable adversarial AMR scenarios when
    the AI provider is unavailable, times out, or produces invalid geometry.
    Guarantees 100% compliance with warehouse geometry and physical colliders.
    """

    @staticmethod
    def _resolve_corridor(prompt: str, preferred_corridor: Optional[str]) -> Tuple[str, str, float, bool]:
        """
        Resolves corridor ID, display name, centerline X coordinate, and whether
        it was explicitly provided by the user.
        """
        p_lower = prompt.lower()
        if preferred_corridor:
            c = preferred_corridor.lower()
            if "aisle-2" in c or "aisle 2" in c or "corridor 2" in c:
                return "aisle-2", "Aisle 2 (Center Crossing)", 0.0, True
            if "aisle-3" in c or "aisle 3" in c or "corridor 3" in c:
                return "aisle-3", "Aisle 3 (Storage Bay C-D)", 6.5, True
            if "aisle-main-west" in c or "main-west" in c or "west" in c:
                return "aisle-main-west", "West Transit Arterial", -14.5, True
            if "aisle-main-east" in c or "main-east" in c or "east" in c:
                return "aisle-main-east", "East Transit Arterial", 14.0, True
            if "aisle-1" in c or "aisle 1" in c or "corridor 1" in c:
                return "aisle-1", "Aisle 1 (Storage Bay A-B)", -6.5, True

        if "aisle 2" in p_lower or "aisle-2" in p_lower or "corridor 2" in p_lower or "corridor-2" in p_lower or "central corridor" in p_lower or "center aisle" in p_lower:
            return "aisle-2", "Aisle 2 (Center Crossing)", 0.0, True
        if "aisle 3" in p_lower or "aisle-3" in p_lower or "corridor 3" in p_lower or "corridor-3" in p_lower or "east aisle" in p_lower:
            return "aisle-3", "Aisle 3 (Storage Bay C-D)", 6.5, True
        if "main west" in p_lower or "west arterial" in p_lower or "west corridor" in p_lower:
            return "aisle-main-west", "West Transit Arterial", -14.5, True
        if "main east" in p_lower or "east arterial" in p_lower or "east corridor" in p_lower:
            return "aisle-main-east", "East Transit Arterial", 14.0, True
        if "aisle 1" in p_lower or "aisle-1" in p_lower or "corridor 1" in p_lower or "corridor-1" in p_lower:
            return "aisle-1", "Aisle 1 (Storage Bay A-B)", -6.5, True

        return "aisle-1", "Aisle 1 (Storage Bay A-B)", -6.5, False

    @staticmethod
    def _extract_speed(prompt: str) -> Optional[float]:
        """Extracts requested speed in m/s from prompt if present."""
        match = re.search(r"(\d+(?:\.\d+)?)\s*(?:m/s|mps|meters?\s*(?:per|/)\s*sec(?:ond)?)", prompt, re.IGNORECASE)
        if match:
            try:
                spd = float(match.group(1))
                return max(0.4, min(2.5, spd))
            except ValueError:
                return None
        return None

    @staticmethod
    def _extract_entity_quantities(prompt: str) -> Dict[str, int]:
        """
        Extracts requested counts for boxes, barriers, workers, forklifts, and generic obstacles.
        Supports digit numbers ("4") and English number words ("four", "two", "a").
        """
        num_map = {
            "a": 1, "an": 1, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
            "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10
        }
        for i in range(1, 21):
            num_map[str(i)] = i

        aliases = {
            "box": ["boxes", "box", "crates", "crate", "cubes", "cube", "pallets", "pallet"],
            "barrier": ["barriers", "barrier", "barricades", "barricade"],
            "worker": ["workers", "worker", "pedestrians", "pedestrian", "people", "person"],
            "forklift": ["forklifts", "forklift"],
            "obstacle": ["obstacles", "obstacle", "hazards", "hazard", "spheres", "sphere"],
        }

        result: Dict[str, int] = {}
        p_lower = prompt.lower()

        for ent_type, words in aliases.items():
            pattern = r"\b(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten)\s+(" + "|".join(words) + r")\b"
            matches = re.findall(pattern, p_lower)
            if matches:
                for num_str, _ in matches:
                    val = num_map.get(num_str, 1)
                    result[ent_type] = result.get(ent_type, 0) + val
            else:
                for w in words:
                    if re.search(r"\b" + w + r"\b", p_lower):
                        result[ent_type] = 1
                        break

        return result

    @staticmethod
    def _is_point_feasible(x: float, z: float, half_w: float = 0.4, half_l: float = 0.4, margin: float = 0.15) -> bool:
        """Checks if a point [x, z] is inside navigable bounds and free of static racks, walls, and robot spawn."""
        if not (WAREHOUSE_NAVIGABLE_BOUNDS.min_x + half_w <= x <= WAREHOUSE_NAVIGABLE_BOUNDS.max_x - half_w and
                WAREHOUSE_NAVIGABLE_BOUNDS.min_z + half_l <= z <= WAREHOUSE_NAVIGABLE_BOUNDS.max_z - half_l):
            return False
        for obs in STATIC_OBSTACLES:
            if (x + half_w + margin >= obs.min_x and x - half_w - margin <= obs.max_x and
                z + half_l + margin >= obs.min_z and z - half_l - margin <= obs.max_z):
                return False
        rx, _, rz = DEFAULT_ROBOT_SPAWN
        if math.hypot(x - rx, z - rz) < (0.54 + math.hypot(half_w, half_l) + 0.5):
            return False
        return True

    @staticmethod
    def generate(
        prompt: str,
        preferred_corridor: Optional[str] = None,
        difficulty: Optional[str] = None,
        unsupported_features: Optional[List[str]] = None,
    ) -> GeneratedScenario:
        prompt_lower = prompt.lower()
        seed = int(time.time()) % 100000
        unsupported = unsupported_features or []

        # Determine target difficulty
        diff: str = difficulty or "extreme"
        if not difficulty:
            if any(w in prompt_lower for w in ["extreme", "very dangerous", "impossible", "stress", "severe"]):
                diff = "extreme"
            elif any(w in prompt_lower for w in ["hard", "difficult", "challenging"]):
                diff = "hard"
            elif any(w in prompt_lower for w in ["normal", "medium", "standard"]):
                diff = "normal"

        corridor_id, corridor_name, corridor_x, is_corridor_explicit = (
            DeterministicScenarioEngine._resolve_corridor(prompt, preferred_corridor)
        )
        custom_speed = DeterministicScenarioEngine._extract_speed(prompt)
        entity_counts = DeterministicScenarioEngine._extract_entity_quantities(prompt)

        # Check for natural language object placement requests
        has_boxes = entity_counts.get("box", 0) > 0 or entity_counts.get("obstacle", 0) > 0 or "box" in prompt_lower or "boxes" in prompt_lower
        has_barriers = entity_counts.get("barrier", 0) > 1 or ("across" in prompt_lower and entity_counts.get("barrier", 0) > 0)
        has_mixed_actors = (entity_counts.get("worker", 0) > 0 and entity_counts.get("forklift", 0) > 0) or ("blind corner" in prompt_lower and entity_counts.get("worker", 0) > 0)
        has_spatial_path = any(kw in prompt_lower for kw in ["in the path", "path of the robot", "ahead of the robot", "between the robot", "left side", "right side", "across aisle", "across corridor"])

        if (has_boxes or has_barriers or has_mixed_actors or (has_spatial_path and (entity_counts.get("box", 0) > 0 or entity_counts.get("obstacle", 0) > 0 or entity_counts.get("barrier", 0) > 0))) and not ("two heavy industrial forklifts" in prompt_lower or "crosswalk blind corner" in prompt_lower or "crowded warehouse section" in prompt_lower or "maintenance barrier completely blocking" in prompt_lower or "high-speed head-on" in prompt_lower):
            return DeterministicScenarioEngine._pattern_physical_object_placement(
                prompt, diff, seed, unsupported, corridor_id, corridor_name, corridor_x, is_corridor_explicit, custom_speed, entity_counts
            )

        # Pattern 1: Opposing Dual Forklifts in Narrow Aisle
        # Matches: "opposite", "opposing", "head-to-head", "head on", "narrow aisle", "two forklifts", "dual"
        if any(kw in prompt_lower for kw in ["opposit", "opposing", "head-to-head", "head on", "head-on", "two forklift", "dual forklift", "both direction", "dual"]):
            return DeterministicScenarioEngine._pattern_opposing_forklifts(
                prompt, diff, seed, unsupported, corridor_id, corridor_name, corridor_x, is_corridor_explicit, custom_speed
            )

        # Pattern 2: Blind Corner / Perpendicular Cross Traffic / Crosswalk
        # Matches: "blind corner", "corner", "crosswalk", "intersection", "perpendicular", "t-bone", "emerge"
        elif any(kw in prompt_lower for kw in ["blind corner", "corner", "crosswalk", "intersection", "perpendicular", "t-bone"]) or re.search(r"\bemerg(?:e|es|ed|ing)\b", prompt_lower):
            return DeterministicScenarioEngine._pattern_blind_corner_cross(
                prompt, diff, seed, unsupported, corridor_id, corridor_name, corridor_x, is_corridor_explicit, custom_speed
            )

        # Pattern 3: Crowded Warehouse with Pedestrian Workers
        # Matches: "worker", "pedestrian", "crowd", "people", "dense", "busy", "congestion", "bottleneck", "workforce"
        elif any(kw in prompt_lower for kw in ["worker", "pedestrian", "crowd", "people", "dense", "busy", "congestion", "bottleneck", "workforce"]):
            return DeterministicScenarioEngine._pattern_crowded_workers(
                prompt, diff, seed, unsupported, corridor_id, corridor_name, corridor_x, is_corridor_explicit, custom_speed
            )

        # Pattern 4: Blocked Aisle / Static Maintenance Barrier with Dynamic Patrol
        # Matches: "block", "barrier", "obstacle", "debris", "dead end", "closed", "reroute", "detour"
        elif any(kw in prompt_lower for kw in ["block", "barrier", "obstacle", "debris", "dead end", "closed", "reroute", "detour"]):
            return DeterministicScenarioEngine._pattern_blocked_corridor(
                prompt, diff, seed, unsupported, corridor_id, corridor_name, corridor_x, is_corridor_explicit, custom_speed
            )

        # Pattern 5: High Speed Stress Test & Head-On Approach
        # Matches: "fast", "speed", "rush", "high speed", "aggressive", "towards robot", "toward robot", "impasse"
        elif any(kw in prompt_lower for kw in ["fast", "speed", "rush", "high speed", "aggressive", "towards robot", "toward robot", "impasse"]):
            return DeterministicScenarioEngine._pattern_high_speed_patrol(
                prompt, diff, seed, unsupported, corridor_id, corridor_name, corridor_x, is_corridor_explicit, custom_speed
            )

        # Pattern 6: Default Adversarial Baseline
        else:
            return DeterministicScenarioEngine._pattern_baseline_adversarial(
                prompt, diff, seed, unsupported, corridor_id, corridor_name, corridor_x, is_corridor_explicit, custom_speed
            )

    @staticmethod
    def _pattern_physical_object_placement(
        prompt: str,
        diff: str,
        seed: int,
        unsupported: List[str],
        corridor_id: str,
        corridor_name: str,
        corridor_x: float,
        is_corridor_explicit: bool,
        custom_speed: Optional[float],
        entity_counts: Dict[str, int],
    ) -> GeneratedScenario:
        p_lower = prompt.lower()
        static_hazards: List[StaticHazardDefinition] = []
        actors: List[ActorDefinition] = []
        provenance: List[ParameterProvenance] = []

        is_left_side = "left side" in p_lower or "on the left" in p_lower
        is_right_side = "right side" in p_lower or "on the right" in p_lower
        is_between_dest = "between" in p_lower and ("destination" in p_lower or "goal" in p_lower or "robot" in p_lower)
        is_blind_corner = "blind corner" in p_lower or "corner" in p_lower

        # 1. Boxes / Cubes / Generic Obstacles
        n_boxes = entity_counts.get("box", 0) or entity_counts.get("obstacle", 0)
        if n_boxes > 0:
            box_half = 0.40  # 0.80m cube
            box_positions: List[Tuple[float, float]] = []

            if is_between_dest:
                candidate_pts = [
                    (-14.5, -6.5), (-14.5, -1.5), (-14.5, 4.0), (-14.5, 9.0),
                    (-8.0, 10.5), (-1.0, 10.5), (5.0, 10.5), (10.0, 10.5)
                ]
                feasible_candidates = [pt for pt in candidate_pts if DeterministicScenarioEngine._is_point_feasible(pt[0], pt[1], box_half, box_half)]
                if len(feasible_candidates) < n_boxes:
                    raise ScenarioPhysicalValidationError(
                        ScenarioValidationResult(
                            is_valid=False,
                            issues=[ValidationIssue(
                                severity="ERROR",
                                code="FEASIBLE_POSITIONS_NOT_FOUND",
                                message=f"Could only find {len(feasible_candidates)} feasible locations along route to destination for {n_boxes} requested obstacles.",
                            )],
                            tested_footprints_count=len(feasible_candidates),
                            swept_path_segments_count=0
                        )
                    )
                step_idx = (len(feasible_candidates) - 1) / max(1, n_boxes - 1) if n_boxes > 1 else 0
                for i in range(n_boxes):
                    idx = int(round(i * step_idx)) if n_boxes > 1 else 0
                    box_positions.append(feasible_candidates[min(idx, len(feasible_candidates) - 1)])

            elif is_left_side or is_right_side:
                cx = corridor_x if is_corridor_explicit else -14.5
                offset = 0.7 if is_left_side else -0.7
                target_x = cx + offset
                z_start = -6.0
                z_end = 6.0
                step_z = (z_end - z_start) / max(1, n_boxes - 1) if n_boxes > 1 else 0.0
                for i in range(n_boxes):
                    pz = z_start + i * step_z if n_boxes > 1 else 0.0
                    if not DeterministicScenarioEngine._is_point_feasible(target_x, pz, box_half, box_half):
                        raise ScenarioPhysicalValidationError(
                            ScenarioValidationResult(
                                is_valid=False,
                                issues=[ValidationIssue(
                                    severity="ERROR",
                                    code="FEASIBLE_POSITIONS_NOT_FOUND",
                                    message=f"Location [{target_x:.2f}, {pz:.2f}] on {'left' if is_left_side else 'right'} side of aisle violates warehouse geometry bounds or racks.",
                                )],
                                tested_footprints_count=i,
                                swept_path_segments_count=0
                            )
                        )
                    box_positions.append((target_x, round(pz, 2)))

            else:
                cx = corridor_x if is_corridor_explicit else -14.5
                if abs(cx - (-14.5)) < 0.1:
                    step_z = 15.0 / (n_boxes + 1)
                    for i in range(n_boxes):
                        pz = -7.5 + (i + 1) * step_z
                        if not DeterministicScenarioEngine._is_point_feasible(cx, pz, box_half, box_half):
                            raise ScenarioPhysicalValidationError(
                                ScenarioValidationResult(
                                    is_valid=False,
                                    issues=[ValidationIssue(
                                        severity="ERROR",
                                        code="FEASIBLE_POSITIONS_NOT_FOUND",
                                        message=f"Location [{cx:.2f}, {pz:.2f}] in robot path violates warehouse geometry.",
                                    )],
                                    tested_footprints_count=i,
                                    swept_path_segments_count=0
                                )
                            )
                        box_positions.append((cx, round(pz, 2)))
                else:
                    step_z = 12.0 / (n_boxes + 1)
                    for i in range(n_boxes):
                        pz = -6.0 + (i + 1) * step_z
                        if not DeterministicScenarioEngine._is_point_feasible(cx, pz, box_half, box_half):
                            raise ScenarioPhysicalValidationError(
                                ScenarioValidationResult(
                                    is_valid=False,
                                    issues=[ValidationIssue(
                                        severity="ERROR",
                                        code="FEASIBLE_POSITIONS_NOT_FOUND",
                                        message=f"Location [{cx:.2f}, {pz:.2f}] in corridor {corridor_name} violates warehouse geometry.",
                                    )],
                                    tested_footprints_count=i,
                                    swept_path_segments_count=0
                                )
                            )
                        box_positions.append((cx, round(pz, 2)))

            for i, (bx, bz) in enumerate(box_positions):
                static_hazards.append(
                    StaticHazardDefinition(
                        id=f"box-{i+1}",
                        hazard_type="cube",
                        name=f"Cargo Box {i+1}",
                        position=[bx, 0.40, bz],
                        size=[0.80, 0.80, 0.80],
                        rotation_rad=0.0,
                        shape="cube",
                        is_static=True,
                        collider_type="cuboid",
                    )
                )

            provenance.append(
                ParameterProvenance(
                    field_name="static_hazards.count",
                    provenance="EXPLICIT_USER",
                    rationale=f"User explicitly requested {n_boxes} physical box obstacles",
                    original_extracted_value=str(n_boxes),
                )
            )
            provenance.append(
                ParameterProvenance(
                    field_name="static_hazards.positions",
                    provenance="SYSTEM_CONSTRAINED",
                    rationale=f"Calculated {n_boxes} collision-free positions along navigation path",
                    original_extracted_value=str([[h.position[0], h.position[2]] for h in static_hazards]),
                )
            )

        # 2. Barriers
        n_barriers = entity_counts.get("barrier", 0)
        if n_barriers > 0:
            cx = corridor_x if is_corridor_explicit else 0.0
            cid = corridor_id if is_corridor_explicit else "aisle-2"
            cname = corridor_name if is_corridor_explicit else "Aisle 2 (Center Crossing)"

            z_start = -5.0
            z_end = 5.0
            step_z = (z_end - z_start) / max(1, n_barriers - 1) if n_barriers > 1 else 0.0

            for i in range(n_barriers):
                bz = round(z_start + i * step_z, 2) if n_barriers > 1 else 0.0
                static_hazards.append(
                    StaticHazardDefinition(
                        id=f"barrier-{cid}-{i+1}",
                        hazard_type="barrier",
                        name=f"{cname} Barrier {i+1}",
                        position=[cx, 0.55, bz],
                        size=[2.40, 1.10, 0.40],
                        rotation_rad=0.0,
                        aisle_id=cid,
                        shape="barrier",
                        is_static=True,
                        collider_type="cuboid",
                    )
                )

            provenance.append(
                ParameterProvenance(
                    field_name="static_hazards.barriers.count",
                    provenance="EXPLICIT_USER",
                    rationale=f"User requested {n_barriers} maintenance barriers across corridor",
                    original_extracted_value=str(n_barriers),
                )
            )

        # 3. Actors: Workers and Forklifts
        n_workers = entity_counts.get("worker", 0)
        n_forklifts = entity_counts.get("forklift", 0)

        if is_blind_corner:
            fk_speed = custom_speed or 1.2
            if n_forklifts > 0:
                for i in range(n_forklifts):
                    actors.append(
                        ActorDefinition(
                            id=f"fk-corner-{i+1}",
                            name=f"Blind Corner Forklift {i+1}",
                            actor_type="forklift",
                            spawn_position=[-6.5, 0.0, -1.0 + i * 2.0],
                            patrol_start=[-6.5, -4.5],
                            patrol_end=[-6.5, 4.5],
                            patrol_speed=fk_speed,
                            initial_heading_rad=0.0,
                            direction=1,
                            role_description="Crossway forklift patrol emerging past blind corner racks",
                        )
                    )
            if n_workers > 0:
                worker_speed = 0.8
                worker_configs = [
                    ("worker-corner-1", "Warehouse Worker Dave", [-10.5, 0.0, 0.0], [-12.0, 0.0], [-8.5, 0.0]),
                    ("worker-corner-2", "Warehouse Worker Sarah", [-6.5, 0.0, 4.5], [-6.5, 2.5], [-6.5, 6.5]),
                    ("worker-corner-3", "Warehouse Worker Alex", [0.0, 0.0, 0.0], [-2.0, 0.0], [2.0, 0.0]),
                ]
                for i in range(n_workers):
                    cfg = worker_configs[i % len(worker_configs)]
                    w_id = f"{cfg[0]}-{i+1}" if i >= len(worker_configs) else cfg[0]
                    p_start = list(cfg[3])
                    p_end = list(cfg[4])
                    heading = math.atan2(p_end[0] - p_start[0], p_end[1] - p_start[1])
                    actors.append(
                        ActorDefinition(
                            id=w_id,
                            name=f"{cfg[1]}",
                            actor_type="worker",
                            spawn_position=list(cfg[2]),
                            patrol_start=p_start,
                            patrol_end=p_end,
                            patrol_speed=worker_speed,
                            initial_heading_rad=round(heading, 4),
                            direction=1,
                            geometry=ActorGeometry(geometry_type="worker_cylinder", worker=WorkerColliderGeometry()),
                            role_description=f"Pedestrian foot traffic near blind corner intersection #{i+1}",
                        )
                    )
            provenance.append(
                ParameterProvenance(
                    field_name="actors.count",
                    provenance="EXPLICIT_USER",
                    rationale=f"User requested {n_workers} workers and {n_forklifts} forklifts near blind corner",
                    original_extracted_value=f"{n_workers} workers, {n_forklifts} forklifts",
                )
            )

        title = "Natural Language Object Placement"
        desc = "Physically validated obstacle deployment generated from user prompt."
        if n_boxes > 0:
            title = f"{n_boxes} Physical Box Obstacles in Robot Path"
            desc = f"Generated {n_boxes} physically solid cargo boxes along the robot's intended navigation route."
        elif n_barriers > 0:
            title = f"{n_barriers} Maintenance Barriers Across {corridor_name}"
            desc = f"Generated {n_barriers} full-width physical barricades spanning {corridor_name}."
        elif n_workers > 0 or n_forklifts > 0:
            title = f"{n_workers} Workers and {n_forklifts} Forklift near Blind Corner"
            desc = f"Multi-agent adversarial traffic challenge featuring {n_workers} workers and {n_forklifts} industrial forklift."

        for feat in unsupported:
            provenance.append(
                ParameterProvenance(
                    field_name=f"unsupported:{feat}",
                    provenance="SYSTEM_CONSTRAINED",
                    rationale=f"Unsupported simulation feature '{feat}' preserved as explicit warning",
                    original_extracted_value=feat,
                )
            )

        return GeneratedScenario(
            scenario_id=f"SCEN-OBJ-{uuid.uuid4().hex[:6].upper()}",
            title=title,
            description=desc,
            difficulty=diff,
            seed=seed,
            robot_setup=RobotMissionSetup(
                start_position=list(DEFAULT_ROBOT_SPAWN),
                start_rotation_rad=DEFAULT_ROBOT_ROTATION,
                destination_id="bay-4",
                destination_name="BAY 4 DELIVERY DROP-OFF",
                destination_position=list(DESTINATIONS["bay-4"].position),
            ),
            actors=actors,
            static_hazards=static_hazards,
            provenance_audit=provenance,
            unsupported_features=unsupported,
            generator_engine="DETERMINISTIC_PATTERN_FALLBACK",
        )

    @staticmethod
    def _pattern_opposing_forklifts(
        prompt: str,
        diff: str,
        seed: int,
        unsupported: List[str],
        corridor_id: str,
        corridor_name: str,
        corridor_x: float,
        is_corridor_explicit: bool,
        custom_speed: Optional[float],
    ) -> GeneratedScenario:
        """Two forklifts approaching from opposite ends of the designated corridor."""
        fk1_speed = custom_speed or (1.4 if diff == "extreme" else (1.2 if diff == "hard" else 0.9))
        fk2_speed = round(fk1_speed * 0.9, 2) if custom_speed else (1.2 if diff == "extreme" else (1.0 if diff == "hard" else 0.8))

        provenance = [
            ParameterProvenance(
                field_name="scenario.corridor",
                provenance="EXPLICIT_USER" if is_corridor_explicit else "INFERRED_DEFAULT",
                rationale=f"Selected {corridor_name} (X={corridor_x}m) for narrow opposing corridor challenge",
                original_extracted_value=corridor_id if is_corridor_explicit else "narrow aisle",
            ),
            ParameterProvenance(
                field_name="actors.count",
                provenance="EXPLICIT_USER",
                rationale="User requested two opposing forklifts",
                original_extracted_value="2",
            ),
            ParameterProvenance(
                field_name="actors[0].patrol_speed",
                provenance="EXPLICIT_USER" if custom_speed is not None else "INFERRED_DEFAULT",
                rationale=f"Set forklift alpha speed to {fk1_speed} m/s based on {'explicit prompt speed' if custom_speed else 'target difficulty ' + diff}",
                original_extracted_value=f"{custom_speed} m/s" if custom_speed is not None else f"{fk1_speed} m/s",
            ),
            ParameterProvenance(
                field_name="actors[0].spawn_position",
                provenance="SYSTEM_CONSTRAINED",
                rationale=f"Spawned at [{corridor_x}, 0.0, -6.0] with 10.0m separation from opposing forklift",
                original_extracted_value=f"[{corridor_x}, 0.0, -6.0]",
            ),
            ParameterProvenance(
                field_name="actors[1].spawn_position",
                provenance="SYSTEM_CONSTRAINED",
                rationale=f"Spawned at [{corridor_x}, 0.0, 4.0] with 10.0m separation from opposing forklift",
                original_extracted_value=f"[{corridor_x}, 0.0, 4.0]",
            ),
            ParameterProvenance(
                field_name="actors[0].patrol_endpoints",
                provenance="SYSTEM_CONSTRAINED",
                rationale="Endpoints leave >6.5m turnaround clearance to perimeter walls",
                original_extracted_value="Z in [-7.0, 4.0]",
            ),
            ParameterProvenance(
                field_name="actors[1].patrol_endpoints",
                provenance="SYSTEM_CONSTRAINED",
                rationale="Endpoints leave >6.5m turnaround clearance to perimeter walls",
                original_extracted_value="Z in [-5.0, 5.0]",
            ),
        ]
        for feat in unsupported:
            provenance.append(
                ParameterProvenance(
                    field_name=f"unsupported:{feat}",
                    provenance="SYSTEM_CONSTRAINED",
                    rationale=f"Unsupported simulation feature '{feat}' preserved as explicit warning",
                    original_extracted_value=feat,
                )
            )

        return GeneratedScenario(
            scenario_id=f"SCEN-DET-OPPOSING-{uuid.uuid4().hex[:6].upper()}",
            title=f"Opposing Dual Forklifts in {corridor_name}",
            description=f"Two heavy forklifts patrol from opposite ends of {corridor_name}, creating an intense head-to-head passage pinch point for the AMR.",
            difficulty=diff,
            seed=seed,
            robot_setup=RobotMissionSetup(
                start_position=list(DEFAULT_ROBOT_SPAWN),
                start_rotation_rad=DEFAULT_ROBOT_ROTATION,
                destination_id="bay-4",
                destination_name="BAY 4 DELIVERY DROP-OFF",
                destination_position=list(DESTINATIONS["bay-4"].position),
            ),
            actors=[
                ActorDefinition(
                    id="fk-opposing-north",
                    name="Forklift Alpha (Southbound)",
                    actor_type="forklift",
                    spawn_position=[corridor_x, 0.0, -6.0],
                    patrol_start=[corridor_x, -7.0],
                    patrol_end=[corridor_x, 4.0],
                    patrol_speed=fk1_speed,
                    initial_heading_rad=0.0,  # Facing South (+Z)
                    direction=1,
                    role_description=f"Southbound transport through {corridor_name}",
                ),
                ActorDefinition(
                    id="fk-opposing-south",
                    name="Forklift Beta (Northbound)",
                    actor_type="forklift",
                    spawn_position=[corridor_x, 0.0, 4.0],
                    patrol_start=[corridor_x, 5.0],
                    patrol_end=[corridor_x, -5.0],
                    patrol_speed=fk2_speed,
                    initial_heading_rad=math.pi,  # Facing North (-Z)
                    direction=1,
                    role_description=f"Northbound transport through {corridor_name}",
                ),
            ],
            provenance_audit=provenance,
            unsupported_features=unsupported,
            generator_engine="DETERMINISTIC_PATTERN_FALLBACK",
        )

    @staticmethod
    def _pattern_blind_corner_cross(
        prompt: str,
        diff: str,
        seed: int,
        unsupported: List[str],
        corridor_id: str,
        corridor_name: str,
        corridor_x: float,
        is_corridor_explicit: bool,
        custom_speed: Optional[float],
    ) -> GeneratedScenario:
        """Forklift patrolling perpendicular cross gap at Z = 0.0m emerging in front of AMR."""
        speed = custom_speed or (1.3 if diff == "extreme" else (1.1 if diff == "hard" else 0.8))

        # Determine cross corridor endpoints based on corridor
        if corridor_x == 0.0:  # Aisle 2
            start_x, end_x, spawn_x = 1.0, -5.0, 0.0
        elif corridor_x == 6.5:  # Aisle 3
            start_x, end_x, spawn_x = 7.5, 1.5, 6.5
        else:  # Aisle 1 (default)
            start_x, end_x, spawn_x = -6.5, -12.5, -7.5

        provenance = [
            ParameterProvenance(
                field_name="scenario.corridor",
                provenance="EXPLICIT_USER" if is_corridor_explicit else "INFERRED_DEFAULT",
                rationale=f"Selected cross corridor crossing {corridor_name} (Z=0.0m)",
                original_extracted_value=corridor_id if is_corridor_explicit else "blind corner",
            ),
            ParameterProvenance(
                field_name="actors[0].patrol_speed",
                provenance="EXPLICIT_USER" if custom_speed is not None else "INFERRED_DEFAULT",
                rationale=f"Set crossing speed to {speed} m/s",
                original_extracted_value=f"{speed} m/s",
            ),
            ParameterProvenance(
                field_name="actors[0].spawn_position",
                provenance="SYSTEM_CONSTRAINED",
                rationale=f"Positioned at X={spawn_x}m in cross corridor, clear of AMR start pose",
                original_extracted_value=f"[{spawn_x}, 0.0, 0.0]",
            ),
            ParameterProvenance(
                field_name="actors[0].patrol_endpoints",
                provenance="SYSTEM_CONSTRAINED",
                rationale=f"Patrol spans X in [{min(start_x, end_x)}, {max(start_x, end_x)}]",
                original_extracted_value=f"X in [{start_x}, {end_x}]",
            ),
        ]
        for feat in unsupported:
            provenance.append(
                ParameterProvenance(
                    field_name=f"unsupported:{feat}",
                    provenance="SYSTEM_CONSTRAINED",
                    rationale=f"Unsupported simulation feature '{feat}' preserved as explicit warning",
                    original_extracted_value=feat,
                )
            )

        return GeneratedScenario(
            scenario_id=f"SCEN-DET-CORNER-{uuid.uuid4().hex[:6].upper()}",
            title=f"Blind Corner Cross-Traffic at {corridor_name}",
            description=f"A forklift crosses the central corridor perpendicular to {corridor_name}, testing blind-corner collision avoidance.",
            difficulty=diff,
            seed=seed,
            robot_setup=RobotMissionSetup(
                start_position=list(DEFAULT_ROBOT_SPAWN),
                start_rotation_rad=DEFAULT_ROBOT_ROTATION,
                destination_id="bay-4",
                destination_name="BAY 4 DELIVERY DROP-OFF",
                destination_position=list(DESTINATIONS["bay-4"].position),
            ),
            actors=[
                ActorDefinition(
                    id="fk-cross-traffic",
                    name="Perpendicular Cross-Traffic Forklift",
                    actor_type="forklift",
                    spawn_position=[spawn_x, 0.0, 0.0],
                    patrol_start=[start_x, 0.0],
                    patrol_end=[end_x, 0.0],
                    patrol_speed=speed,
                    initial_heading_rad=-math.pi / 2,  # Facing West (-X)
                    direction=1,
                    role_description=f"Crosses corridor at {corridor_name} intersection",
                )
            ],
            provenance_audit=provenance,
            unsupported_features=unsupported,
            generator_engine="DETERMINISTIC_PATTERN_FALLBACK",
        )

    @staticmethod
    def _pattern_crowded_workers(
        prompt: str,
        diff: str,
        seed: int,
        unsupported: List[str],
        corridor_id: str,
        corridor_name: str,
        corridor_x: float,
        is_corridor_explicit: bool,
        custom_speed: Optional[float],
    ) -> GeneratedScenario:
        """Forklift in chosen corridor plus two pedestrian workers in adjacent aisles."""
        fk_speed = custom_speed or 1.2
        worker_speed = round(min(1.0, fk_speed * 0.7), 2)

        # Worker 2 adjacent corridor X
        adj_x = 0.0 if corridor_x != 0.0 else 6.5

        provenance = [
            ParameterProvenance(
                field_name="actors.count",
                provenance="EXPLICIT_USER" if "worker" in prompt.lower() or "people" in prompt.lower() else "INFERRED_DEFAULT",
                rationale="Generated coordinated multi-agent workforce (1 forklift + 2 workers)",
                original_extracted_value="3",
            ),
            ParameterProvenance(
                field_name="scenario.corridor",
                provenance="EXPLICIT_USER" if is_corridor_explicit else "INFERRED_DEFAULT",
                rationale=f"Centered workforce in {corridor_name}",
                original_extracted_value=corridor_id if is_corridor_explicit else "crowded",
            ),
            ParameterProvenance(
                field_name="actors[0].spawn_position",
                provenance="SYSTEM_CONSTRAINED",
                rationale=f"Forklift positioned in North {corridor_name} at Z=-5.0m",
                original_extracted_value=f"[{corridor_x}, 0.0, -5.0]",
            ),
            ParameterProvenance(
                field_name="actors[1].spawn_position",
                provenance="SYSTEM_CONSTRAINED",
                rationale=f"Worker 1 positioned in South {corridor_name} at Z=4.0m",
                original_extracted_value=f"[{corridor_x}, 0.0, 4.0]",
            ),
            ParameterProvenance(
                field_name="actors[2].spawn_position",
                provenance="SYSTEM_CONSTRAINED",
                rationale=f"Worker 2 positioned in adjacent aisle at X={adj_x}m",
                original_extracted_value=f"[{adj_x}, 0.0, 0.0]",
            ),
        ]
        for feat in unsupported:
            provenance.append(
                ParameterProvenance(
                    field_name=f"unsupported:{feat}",
                    provenance="SYSTEM_CONSTRAINED",
                    rationale=f"Unsupported simulation feature '{feat}' preserved as explicit warning",
                    original_extracted_value=feat,
                )
            )

        return GeneratedScenario(
            scenario_id=f"SCEN-DET-CROWD-{uuid.uuid4().hex[:6].upper()}",
            title=f"High-Density Mixed Workforce in {corridor_name}",
            description=f"Coordinated multi-agent challenge in {corridor_name} featuring an active patrol forklift and multiple pedestrian warehouse workers.",
            difficulty=diff,
            seed=seed,
            robot_setup=RobotMissionSetup(
                start_position=list(DEFAULT_ROBOT_SPAWN),
                start_rotation_rad=DEFAULT_ROBOT_ROTATION,
                destination_id="bay-4",
                destination_name="BAY 4 DELIVERY DROP-OFF",
                destination_position=list(DESTINATIONS["bay-4"].position),
            ),
            actors=[
                ActorDefinition(
                    id=f"fk-{corridor_id}",
                    name=f"{corridor_name} Forklift",
                    actor_type="forklift",
                    spawn_position=[corridor_x, 0.0, -5.0],
                    patrol_start=[corridor_x, -7.0],
                    patrol_end=[corridor_x, 1.0],
                    patrol_speed=fk_speed,
                    initial_heading_rad=0.0,
                    direction=1,
                    role_description=f"High-bay replenishment in {corridor_name}",
                ),
                ActorDefinition(
                    id="worker-dave",
                    name="Warehouse Worker Dave",
                    actor_type="worker",
                    spawn_position=[corridor_x, 0.0, 4.0],
                    patrol_start=[corridor_x, 3.5],
                    patrol_end=[corridor_x, 7.5],
                    patrol_speed=worker_speed,
                    initial_heading_rad=0.0,
                    direction=1,
                    geometry=ActorGeometry(geometry_type="worker_cylinder", worker=WorkerColliderGeometry()),
                    role_description=f"Inventory cycle counting in South {corridor_name}",
                ),
                ActorDefinition(
                    id="worker-sarah",
                    name="Warehouse Worker Sarah",
                    actor_type="worker",
                    spawn_position=[adj_x, 0.0, 0.0],
                    patrol_start=[adj_x, -6.0],
                    patrol_end=[adj_x, 6.0],
                    patrol_speed=worker_speed,
                    initial_heading_rad=0.0,
                    direction=1,
                    geometry=ActorGeometry(geometry_type="worker_cylinder", worker=WorkerColliderGeometry()),
                    role_description="Order fulfillment in adjacent aisle",
                ),
            ],
            provenance_audit=provenance,
            unsupported_features=unsupported,
            generator_engine="DETERMINISTIC_PATTERN_FALLBACK",
        )

    @staticmethod
    def _pattern_blocked_corridor(
        prompt: str,
        diff: str,
        seed: int,
        unsupported: List[str],
        corridor_id: str,
        corridor_name: str,
        corridor_x: float,
        is_corridor_explicit: bool,
        custom_speed: Optional[float],
    ) -> GeneratedScenario:
        """Static barrier across transit corridor forcing dynamic detour into adjacent active forklift patrol."""
        fk_speed = custom_speed or 1.3

        # Place barrier in West arterial by default or in chosen corridor
        barrier_pos = [-14.5, 0.0, -5.0] if corridor_x == -14.5 or not is_corridor_explicit else [corridor_x, 0.0, -2.0]
        detour_x = -6.5 if barrier_pos[0] == -14.5 else (0.0 if corridor_x == -6.5 else 6.5)

        provenance = [
            ParameterProvenance(
                field_name="static_hazards[0].position",
                provenance="EXPLICIT_USER" if is_corridor_explicit or "barrier" in prompt.lower() or "block" in prompt.lower() else "INFERRED_DEFAULT",
                rationale=f"Placed barrier at {barrier_pos} to block corridor transit",
                original_extracted_value="barrier",
            ),
            ParameterProvenance(
                field_name="actors[0].spawn_position",
                provenance="SYSTEM_CONSTRAINED",
                rationale=f"Forklift patrolling detour corridor (X={detour_x}m) to test reactive multi-hazard replanning",
                original_extracted_value=f"[{detour_x}, 0.0, -2.0]",
            ),
        ]
        for feat in unsupported:
            provenance.append(
                ParameterProvenance(
                    field_name=f"unsupported:{feat}",
                    provenance="SYSTEM_CONSTRAINED",
                    rationale=f"Unsupported simulation feature '{feat}' preserved as explicit warning",
                    original_extracted_value=feat,
                )
            )

        return GeneratedScenario(
            scenario_id=f"SCEN-DET-BLOCK-{uuid.uuid4().hex[:6].upper()}",
            title=f"Blocked Arterial with Detour Traffic in {corridor_name}",
            description=f"Corridor is physically blocked by maintenance barriers, forcing the AMR to reroute into an active forklift patrol aisle.",
            difficulty=diff,
            seed=seed,
            robot_setup=RobotMissionSetup(
                start_position=list(DEFAULT_ROBOT_SPAWN),
                start_rotation_rad=DEFAULT_ROBOT_ROTATION,
                destination_id="bay-4",
                destination_name="BAY 4 DELIVERY DROP-OFF",
                destination_position=list(DESTINATIONS["bay-4"].position),
            ),
            actors=[
                ActorDefinition(
                    id="fk-detour-patrol",
                    name="Detour Aisle Forklift",
                    actor_type="forklift",
                    spawn_position=[detour_x, 0.0, -2.0],
                    patrol_start=[detour_x, -7.0],
                    patrol_end=[detour_x, 4.0],
                    patrol_speed=fk_speed,
                    initial_heading_rad=0.0,
                    direction=1,
                    role_description=f"Patrols detour route at X={detour_x}m",
                )
            ],
            static_hazards=[
                StaticHazardDefinition(
                    id="barrier-maintenance",
                    name="Transit Maintenance Barrier",
                    hazard_type="barrier",
                    position=barrier_pos,
                    size=[2.8, 0.8, 0.4],
                    rotation_rad=0.0,
                )
            ],
            provenance_audit=provenance,
            unsupported_features=unsupported,
            generator_engine="DETERMINISTIC_PATTERN_FALLBACK",
        )

    @staticmethod
    def _pattern_high_speed_patrol(
        prompt: str,
        diff: str,
        seed: int,
        unsupported: List[str],
        corridor_id: str,
        corridor_name: str,
        corridor_x: float,
        is_corridor_explicit: bool,
        custom_speed: Optional[float],
    ) -> GeneratedScenario:
        """High-speed forklift testing AMR emergency stopping and TTC calculation."""
        speed = custom_speed or 2.0

        provenance = [
            ParameterProvenance(
                field_name="actors[0].patrol_speed",
                provenance="EXPLICIT_USER" if custom_speed is not None or "speed" in prompt.lower() or "fast" in prompt.lower() else "INFERRED_DEFAULT",
                rationale=f"Set forklift speed to {speed} m/s for high-speed dynamic stress testing",
                original_extracted_value=f"{speed} m/s",
            ),
            ParameterProvenance(
                field_name="actors[0].spawn_position",
                provenance="SYSTEM_CONSTRAINED",
                rationale=f"Forklift spawned along corridor X={corridor_x}m, facing North toward oncoming path",
                original_extracted_value=f"[{corridor_x}, 0.0, -4.0]",
            ),
        ]
        for feat in unsupported:
            provenance.append(
                ParameterProvenance(
                    field_name=f"unsupported:{feat}",
                    provenance="SYSTEM_CONSTRAINED",
                    rationale=f"Unsupported simulation feature '{feat}' preserved as explicit warning",
                    original_extracted_value=feat,
                )
            )

        return GeneratedScenario(
            scenario_id=f"SCEN-DET-SPEED-{uuid.uuid4().hex[:6].upper()}",
            title=f"High-Speed Dynamic Head-On Challenge in {corridor_name}",
            description=f"A high-velocity ({speed} m/s) forklift advances along {corridor_name}, testing dynamic Time-to-Collision (TTC) detection and emergency braking.",
            difficulty=diff,
            seed=seed,
            robot_setup=RobotMissionSetup(
                start_position=list(DEFAULT_ROBOT_SPAWN),
                start_rotation_rad=DEFAULT_ROBOT_ROTATION,
                destination_id="bay-4",
                destination_name="BAY 4 DELIVERY DROP-OFF",
                destination_position=list(DESTINATIONS["bay-4"].position),
            ),
            actors=[
                ActorDefinition(
                    id="fk-high-speed",
                    name="High-Speed Patrol Forklift",
                    actor_type="forklift",
                    spawn_position=[corridor_x, 0.0, -4.0],
                    patrol_start=[corridor_x, 4.0],
                    patrol_end=[corridor_x, -5.5],
                    patrol_speed=speed,
                    initial_heading_rad=math.pi,  # Facing North toward oncoming traffic
                    direction=1,
                    role_description=f"Rapid freight transport along {corridor_name}",
                )
            ],
            provenance_audit=provenance,
            unsupported_features=unsupported,
            generator_engine="DETERMINISTIC_PATTERN_FALLBACK",
        )

    @staticmethod
    def _pattern_baseline_adversarial(
        prompt: str,
        diff: str,
        seed: int,
        unsupported: List[str],
        corridor_id: str,
        corridor_name: str,
        corridor_x: float,
        is_corridor_explicit: bool,
        custom_speed: Optional[float],
    ) -> GeneratedScenario:
        """Default baseline adversarial scenario with patrol forklift in designated corridor."""
        speed = custom_speed or 1.2

        provenance = [
            ParameterProvenance(
                field_name="scenario.corridor",
                provenance="EXPLICIT_USER" if is_corridor_explicit else "INFERRED_DEFAULT",
                rationale=f"Selected {corridor_name} operational corridor",
                original_extracted_value=corridor_id if is_corridor_explicit else None,
            ),
            ParameterProvenance(
                field_name="actors[0].spawn_position",
                provenance="SYSTEM_CONSTRAINED",
                rationale=f"Positioned safely inside {corridor_name} at Z=-2.0m",
                original_extracted_value=f"[{corridor_x}, 0.0, -2.0]",
            ),
        ]
        if custom_speed is not None:
            provenance.append(
                ParameterProvenance(
                    field_name="actors[0].patrol_speed",
                    provenance="EXPLICIT_USER",
                    rationale=f"Configured custom speed {speed} m/s",
                    original_extracted_value=f"{speed} m/s",
                )
            )
        for feat in unsupported:
            provenance.append(
                ParameterProvenance(
                    field_name=f"unsupported:{feat}",
                    provenance="SYSTEM_CONSTRAINED",
                    rationale=f"Unsupported simulation feature '{feat}' preserved as explicit warning",
                    original_extracted_value=feat,
                )
            )

        return GeneratedScenario(
            scenario_id=f"SCEN-DET-BASE-{uuid.uuid4().hex[:6].upper()}",
            title=f"Adversarial Warehouse Transit in {corridor_name}",
            description=f"Standard adversarial test scenario introducing active forklift traffic along {corridor_name}.",
            difficulty=diff,
            seed=seed,
            robot_setup=RobotMissionSetup(
                start_position=list(DEFAULT_ROBOT_SPAWN),
                start_rotation_rad=DEFAULT_ROBOT_ROTATION,
                destination_id="bay-4",
                destination_name="BAY 4 DELIVERY DROP-OFF",
                destination_position=list(DESTINATIONS["bay-4"].position),
            ),
            actors=[
                ActorDefinition(
                    id="fk-baseline",
                    name=f"{corridor_name} Forklift",
                    actor_type="forklift",
                    spawn_position=[corridor_x, 0.0, -2.0],
                    patrol_start=[corridor_x, -7.0],
                    patrol_end=[corridor_x, 4.0],
                    patrol_speed=speed,
                    initial_heading_rad=0.0,
                    direction=1,
                    role_description=f"General pallet moving in {corridor_name}",
                )
            ],
            static_hazards=[],
            provenance_audit=provenance,
            unsupported_features=unsupported,
            generator_engine="DETERMINISTIC_PATTERN_FALLBACK",
        )


# ==============================================================================
# MAIN SCENARIO SERVICE
# ==============================================================================

class ScenarioService:
    """
    Public service handling end-to-end scenario generation, provider fallback,
    unsupported feature audit warnings, and physical geometry validation.
    """

    def generate_scenario(self, req: ScenarioGenerateRequest) -> ScenarioGenerateResponse:
        prompt = req.prompt.strip()
        unsupported = detect_unsupported_features(prompt)

        scenario: Optional[GeneratedScenario] = None

        # 1. Attempt Gemini 1.5 Flash if API key is present
        api_key = os.environ.get("GEMINI_API_KEY")
        if api_key:
            scenario = call_gemini_scenario_generator(
                prompt=prompt,
                preferred_corridor=req.preferred_corridor,
                difficulty=req.difficulty,
                api_key=api_key,
            )

        # 2. If Gemini unavailable, timed out, or produced invalid geometry, use deterministic fallback
        if not scenario:
            scenario = DeterministicScenarioEngine.generate(
                prompt=prompt,
                preferred_corridor=req.preferred_corridor,
                difficulty=req.difficulty,
                unsupported_features=unsupported,
            )

        # 3. Always run authoritative Step 1 physical validation
        val_res = scenario_validator.validate_scenario(scenario)

        # 4. Attach non-blocking warnings for any detected unsupported features
        for feat in unsupported:
            val_res.issues.append(
                ValidationIssue(
                    severity="WARNING",
                    code="UNSUPPORTED_FEATURE_REQUESTED",
                    message=(
                        f"Requested feature '{feat}' is not supported by the ground AMR physical simulation. "
                        "The scenario was constructed without inventing unsupported visual assets."
                    ),
                    details={"unsupported_feature": feat},
                )
            )

        # 5. Authoritative Guardrail: If output fails physical validation,
        # return an explicit structured error rather than returning an invalid scenario
        if not val_res.is_valid:
            raise ScenarioPhysicalValidationError(val_res)

        return ScenarioGenerateResponse(scenario=scenario, validation=val_res)

    def validate_scenario(self, req: ScenarioValidateRequest) -> ScenarioValidateResponse:
        """Directly runs the Step 1 physical footprint validator against any supplied scenario."""
        val_res = scenario_validator.validate_scenario(req.scenario)
        return ScenarioValidateResponse(validation=val_res)


# Global singleton instance
scenario_service = ScenarioService()
