"""
Unit and Integration Tests for Scenario Validator & Shared Geometry Contract
ROBOTRISK AI — PHASE 5.5C (Step 1 Verification)
"""

import math
import re
from pathlib import Path
import pytest
from backend.app.models.warehouse_geometry import (
    WAREHOUSE_TOTAL_BOUNDS,
    WAREHOUSE_NAVIGABLE_BOUNDS,
    DEFAULT_ROBOT_SPAWN,
    DEFAULT_ROBOT_ROTATION,
    STATIC_OBSTACLES,
    AISLES,
    DESTINATIONS,
    StaticObstacleAABB,
)
from backend.app.schemas.scenario import (
    GeneratedScenario,
    ActorDefinition,
    StaticHazardDefinition,
    RobotMissionSetup,
    ForkliftCompoundColliderGeometry,
    WorkerColliderGeometry,
    ActorGeometry,
)
from backend.app.services.scenario_validator import (
    scenario_validator,
    get_forklift_obb_corners,
    polygons_intersect_sat,
    compute_swept_path_polygon,
)

# ==============================================================================
# TEST SUITE 1: DYNAMIC PARITY WITH ACTUAL FRONTEND CONFIG & GRIDMAP FILES
# ==============================================================================

class TestActualFrontendBackendParity:
    """
    Directly reads and parses frontend/src/simulation/environments/warehouseConfig.ts
    and frontend/src/navigation/GridMap.ts from disk.
    Guarantees sub-centimetre geometric parity between backend contract and active
    frontend definitions without using separately hardcoded duplicate constants.
    """

    @pytest.fixture(autouse=True)
    def load_frontend_files(self):
        project_root = Path(__file__).resolve().parent.parent.parent
        self.wh_config_path = project_root / "frontend" / "src" / "simulation" / "environments" / "warehouseConfig.ts"
        self.grid_map_path = project_root / "frontend" / "src" / "navigation" / "GridMap.ts"

        assert self.wh_config_path.exists(), f"Missing frontend config: {self.wh_config_path}"
        assert self.grid_map_path.exists(), f"Missing frontend GridMap: {self.grid_map_path}"

        self.wh_text = self.wh_config_path.read_text(encoding="utf-8")
        self.gm_text = self.grid_map_path.read_text(encoding="utf-8")

    def test_warehouse_dimensions_and_bounds_parity(self):
        """Verifies warehouse width and length directly from warehouseConfig.ts match WAREHOUSE_TOTAL_BOUNDS."""
        width_m = float(re.search(r"width:\s*([0-9.]+)", self.wh_text).group(1))
        length_m = float(re.search(r"length:\s*([0-9.]+)", self.wh_text).group(1))

        assert WAREHOUSE_TOTAL_BOUNDS.min_x == -width_m / 2.0
        assert WAREHOUSE_TOTAL_BOUNDS.max_x == width_m / 2.0
        assert WAREHOUSE_TOTAL_BOUNDS.min_z == -length_m / 2.0
        assert WAREHOUSE_TOTAL_BOUNDS.max_z == length_m / 2.0

        # Navigable bounds check: 1m structural wall setback margin
        assert WAREHOUSE_NAVIGABLE_BOUNDS.min_x == WAREHOUSE_TOTAL_BOUNDS.min_x + 1.0
        assert WAREHOUSE_NAVIGABLE_BOUNDS.max_x == WAREHOUSE_TOTAL_BOUNDS.max_x - 1.0
        assert WAREHOUSE_NAVIGABLE_BOUNDS.min_z == WAREHOUSE_TOTAL_BOUNDS.min_z + 1.0
        assert WAREHOUSE_NAVIGABLE_BOUNDS.max_z == WAREHOUSE_TOTAL_BOUNDS.max_z - 1.0

    def test_robot_spawn_and_destination_parity(self):
        """Verifies robotSpawn and deliveryDestination directly from warehouseConfig.ts."""
        # 1. Robot Spawn Pose
        spawn_match = re.search(
            r"robotSpawn:\s*\{[^}]*position:\s*\[([-\d.,\s]+)\],[^}]*rotation:\s*([-\d.]+)",
            self.wh_text,
        )
        assert spawn_match is not None, "Failed to parse robotSpawn from warehouseConfig.ts"
        fe_spawn_pos = tuple(float(x.strip()) for x in spawn_match.group(1).split(","))
        fe_spawn_rot = float(spawn_match.group(2))

        assert DEFAULT_ROBOT_SPAWN == fe_spawn_pos
        assert DEFAULT_ROBOT_ROTATION == fe_spawn_rot

        # 2. Delivery Destination
        dest_match = re.search(
            r"deliveryDestination:\s*\{[^}]*position:\s*\[([-\d.,\s]+)\],[^}]*radius:\s*([0-9.]+),[^}]*name:\s*['\"]([^'\"]+)['\"]",
            self.wh_text,
        )
        assert dest_match is not None, "Failed to parse deliveryDestination from warehouseConfig.ts"
        fe_dest_pos = tuple(float(x.strip()) for x in dest_match.group(1).split(","))
        fe_dest_rad = float(dest_match.group(2))
        fe_dest_name = dest_match.group(3)

        bay4 = DESTINATIONS["bay-4"]
        assert bay4.position == fe_dest_pos
        assert bay4.radius == fe_dest_rad
        assert bay4.name == fe_dest_name

    def test_aisle_definitions_direct_parity(self):
        """Parses all aisles from warehouseConfig.ts and checks 1-to-1 match with AISLES."""
        aisle_matches = re.findall(
            r"\{\s*id:\s*['\"]([^'\"]+)['\"],\s*name:\s*['\"]([^'\"]+)['\"],\s*start:\s*\[([-\d.,\s]+)\],\s*end:\s*\[([-\d.,\s]+)\],\s*width:\s*([0-9.]+)",
            self.wh_text,
        )
        assert len(aisle_matches) == len(AISLES) == 7

        for a_id, a_name, a_start, a_end, a_w in aisle_matches:
            assert a_id in AISLES, f"Aisle {a_id} present in frontend but missing in backend contract"
            aisle_def = AISLES[a_id]
            assert aisle_def.name == a_name
            assert aisle_def.start == tuple(float(x.strip()) for x in a_start.split(","))
            assert aisle_def.end == tuple(float(x.strip()) for x in a_end.split(","))
            assert aisle_def.width == float(a_w)

    def test_all_17_static_obstacles_direct_parity_with_gridmap(self):
        """
        Parses all static obstacle boxes from GridMap.ts initializeStaticWarehouseObstacles()
        (walls, double-bay storage racks, charging dock backstop, staging pallet stacks)
        and verifies that every single physical obstacle matches STATIC_OBSTACLES in backend.
        """
        # 1. Parse direct markObstacleBox calls
        direct_boxes = re.findall(
            r"this\.markObstacleBox\(\s*\{\s*minX:\s*([-\d.]+),\s*maxX:\s*([-\d.]+),\s*minZ:\s*([-\d.]+),\s*maxZ:\s*([-\d.]+),\s*name:\s*['\"]([^'\"]+)['\"]",
            self.gm_text,
        )
        # 2. Parse rackRows loop
        rack_rows = re.findall(r"\{\s*x:\s*([-\d.]+),\s*name:\s*['\"]([^'\"]+)['\"]\s*\}", self.gm_text)

        fe_obstacles = []
        for b in direct_boxes:
            fe_obstacles.append({
                "name": b[4],
                "min_x": float(b[0]),
                "max_x": float(b[1]),
                "min_z": float(b[2]),
                "max_z": float(b[3]),
            })

        for r in rack_rows:
            rx = float(r[0])
            rname = r[1]
            fe_obstacles.append({
                "name": f"{rname} North Rack",
                "min_x": round(rx - 0.7, 2),
                "max_x": round(rx + 0.7, 2),
                "min_z": -7.75,
                "max_z": -1.25,
            })
            fe_obstacles.append({
                "name": f"{rname} South Rack",
                "min_x": round(rx - 0.7, 2),
                "max_x": round(rx + 0.7, 2),
                "min_z": 1.25,
                "max_z": 7.75,
            })

        # Confirm exact count of 17 physical obstacles
        assert len(fe_obstacles) == len(STATIC_OBSTACLES) == 17

        # Confirm 1-to-1 sub-centimetre geometric match
        for fe_obs in fe_obstacles:
            match = next(
                (
                    o for o in STATIC_OBSTACLES
                    if abs(o.min_x - fe_obs["min_x"]) < 1e-3 and
                       abs(o.max_x - fe_obs["max_x"]) < 1e-3 and
                       abs(o.min_z - fe_obs["min_z"]) < 1e-3 and
                       abs(o.max_z - fe_obs["max_z"]) < 1e-3
                ),
                None,
            )
            assert match is not None, (
                f"Frontend obstacle '{fe_obs['name']}' [{fe_obs['min_x']}, {fe_obs['max_x']}, "
                f"{fe_obs['min_z']}, {fe_obs['max_z']}] not matched in backend STATIC_OBSTACLES"
            )

# ==============================================================================
# TEST SUITE 2: FORKLIFT COMPOUND COLLIDER OBB ACCURACY
# ==============================================================================

class TestForkliftColliderFootprint:
    """Verifies that forklift compound collider geometry matches Rapier cuboids."""

    def test_forklift_obb_dimensions(self):
        geom = ForkliftCompoundColliderGeometry()
        assert geom.overall_width == 1.00
        assert geom.overall_length == 2.30
        assert geom.rear_extent_z == 0.80
        assert geom.front_extent_z == 1.50

    def test_forklift_corners_facing_north_zero_yaw(self):
        # Position at (0, 0), yaw = 0 (facing +Z)
        corners = get_forklift_obb_corners(0.0, 0.0, 0.0)
        # Rear-left, Rear-right, Front-right, Front-left
        assert pytest.approx(corners[0][0], 1e-4) == -0.50
        assert pytest.approx(corners[0][1], 1e-4) == -0.80
        assert pytest.approx(corners[1][0], 1e-4) == 0.50
        assert pytest.approx(corners[1][1], 1e-4) == -0.80
        assert pytest.approx(corners[2][0], 1e-4) == 0.50
        assert pytest.approx(corners[2][1], 1e-4) == 1.50
        assert pytest.approx(corners[3][0], 1e-4) == -0.50
        assert pytest.approx(corners[3][1], 1e-4) == 1.50

    def test_forklift_corners_facing_east_half_pi_yaw(self):
        # Position at (0, 0), yaw = pi/2 (facing +X)
        corners = get_forklift_obb_corners(0.0, 0.0, math.pi / 2)
        # Front tips should now point along +X at X = 1.50
        front_x_vals = [corners[2][0], corners[3][0]]
        assert all(pytest.approx(x, 1e-4) == 1.50 for x in front_x_vals)

# ==============================================================================
# TEST SUITE 3: PHYSICAL FOOTPRINT & RACK COLLISION VALIDATION
# ==============================================================================

class TestFootprintAndRackCollision:
    """Verifies physical footprint collision testing against warehouse geometry."""

    def _create_base_scenario(self) -> GeneratedScenario:
        return GeneratedScenario(
            scenario_id="SCEN-TEST-001",
            title="Base Test Scenario",
            description="Unit test scenario definition",
            environment="warehouse",
            difficulty="extreme",
            seed=12345,
            robot_setup=RobotMissionSetup(
                start_position=[-14.5, 0.22, -10.5],
                start_rotation_rad=0.0,
                destination_id="bay-4",
                destination_name="BAY 4 DELIVERY DROP-OFF",
                destination_position=[14.0, 0.0, 10.5],
            ),
            actors=[],
            static_hazards=[],
            provenance_audit=[],
            unsupported_features=[],
            generator_engine="DETERMINISTIC_PATTERN_FALLBACK",
        )

    def test_forklift_valid_in_aisle_1(self):
        scenario = self._create_base_scenario()
        scenario.actors.append(
            ActorDefinition(
                id="fk-1",
                name="Aisle 1 Forklift",
                actor_type="forklift",
                spawn_position=[-6.5, 0.0, -4.0],
                patrol_start=[-6.5, -8.0],
                patrol_end=[-6.5, 6.0],
                patrol_speed=1.4,
                initial_heading_rad=0.0,  # Facing +Z
                direction=1,
            )
        )
        res = scenario_validator.validate_scenario(scenario)
        assert res.is_valid is True
        assert len([i for i in res.issues if i.severity == "ERROR"]) == 0

    def test_forklift_spawn_inside_rack_bay_a_fails(self):
        scenario = self._create_base_scenario()
        # Row A rack is at X in [-3.95, -2.55], Z in [-7.75, -1.25]
        # Place forklift directly overlapping Row A North rack at [-3.25, 0.0, -4.0]
        scenario.actors.append(
            ActorDefinition(
                id="fk-bad",
                name="Illegal Rack Forklift",
                actor_type="forklift",
                spawn_position=[-3.25, 0.0, -4.0],
                patrol_start=[-3.25, -6.0],
                patrol_end=[-3.25, -2.0],
                patrol_speed=1.0,
                initial_heading_rad=0.0,
                direction=1,
            )
        )
        res = scenario_validator.validate_scenario(scenario)
        assert res.is_valid is False
        error_codes = [i.code for i in res.issues if i.severity == "ERROR"]
        assert "FORKLIFT_SPAWN_COLLIDES_RACK" in error_codes

    def test_forklift_out_of_bounds_fails(self):
        scenario = self._create_base_scenario()
        # Spawn outside perimeter wall at X = -19.5
        scenario.actors.append(
            ActorDefinition(
                id="fk-oob",
                name="OOB Forklift",
                actor_type="forklift",
                spawn_position=[-19.2, 0.0, 0.0],
                patrol_start=[-19.2, -2.0],
                patrol_end=[-19.2, 2.0],
                patrol_speed=1.0,
                initial_heading_rad=0.0,
                direction=1,
            )
        )
        res = scenario_validator.validate_scenario(scenario)
        assert res.is_valid is False
        error_codes = [i.code for i in res.issues if i.severity == "ERROR"]
        assert "FORKLIFT_FOOTPRINT_OUT_OF_BOUNDS" in error_codes

# ==============================================================================
# TEST SUITE 4: SWEPT PATROL PATH VALIDATION
# ==============================================================================

class TestSweptPatrolPathValidation:
    """
    Verifies that swept patrol paths and endpoint reversals crossing static obstacles,
    storage racks, perimeter walls, and static hazards are rejected.
    Specifically validates the asymmetric forklift footprint (rear: -0.80m, front: +1.50m)
    across 180° turnaround headings at both patrol_start and patrol_end.
    """

    def test_swept_path_cutting_across_storage_rack_fails(self):
        scenario = GeneratedScenario(
            scenario_id="SCEN-TEST-002",
            title="Swept Path Test",
            description="Testing swept volume collision",
            seed=123,
            robot_setup=RobotMissionSetup(
                start_position=[-14.5, 0.22, -10.5],
                destination_id="bay-4",
                destination_name="Bay 4",
                destination_position=[14.0, 0.0, 10.5],
            ),
            actors=[
                ActorDefinition(
                    id="fk-swept-bad",
                    name="Crashing Forklift",
                    actor_type="forklift",
                    # Patrol from Aisle 1 (X=-6.5) to Aisle 2 (X=0.0) across Row A rack (X=-3.25)
                    spawn_position=[-6.5, 0.0, -4.0],
                    patrol_start=[-6.5, -4.0],
                    patrol_end=[0.0, -4.0],
                    patrol_speed=1.2,
                    initial_heading_rad=math.pi / 2,  # Facing +X
                    direction=1,
                )
            ],
            provenance_audit=[],
            unsupported_features=[],
            generator_engine="DETERMINISTIC_PATTERN_FALLBACK",
        )
        res = scenario_validator.validate_scenario(scenario)
        assert res.is_valid is False
        error_codes = [i.code for i in res.issues if i.severity == "ERROR"]
        assert "SWEPT_PATH_COLLIDES_RACK" in error_codes

    def test_forklift_asymmetric_reversal_at_patrol_start_collides_with_storage_rack(self):
        """
        Tests the asymmetric footprint reversal trap:
        - Forklift patrols West: start [-5.2, -4.5] to end [-7.2, -4.5], heading West (-pi/2).
        - Forward at start: rear extends East to -4.40m, clear of Row A North Rack (starts at -3.95m).
        - Forward at end: front forks extend West to -8.70m, clear of Row D North Rack (starts at -9.05m).
        - BUT when reversing at start: heading rotates 180° to East (+pi/2).
          Front forks extend East by +1.50m to X = -3.70m, penetrating Row A North Rack [-3.95, -2.55].
        """
        scenario = GeneratedScenario(
            scenario_id="SCEN-TEST-REV-START-RACK",
            title="Asymmetric Reversal Collision with Storage Rack",
            description="Testing reversal orientation collision at patrol_start",
            seed=101,
            robot_setup=RobotMissionSetup(
                start_position=[-14.5, 0.22, -10.5],
                destination_id="bay-4",
                destination_name="Bay 4",
                destination_position=[14.0, 0.0, 10.5],
            ),
            actors=[
                ActorDefinition(
                    id="fk-asym-rack",
                    name="Rack Reversing Forklift",
                    actor_type="forklift",
                    spawn_position=[-6.0, 0.0, -4.5],
                    patrol_start=[-5.2, -4.5],
                    patrol_end=[-7.2, -4.5],
                    patrol_speed=1.2,
                    initial_heading_rad=-math.pi / 2,  # Facing West
                    direction=1,
                )
            ],
            provenance_audit=[],
            unsupported_features=[],
            generator_engine="DETERMINISTIC_PATTERN_FALLBACK",
        )
        res = scenario_validator.validate_scenario(scenario)
        assert res.is_valid is False

        error_codes = [i.code for i in res.issues if i.severity == "ERROR"]
        assert "FORKLIFT_ENDPOINT_REVERSAL_COLLISION" in error_codes
        assert "SWEPT_PATH_COLLIDES_RACK" in error_codes

        reversal_issues = [
            i for i in res.issues
            if i.code == "FORKLIFT_ENDPOINT_REVERSAL_COLLISION" and i.details.get("endpoint") == "patrol_start"
        ]
        assert len(reversal_issues) > 0
        assert "Row A North Storage Rack" in reversal_issues[0].details.get("obstacle", "")

    def test_forklift_asymmetric_reversal_at_patrol_start_collides_with_dock_backstop(self):
        """
        Tests reversal at start near Charging Dock Backstop [-16.2, -14.8] x [-12.4, -11.6]:
        - Forklift patrols South from [-15.0, -10.5] to [-15.0, 0.0] facing South (yaw 0.0).
        - Forward at start: rear extends North to Z = -11.30m (safe from dock backstop max_z -11.6m).
        - Reversal at start: heading rotates 180° to North (yaw pi).
          Front forks extend North by +1.50m to Z = -12.00m, penetrating directly into the backstop.
        """
        scenario = GeneratedScenario(
            scenario_id="SCEN-TEST-REV-START-DOCK",
            title="Dock Reversal Collision",
            description="Testing reversal orientation collision with dock backstop",
            seed=102,
            robot_setup=RobotMissionSetup(
                start_position=[-14.5, 0.22, -10.5],
                destination_id="bay-4",
                destination_name="Bay 4",
                destination_position=[14.0, 0.0, 10.5],
            ),
            actors=[
                ActorDefinition(
                    id="fk-dock-rev",
                    name="Dock Reversing Forklift",
                    actor_type="forklift",
                    spawn_position=[-15.0, 0.0, -8.0],
                    patrol_start=[-15.0, -10.5],
                    patrol_end=[-15.0, 0.0],
                    patrol_speed=1.2,
                    initial_heading_rad=0.0,  # Facing South
                    direction=1,
                )
            ],
            provenance_audit=[],
            unsupported_features=[],
            generator_engine="DETERMINISTIC_PATTERN_FALLBACK",
        )
        res = scenario_validator.validate_scenario(scenario)
        assert res.is_valid is False

        error_codes = [i.code for i in res.issues if i.severity == "ERROR"]
        assert "FORKLIFT_ENDPOINT_REVERSAL_COLLISION" in error_codes
        assert "SWEPT_PATH_COLLIDES_RACK" in error_codes

        reversal_issues = [
            i for i in res.issues
            if i.code == "FORKLIFT_ENDPOINT_REVERSAL_COLLISION" and "Charging Dock Backstop" in i.details.get("obstacle", "")
        ]
        assert len(reversal_issues) > 0

    def test_forklift_forward_arrival_at_patrol_end_collides_with_wall(self):
        """
        Tests forward arrival at patrol_end near North Perimeter Wall [-20, 20] x [-16.5, -15.2]:
        - Forklift patrols North along Aisle 1 from [-6.5, -6.0] to [-6.5, -13.8] facing North (yaw pi).
        - At patrol_end [-6.5, -13.8], front forks extend North by +1.50m to Z = -15.30m.
        - Z = -15.30m penetrates into North Perimeter Wall and exceeds navigable bounds (min_z = -15.0m).
        """
        scenario = GeneratedScenario(
            scenario_id="SCEN-TEST-WALL-COLLISION",
            title="Wall Collision at Patrol End",
            description="Testing fork penetration into perimeter wall",
            seed=103,
            robot_setup=RobotMissionSetup(
                start_position=[-14.5, 0.22, -10.5],
                destination_id="bay-4",
                destination_name="Bay 4",
                destination_position=[14.0, 0.0, 10.5],
            ),
            actors=[
                ActorDefinition(
                    id="fk-wall-crash",
                    name="North Wall Crashing Forklift",
                    actor_type="forklift",
                    spawn_position=[-6.5, 0.0, -8.0],
                    patrol_start=[-6.5, -6.0],
                    patrol_end=[-6.5, -13.8],
                    patrol_speed=1.2,
                    initial_heading_rad=math.pi,  # Facing North
                    direction=1,
                )
            ],
            provenance_audit=[],
            unsupported_features=[],
            generator_engine="DETERMINISTIC_PATTERN_FALLBACK",
        )
        res = scenario_validator.validate_scenario(scenario)
        assert res.is_valid is False

        error_codes = [i.code for i in res.issues if i.severity == "ERROR"]
        assert (
            "FORKLIFT_ENDPOINT_REVERSAL_COLLISION" in error_codes
            or "FORKLIFT_ENDPOINT_REVERSAL_OUT_OF_BOUNDS" in error_codes
        )

    def test_forklift_reversal_at_patrol_end_collides_with_static_hazard(self):
        """
        Tests reversal at patrol_end colliding with a static hazard behind the endpoint:
        - Static hazard placed at [-6.5, 0.0, 0.50] with width 1.0m, length 0.50m (Z in [0.25, 0.75]).
        - Forklift patrols South from [-6.5, 1.0] to [-6.5, 2.0] facing South (yaw 0.0).
        - Forward arrival at patrol_end [ -6.5, 2.0 ]: rear extends North to 2.0 - 0.80 = 1.20m (safe from 0.75m).
        - Reversing at patrol_end: heading turns 180° North (yaw pi).
          Front forks extend North to 2.0 - 1.50 = 0.50m, which collides with the static hazard at Z=0.50m.
        """
        scenario = GeneratedScenario(
            scenario_id="SCEN-TEST-REV-END-HAZARD",
            title="Patrol End Reversal Hazard Collision",
            description="Testing reversal orientation collision at patrol_end",
            seed=104,
            robot_setup=RobotMissionSetup(
                start_position=[-14.5, 0.22, -10.5],
                destination_id="bay-4",
                destination_name="Bay 4",
                destination_position=[14.0, 0.0, 10.5],
            ),
            actors=[
                ActorDefinition(
                    id="fk-end-rev",
                    name="End Reversing Forklift",
                    actor_type="forklift",
                    spawn_position=[-6.5, 0.0, 1.2],
                    patrol_start=[-6.5, 1.0],
                    patrol_end=[-6.5, 2.0],
                    patrol_speed=1.2,
                    initial_heading_rad=0.0,  # Facing South
                    direction=1,
                )
            ],
            static_hazards=[
                StaticHazardDefinition(
                    id="barrier-behind-end",
                    name="Aisle 1 Barrier",
                    hazard_type="barrier",
                    position=[-6.5, 0.0, 0.50],
                    size=[1.0, 0.4, 0.5],
                    rotation_rad=0.0,
                )
            ],
            provenance_audit=[],
            unsupported_features=[],
            generator_engine="DETERMINISTIC_PATTERN_FALLBACK",
        )
        res = scenario_validator.validate_scenario(scenario)
        assert res.is_valid is False

        error_codes = [i.code for i in res.issues if i.severity == "ERROR"]
        assert "FORKLIFT_ENDPOINT_REVERSAL_COLLISION" in error_codes
        assert "SWEPT_PATH_COLLIDES_RACK" in error_codes

        reversal_issues = [
            i for i in res.issues
            if i.code == "FORKLIFT_ENDPOINT_REVERSAL_COLLISION" and i.details.get("endpoint") == "patrol_end"
        ]
        assert len(reversal_issues) > 0
        assert "Aisle 1 Barrier" in reversal_issues[0].details.get("obstacle", "")

    def test_forklift_with_sufficient_endpoint_clearance_and_swept_path_passes(self):
        """
        Tests that a forklift with safe clearances at both endpoints and an unobstructed swept path passes:
        - Forklift patrols Aisle 1 from [-6.5, -7.0] to [-6.5, 4.0] facing South (yaw 0.0).
        - Both endpoints have > 2.0m clearance from perimeter walls and cross obstacles.
        - Forward and reversed orientations at both endpoints are fully clear.
        - Swept hull is completely within the navigable aisle.
        """
        scenario = GeneratedScenario(
            scenario_id="SCEN-TEST-SAFE-PATROL",
            title="Safe Aisle 1 Patrol",
            description="Testing valid forklift patrol with safe endpoints",
            seed=105,
            robot_setup=RobotMissionSetup(
                start_position=[-14.5, 0.22, -10.5],
                destination_id="bay-4",
                destination_name="Bay 4",
                destination_position=[14.0, 0.0, 10.5],
            ),
            actors=[
                ActorDefinition(
                    id="fk-safe",
                    name="Safe Aisle 1 Forklift",
                    actor_type="forklift",
                    spawn_position=[-6.5, 0.0, -2.0],
                    patrol_start=[-6.5, -7.0],
                    patrol_end=[-6.5, 4.0],
                    patrol_speed=1.2,
                    initial_heading_rad=0.0,
                    direction=1,
                )
            ],
            provenance_audit=[],
            unsupported_features=[],
            generator_engine="DETERMINISTIC_PATTERN_FALLBACK",
        )
        res = scenario_validator.validate_scenario(scenario)
        assert res.is_valid is True
        error_codes = [i.code for i in res.issues if i.severity == "ERROR"]
        assert len(error_codes) == 0

# ==============================================================================
# TEST SUITE 5: PAIRWISE ACTOR COLLIDER SEPARATION
# ==============================================================================

class TestPairwiseActorSeparation:
    """Verifies that actor separation is governed by actual physical footprints."""

    def test_two_forklifts_head_to_head_too_close_fails(self):
        # Head to head forklifts along Z axis:
        # Forklift 1 at Z = -2.0 facing +Z (front tips reach Z = -2.0 + 1.50 = -0.50)
        # Forklift 2 at Z = 0.5 facing -Z (front tips reach Z = 0.5 - 1.50 = -1.00)
        # Front tips overlap from Z = -1.00 to -0.50 -> Intersect!
        scenario = GeneratedScenario(
            scenario_id="SCEN-TEST-003",
            title="Head-on Collision Squeeze",
            description="Testing pairwise overlap",
            seed=123,
            robot_setup=RobotMissionSetup(
                start_position=[-14.5, 0.22, -10.5],
                destination_id="bay-4",
                destination_name="Bay 4",
                destination_position=[14.0, 0.0, 10.5],
            ),
            actors=[
                ActorDefinition(
                    id="fk-north",
                    name="Forklift North",
                    actor_type="forklift",
                    spawn_position=[-6.5, 0.0, -2.0],
                    patrol_start=[-6.5, -6.0],
                    patrol_end=[-6.5, 2.0],
                    patrol_speed=1.2,
                    initial_heading_rad=0.0,  # Facing +Z
                    direction=1,
                ),
                ActorDefinition(
                    id="fk-south",
                    name="Forklift South",
                    actor_type="forklift",
                    spawn_position=[-6.5, 0.0, 0.5],
                    patrol_start=[-6.5, 4.0],
                    patrol_end=[-6.5, -4.0],
                    patrol_speed=1.2,
                    initial_heading_rad=math.pi,  # Facing -Z
                    direction=1,
                ),
            ],
            provenance_audit=[],
            unsupported_features=[],
            generator_engine="DETERMINISTIC_PATTERN_FALLBACK",
        )
        res = scenario_validator.validate_scenario(scenario)
        assert res.is_valid is False
        error_codes = [i.code for i in res.issues if i.severity == "ERROR"]
        assert "ACTOR_SPAWN_OVERLAP" in error_codes

    def test_two_forklifts_head_to_head_sufficient_clearance_passes(self):
        # Separated along Z:
        # Forklift 1 at Z = -6.0 facing +Z (tips reach Z = -4.5)
        # Forklift 2 at Z = 4.0 facing -Z (tips reach Z = 2.5)
        # Distance between tips: 7.0m -> Safely separated!
        scenario = GeneratedScenario(
            scenario_id="SCEN-TEST-004",
            title="Properly Separated Dual Forklifts",
            description="Testing safe spawn distance",
            seed=123,
            robot_setup=RobotMissionSetup(
                start_position=[-14.5, 0.22, -10.5],
                destination_id="bay-4",
                destination_name="Bay 4",
                destination_position=[14.0, 0.0, 10.5],
            ),
            actors=[
                ActorDefinition(
                    id="fk-1",
                    name="Forklift 1",
                    actor_type="forklift",
                    spawn_position=[-6.5, 0.0, -6.0],
                    patrol_start=[-6.5, -8.0],
                    patrol_end=[-6.5, 4.0],
                    patrol_speed=1.4,
                    initial_heading_rad=0.0,
                    direction=1,
                ),
                ActorDefinition(
                    id="fk-2",
                    name="Forklift 2",
                    actor_type="forklift",
                    spawn_position=[-6.5, 0.0, 4.0],
                    patrol_start=[-6.5, 6.0],
                    patrol_end=[-6.5, -6.0],
                    patrol_speed=1.2,
                    initial_heading_rad=math.pi,
                    direction=1,
                ),
            ],
            provenance_audit=[],
            unsupported_features=[],
            generator_engine="DETERMINISTIC_PATTERN_FALLBACK",
        )
        res = scenario_validator.validate_scenario(scenario)
        assert res.is_valid is True

# ==============================================================================
# TEST SUITE 6: PATROL CONSISTENCY VALIDATION
# ==============================================================================

class TestPatrolConsistency:
    """Verifies that spawn_position, patrol_start, patrol_end, heading and direction are consistent."""

    def test_spawn_off_patrol_line_fails(self):
        scenario = GeneratedScenario(
            scenario_id="SCEN-TEST-005",
            title="Off-axis Spawn Test",
            description="Testing off-segment spawn detection",
            seed=123,
            robot_setup=RobotMissionSetup(
                start_position=[-14.5, 0.22, -10.5],
                destination_id="bay-4",
                destination_name="Bay 4",
                destination_position=[14.0, 0.0, 10.5],
            ),
            actors=[
                ActorDefinition(
                    id="fk-off-axis",
                    name="Off-axis Forklift",
                    actor_type="forklift",
                    # Patrol line is at X = -6.5, but spawn is at X = -5.5 (1.0m deviation)
                    spawn_position=[-5.5, 0.0, 0.0],
                    patrol_start=[-6.5, -6.0],
                    patrol_end=[-6.5, 6.0],
                    patrol_speed=1.4,
                    initial_heading_rad=0.0,
                    direction=1,
                )
            ],
            provenance_audit=[],
            unsupported_features=[],
            generator_engine="DETERMINISTIC_PATTERN_FALLBACK",
        )
        res = scenario_validator.validate_scenario(scenario)
        assert res.is_valid is False
        error_codes = [i.code for i in res.issues if i.severity == "ERROR"]
        assert "SPAWN_NOT_ON_PATROL_PATH" in error_codes

    def test_heading_direction_mismatch_fails(self):
        scenario = GeneratedScenario(
            scenario_id="SCEN-TEST-006",
            title="Heading Direction Mismatch Test",
            description="Testing reversed heading detection",
            seed=123,
            robot_setup=RobotMissionSetup(
                start_position=[-14.5, 0.22, -10.5],
                destination_id="bay-4",
                destination_name="Bay 4",
                destination_position=[14.0, 0.0, 10.5],
            ),
            actors=[
                ActorDefinition(
                    id="fk-reversed",
                    name="Reversed Heading Forklift",
                    actor_type="forklift",
                    spawn_position=[-6.5, 0.0, 0.0],
                    patrol_start=[-6.5, -6.0],
                    patrol_end=[-6.5, 6.0],
                    patrol_speed=1.4,
                    # Patrol vector goes toward +Z (yaw 0.0), but initial_heading is set to pi (facing -Z)
                    initial_heading_rad=math.pi,
                    direction=1,  # Direction is forward (+1)
                )
            ],
            provenance_audit=[],
            unsupported_features=[],
            generator_engine="DETERMINISTIC_PATTERN_FALLBACK",
        )
        res = scenario_validator.validate_scenario(scenario)
        assert res.is_valid is False
        error_codes = [i.code for i in res.issues if i.severity == "ERROR"]
        assert "HEADING_DIRECTION_INCONSISTENT" in error_codes

# ==============================================================================
# TEST SUITE 7: AMR ADVERSARIAL FORWARD ZONE WARNING
# ==============================================================================

class TestForwardZoneAdversarialWarning:
    """Verifies that an actor directly in the AMR forward path emits a non-blocking WARNING."""

    def test_adversarial_hazard_in_amr_path_emits_warning(self):
        # AMR is at [-14.5, 0.22, -10.5] facing +Z (yaw 0.0)
        # Forklift at [-14.5, 0.0, -8.0] is 2.5m directly ahead along +Z
        scenario = GeneratedScenario(
            scenario_id="SCEN-TEST-007",
            title="Direct Ahead Hazard",
            description="Testing forward hazard warning",
            seed=123,
            robot_setup=RobotMissionSetup(
                start_position=[-14.5, 0.22, -10.5],
                start_rotation_rad=0.0,
                destination_id="bay-4",
                destination_name="Bay 4",
                destination_position=[14.0, 0.0, 10.5],
            ),
            actors=[
                ActorDefinition(
                    id="fk-ahead",
                    name="Forklift Ahead",
                    actor_type="forklift",
                    spawn_position=[-14.5, 0.0, -8.0],
                    patrol_start=[-14.5, -8.0],
                    patrol_end=[-14.5, 2.0],
                    patrol_speed=1.4,
                    initial_heading_rad=0.0,
                    direction=1,
                )
            ],
            provenance_audit=[],
            unsupported_features=[],
            generator_engine="DETERMINISTIC_PATTERN_FALLBACK",
        )
        res = scenario_validator.validate_scenario(scenario)
        # Should be valid (warnings do not block approval)
        assert res.is_valid is True
        warning_codes = [i.code for i in res.issues if i.severity == "WARNING"]
        assert "HAZARD_IN_AMR_FORWARD_PATH" in warning_codes
