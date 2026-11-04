"""
Scenario Physical Footprint & Swept-Path Validator
ROBOTRISK AI — PHASE 5.5C

This module implements rigorous geometric and physical validation for AI-generated scenarios:
- Separating Axis Theorem (SAT) collision checking for Oriented Bounding Boxes (OBB).
- Compound collider footprint evaluation for industrial forklifts (chassis + front forks).
- Capsule / cylinder footprint checking for workers and AMR.
- Swept-volume path validation against all static racks, walls, and warehouse boundaries.
- Consistent patrol phase verification (spawn on segment, progress alpha, heading vs direction).
- Pairwise collider separation enforcement based on actual physical bounds.
"""

import math
from typing import List, Tuple, Dict, Any, Optional
from backend.app.models.warehouse_geometry import (
    WAREHOUSE_TOTAL_BOUNDS,
    WAREHOUSE_NAVIGABLE_BOUNDS,
    STATIC_OBSTACLES,
    AISLES,
    DESTINATIONS,
    Bounds2D,
    StaticObstacleAABB,
)
from backend.app.schemas.scenario import (
    GeneratedScenario,
    ActorDefinition,
    StaticHazardDefinition,
    RobotMissionSetup,
    ValidationIssue,
    ScenarioValidationResult,
    ForkliftCompoundColliderGeometry,
    WorkerColliderGeometry,
    AMRColliderGeometry,
)

# ==============================================================================
# 2D GEOMETRY UTILITIES & SAT (SEPARATING AXIS THEOREM)
# ==============================================================================

Point2D = Tuple[float, float]

def rotate_point_local_to_world(local_x: float, local_z: float, pos_x: float, pos_z: float, yaw_rad: float) -> Point2D:
    """
    Transforms a local coordinate [local_x, local_z] (where +Z is forward, +X is right)
    to warehouse world coordinates given origin [pos_x, pos_z] and yaw rotation in radians.
    """
    cos_t = math.cos(yaw_rad)
    sin_t = math.sin(yaw_rad)
    # Forward vector (+Z local) -> (sin(yaw), cos(yaw)) world
    # Right vector (+X local) -> (cos(yaw), -sin(yaw)) world
    world_x = pos_x + local_x * cos_t + local_z * sin_t
    world_z = pos_z - local_x * sin_t + local_z * cos_t
    return (world_x, world_z)

def get_forklift_obb_corners(pos_x: float, pos_z: float, yaw_rad: float) -> List[Point2D]:
    """
    Returns the 4 world-coordinate corners of the Forklift's bounding OBB.
    Local bounds: Width 1.0m (X in [-0.50, 0.50]), Length 2.30m (Z in [-0.80, 1.50]).
    """
    corners_local = [
        (-0.50, -0.80), # Rear left
        (0.50, -0.80),  # Rear right
        (0.50, 1.50),   # Front right (fork tip)
        (-0.50, 1.50),  # Front left (fork tip)
    ]
    return [rotate_point_local_to_world(lx, lz, pos_x, pos_z, yaw_rad) for lx, lz in corners_local]

def get_static_cube_corners(pos_x: float, pos_z: float, half_w: float, half_l: float, yaw_rad: float = 0.0) -> List[Point2D]:
    """Returns 4 corners of an oriented or axis-aligned cube obstacle."""
    corners_local = [
        (-half_w, -half_l),
        (half_w, -half_l),
        (half_w, half_l),
        (-half_w, half_l),
    ]
    return [rotate_point_local_to_world(lx, lz, pos_x, pos_z, yaw_rad) for lx, lz in corners_local]

def aabb_to_corners(aabb: StaticObstacleAABB) -> List[Point2D]:
    """Returns the 4 corners of an AABB."""
    return [
        (aabb.min_x, aabb.min_z),
        (aabb.max_x, aabb.min_z),
        (aabb.max_x, aabb.max_z),
        (aabb.min_x, aabb.max_z),
    ]

def project_polygon_onto_axis(corners: List[Point2D], axis_x: float, axis_z: float) -> Tuple[float, float]:
    """Projects all vertices of a polygon onto a 2D axis and returns (min_proj, max_proj)."""
    projections = [px * axis_x + pz * axis_z for px, pz in corners]
    return min(projections), max(projections)

def polygons_intersect_sat(poly_a: List[Point2D], poly_b: List[Point2D]) -> bool:
    """
    Separating Axis Theorem (SAT) collision test between two convex 2D polygons.
    Returns True if overlapping, False if separated by at least one axis.
    """
    for polygon in (poly_a, poly_b):
        num_vertices = len(polygon)
        for i in range(num_vertices):
            p1 = polygon[i]
            p2 = polygon[(i + 1) % num_vertices]
            # Edge vector
            edge_x = p2[0] - p1[0]
            edge_z = p2[1] - p1[1]
            # Perpendicular normal axis
            axis_x = -edge_z
            axis_z = edge_x
            length = math.hypot(axis_x, axis_z)
            if length < 1e-8:
                continue
            axis_x /= length
            axis_z /= length

            min_a, max_a = project_polygon_onto_axis(poly_a, axis_x, axis_z)
            min_b, max_b = project_polygon_onto_axis(poly_b, axis_x, axis_z)

            # Check for non-overlapping interval
            if max_a < min_b or max_b < min_a:
                return False  # Separating axis found

    return True  # Overlapping on all axes

def circle_intersects_aabb(center_x: float, center_z: float, radius: float, aabb: StaticObstacleAABB) -> bool:
    """Tests intersection between a 2D circle and an AABB."""
    closest_x = max(aabb.min_x, min(center_x, aabb.max_x))
    closest_z = max(aabb.min_z, min(center_z, aabb.max_z))
    dx = center_x - closest_x
    dz = center_z - closest_z
    return (dx * dx + dz * dz) <= (radius * radius)

def circle_intersects_polygon(center_x: float, center_z: float, radius: float, polygon: List[Point2D]) -> bool:
    """Tests intersection between a 2D circle and an arbitrary convex polygon."""
    # 1. SAT on polygon edges
    num_vertices = len(polygon)
    for i in range(num_vertices):
        p1 = polygon[i]
        p2 = polygon[(i + 1) % num_vertices]
        edge_x = p2[0] - p1[0]
        edge_z = p2[1] - p1[1]
        axis_x = -edge_z
        axis_z = edge_x
        length = math.hypot(axis_x, axis_z)
        if length < 1e-8:
            continue
        axis_x /= length
        axis_z /= length

        min_poly, max_poly = project_polygon_onto_axis(polygon, axis_x, axis_z)
        center_proj = center_x * axis_x + center_z * axis_z
        min_circle = center_proj - radius
        max_circle = center_proj + radius

        if max_poly < min_circle or max_circle < min_poly:
            return False

    # 2. Check closest polygon vertex to circle center
    closest_vertex_dist_sq = min(
        (p[0] - center_x) ** 2 + (p[1] - center_z) ** 2 for p in polygon
    )
    # Check if circle center is inside polygon
    # Point-in-polygon raycasting or winding test
    inside = True
    for i in range(num_vertices):
        p1 = polygon[i]
        p2 = polygon[(i + 1) % num_vertices]
        edge_x = p2[0] - p1[0]
        edge_z = p2[1] - p1[1]
        to_center_x = center_x - p1[0]
        to_center_z = center_z - p1[1]
        cross = edge_x * to_center_z - edge_z * to_center_x
        if cross < -1e-6:
            inside = False
            break

    if inside:
        return True

    return closest_vertex_dist_sq <= (radius * radius)

def compute_bidirectional_swept_path_polygon(
    start_x: float,
    start_z: float,
    end_x: float,
    end_z: float,
    half_width: float,
    rear_ext: float,
    front_ext: float,
    yaw_fwd: float,
    is_asymmetric: bool = True
) -> List[Point2D]:
    """
    Computes the complete swept hull enclosing the actor across its entire
    bidirectional patrol cycle, accounting for turnaround heading reversal.
    For an asymmetric forklift (rear: -0.80m, front: +1.50m), the front forks
    swing and extend in the opposite direction after reversing.
    """
    yaw_rev = (yaw_fwd + math.pi) % (2 * math.pi)

    # State 1: At start position, forward orientation
    corners_start_fwd = [
        rotate_point_local_to_world(-half_width, -rear_ext, start_x, start_z, yaw_fwd),
        rotate_point_local_to_world(half_width, -rear_ext, start_x, start_z, yaw_fwd),
        rotate_point_local_to_world(half_width, front_ext, start_x, start_z, yaw_fwd),
        rotate_point_local_to_world(-half_width, front_ext, start_x, start_z, yaw_fwd),
    ]
    # State 2: At end position, forward orientation (moment of arrival at turnaround)
    corners_end_fwd = [
        rotate_point_local_to_world(-half_width, -rear_ext, end_x, end_z, yaw_fwd),
        rotate_point_local_to_world(half_width, -rear_ext, end_x, end_z, yaw_fwd),
        rotate_point_local_to_world(half_width, front_ext, end_x, end_z, yaw_fwd),
        rotate_point_local_to_world(-half_width, front_ext, end_x, end_z, yaw_fwd),
    ]

    all_points = corners_start_fwd + corners_end_fwd

    if is_asymmetric:
        # State 3: At end position, reversed orientation (turnaround heading back)
        corners_end_rev = [
            rotate_point_local_to_world(-half_width, -rear_ext, end_x, end_z, yaw_rev),
            rotate_point_local_to_world(half_width, -rear_ext, end_x, end_z, yaw_rev),
            rotate_point_local_to_world(half_width, front_ext, end_x, end_z, yaw_rev),
            rotate_point_local_to_world(-half_width, front_ext, end_x, end_z, yaw_rev),
        ]
        # State 4: At start position, reversed orientation (return arrival)
        corners_start_rev = [
            rotate_point_local_to_world(-half_width, -rear_ext, start_x, start_z, yaw_rev),
            rotate_point_local_to_world(half_width, -rear_ext, start_x, start_z, yaw_rev),
            rotate_point_local_to_world(half_width, front_ext, start_x, start_z, yaw_rev),
            rotate_point_local_to_world(-half_width, front_ext, start_x, start_z, yaw_rev),
        ]
        all_points.extend(corners_end_rev + corners_start_rev)

    # Compute 2D Convex Hull (Monotone Chain algorithm)
    points = sorted(set(all_points))
    if len(points) <= 1:
        return points

    def cross_2d(o: Point2D, a: Point2D, b: Point2D) -> float:
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower: List[Point2D] = []
    for p in points:
        while len(lower) >= 2 and cross_2d(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)

    upper: List[Point2D] = []
    for p in reversed(points):
        while len(upper) >= 2 and cross_2d(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)

    return lower[:-1] + upper[:-1]

def compute_swept_path_polygon(start_x: float, start_z: float, end_x: float, end_z: float, half_width: float, rear_ext: float, front_ext: float, yaw: float) -> List[Point2D]:
    """Backwards-compatible swept path helper delegating to compute_bidirectional_swept_path_polygon."""
    return compute_bidirectional_swept_path_polygon(
        start_x, start_z, end_x, end_z, half_width, rear_ext, front_ext, yaw, is_asymmetric=True
    )

# ==============================================================================
# MAIN SCENARIO VALIDATOR
# ==============================================================================

class ScenarioValidator:
    """
    Executes authoritative physical validation of generated scenarios against
    the warehouse geometry contract.
    """

    def __init__(self, static_obstacles: Optional[List[StaticObstacleAABB]] = None):
        self.static_obstacles = static_obstacles or STATIC_OBSTACLES
        self.nav_bounds = WAREHOUSE_NAVIGABLE_BOUNDS

    def validate_scenario(self, scenario: GeneratedScenario) -> ScenarioValidationResult:
        issues: List[ValidationIssue] = []
        tested_footprints = 0
        swept_paths_count = 0

        # 1. Validate Robot Setup
        self._validate_robot_setup(scenario.robot_setup, issues)

        # 2. Validate Actors (Forklifts & Workers)
        for actor in scenario.actors:
            tested_footprints += 1
            self._validate_actor_bounds_and_racks(actor, issues)
            self._validate_actor_patrol_consistency(actor, issues)
            self._validate_actor_swept_path(actor, issues, scenario.static_hazards)
            swept_paths_count += 1

        # 3. Validate Pairwise Actor Clearances
        self._validate_pairwise_actor_separations(scenario.actors, scenario.robot_setup, issues)

        # 4. Validate Static Hazards
        for hazard in scenario.static_hazards:
            tested_footprints += 1
            self._validate_static_hazard(hazard, scenario.robot_setup, issues)

        # 5. Validate Pairwise Static Hazard Separation
        self._validate_pairwise_hazard_separations(scenario.static_hazards, issues)

        is_valid = not any(issue.severity == "ERROR" for issue in issues)

        return ScenarioValidationResult(
            is_valid=is_valid,
            issues=issues,
            tested_footprints_count=tested_footprints,
            swept_path_segments_count=swept_paths_count,
        )

    def _validate_robot_setup(self, robot: RobotMissionSetup, issues: List[ValidationIssue]):
        rx, ry, rz = robot.start_position
        amr_radius = 0.34

        # Check bounds
        if not (self.nav_bounds.min_x <= rx <= self.nav_bounds.max_x and self.nav_bounds.min_z <= rz <= self.nav_bounds.max_z):
            issues.append(
                ValidationIssue(
                    severity="ERROR",
                    code="ROBOT_SPAWN_OUT_OF_BOUNDS",
                    message=f"Robot start position [{rx:.2f}, {rz:.2f}] is outside warehouse boundaries.",
                    details={"position": robot.start_position},
                )
            )

        # Check static rack collisions
        for obstacle in self.static_obstacles:
            if circle_intersects_aabb(rx, rz, amr_radius, obstacle):
                issues.append(
                    ValidationIssue(
                        severity="ERROR",
                        code="ROBOT_SPAWN_IN_OBSTACLE",
                        message=f"Robot start position [{rx:.2f}, {rz:.2f}] collides with {obstacle.name}.",
                        details={"obstacle": obstacle.name},
                    )
                )

        # Check destination distance
        dx = robot.destination_position[0] - rx
        dz = robot.destination_position[2] - rz
        dist_to_goal = math.hypot(dx, dz)
        if dist_to_goal < 1.5:
            issues.append(
                ValidationIssue(
                    severity="ERROR",
                    code="DESTINATION_TOO_CLOSE",
                    message=f"Destination is only {dist_to_goal:.2f}m from robot starting pose (minimum 1.5m required).",
                    details={"distance": dist_to_goal},
                )
            )

    def _validate_actor_bounds_and_racks(self, actor: ActorDefinition, issues: List[ValidationIssue]):
        ax, ay, az = actor.spawn_position
        yaw = actor.initial_heading_rad

        if actor.actor_type == "forklift":
            corners = get_forklift_obb_corners(ax, az, yaw)

            # Bounds check for all 4 corners
            for cx, cz in corners:
                if not (self.nav_bounds.min_x <= cx <= self.nav_bounds.max_x and self.nav_bounds.min_z <= cz <= self.nav_bounds.max_z):
                    issues.append(
                        ValidationIssue(
                            severity="ERROR",
                            code="FORKLIFT_FOOTPRINT_OUT_OF_BOUNDS",
                            message=f"Forklift '{actor.name}' bounding footprint exceeds warehouse boundaries at [{cx:.2f}, {cz:.2f}].",
                            affected_entity_id=actor.id,
                        )
                    )
                    break

            # Static rack collision check (SAT OBB vs AABB)
            for obstacle in self.static_obstacles:
                obs_corners = aabb_to_corners(obstacle)
                if polygons_intersect_sat(corners, obs_corners):
                    issues.append(
                        ValidationIssue(
                            severity="ERROR",
                            code="FORKLIFT_SPAWN_COLLIDES_RACK",
                            message=f"Forklift '{actor.name}' footprint overlaps {obstacle.name} at spawn coordinates [{ax:.2f}, {az:.2f}].",
                            affected_entity_id=actor.id,
                            details={"obstacle": obstacle.name},
                        )
                    )

        elif actor.actor_type == "worker":
            w_radius = 0.30
            if not (self.nav_bounds.min_x <= (ax - w_radius) and (ax + w_radius) <= self.nav_bounds.max_x and
                    self.nav_bounds.min_z <= (az - w_radius) and (az + w_radius) <= self.nav_bounds.max_z):
                issues.append(
                    ValidationIssue(
                        severity="ERROR",
                        code="WORKER_OUT_OF_BOUNDS",
                        message=f"Worker '{actor.name}' cylinder footprint exceeds warehouse boundaries at [{ax:.2f}, {az:.2f}].",
                        affected_entity_id=actor.id,
                    )
                )

            for obstacle in self.static_obstacles:
                if circle_intersects_aabb(ax, az, w_radius, obstacle):
                    issues.append(
                        ValidationIssue(
                            severity="ERROR",
                            code="WORKER_SPAWN_COLLIDES_RACK",
                            message=f"Worker '{actor.name}' overlaps {obstacle.name} at [{ax:.2f}, {az:.2f}].",
                            affected_entity_id=actor.id,
                            details={"obstacle": obstacle.name},
                        )
                    )

    def _validate_actor_patrol_consistency(self, actor: ActorDefinition, issues: List[ValidationIssue]):
        """
        Validates the strict relationship between:
        spawn_position, patrol_start, patrol_end, initial_heading_rad and direction.
        The initial actor position must be consistent with the patrol phase.
        """
        sx, sz = actor.patrol_start
        ex, ez = actor.patrol_end
        px, py, pz = actor.spawn_position
        dir_val = actor.direction

        # 1. Patrol segment length must be >= 1.0m
        dx = ex - sx
        dz = ez - sz
        path_len = math.hypot(dx, dz)
        if path_len < 1.0:
            issues.append(
                ValidationIssue(
                    severity="ERROR",
                    code="PATROL_PATH_TOO_SHORT",
                    message=f"Actor '{actor.name}' patrol path length ({path_len:.2f}m) is less than the 1.0m minimum.",
                    affected_entity_id=actor.id,
                )
            )
            return

        # 2. Check that spawn point lies on the line segment between start and end
        ux = dx / path_len
        uz = dz / path_len
        # Project vector (spawn - start) onto patrol unit vector
        rel_x = px - sx
        rel_z = pz - sz
        proj_len = rel_x * ux + rel_z * uz
        perp_dist = abs(rel_x * uz - rel_z * ux)

        if perp_dist > 0.10:  # Allow 10cm tolerance for numerical rounding
            issues.append(
                ValidationIssue(
                    severity="ERROR",
                    code="SPAWN_NOT_ON_PATROL_PATH",
                    message=f"Actor '{actor.name}' spawn [{px:.2f}, {pz:.2f}] deviates {perp_dist:.2f}m laterally from its patrol segment.",
                    affected_entity_id=actor.id,
                    details={"orthogonal_deviation_m": perp_dist},
                )
            )

        # 3. Check progress parameter alpha in [0.0, 1.0]
        alpha = proj_len / path_len
        if alpha < -0.05 or alpha > 1.05:
            issues.append(
                ValidationIssue(
                    severity="ERROR",
                    code="SPAWN_OUTSIDE_PATROL_ENDPOINTS",
                    message=f"Actor '{actor.name}' spawn is outside its patrol endpoints (progress alpha={alpha:.2f}).",
                    affected_entity_id=actor.id,
                    details={"alpha": alpha},
                )
            )

        # 4. Heading consistency with direction vector
        # If direction == 1, heading must point toward (ex, ez): atan2(dx, dz)
        # If direction == -1, heading must point toward (sx, sz): atan2(-dx, -dz)
        expected_yaw = math.atan2(dx, dz) if dir_val == 1 else math.atan2(-dx, -dz)
        # Normalize angular difference to [-pi, pi]
        angle_diff = (actor.initial_heading_rad - expected_yaw + math.pi) % (2 * math.pi) - math.pi
        if abs(angle_diff) > 0.15:  # Tolerance ~8.5 degrees
            issues.append(
                ValidationIssue(
                    severity="ERROR",
                    code="HEADING_DIRECTION_INCONSISTENT",
                    message=f"Actor '{actor.name}' heading ({math.degrees(actor.initial_heading_rad):.1f}°) does not match patrol direction (expected {math.degrees(expected_yaw):.1f}°).",
                    affected_entity_id=actor.id,
                    details={"angle_diff_deg": math.degrees(angle_diff)},
                )
            )

    def _validate_actor_swept_path(
        self,
        actor: ActorDefinition,
        issues: List[ValidationIssue],
        static_hazards: Optional[List[StaticHazardDefinition]] = None,
    ):
        """
        Validates swept-volume path movement and turnaround endpoints against static obstacles and hazards.
        For asymmetric forklifts (rear: -0.80m, front: +1.50m), both endpoints are tested in BOTH
        forward and reversed orientations to ensure the forklift cannot reverse into a storage rack,
        perimeter wall, or obstacle during any phase of its patrol cycle.
        """
        sx, sz = actor.patrol_start
        ex, ez = actor.patrol_end
        dx = ex - sx
        dz = ez - sz
        path_len = math.hypot(dx, dz)
        if path_len < 1e-4:
            return

        yaw_fwd = math.atan2(dx, dz)
        yaw_rev = math.atan2(-dx, -dz)

        half_w = 0.50 if actor.actor_type == "forklift" else 0.30
        rear_ext = 0.80 if actor.actor_type == "forklift" else 0.30
        front_ext = 1.50 if actor.actor_type == "forklift" else 0.30

        # Build list of static obstacles & hazards to check: (name, corners)
        obstacles_to_check: List[Tuple[str, List[Point2D]]] = [
            (obstacle.name, aabb_to_corners(obstacle)) for obstacle in self.static_obstacles
        ]
        if static_hazards:
            for hazard in static_hazards:
                hx, hy, hz = hazard.position
                hw = 0.40
                hl = 0.40
                if hazard.size:
                    hw = hazard.size[0] / 2.0
                    hl = (hazard.size[2] / 2.0 if len(hazard.size) >= 3 else hazard.size[0] / 2.0)
                h_corners = get_static_cube_corners(hx, hz, hw, hl, hazard.rotation_rad)
                obstacles_to_check.append((f"Static Hazard '{hazard.name}'", h_corners))

        # 1. Endpoint Reversal Validations for Forklifts (Asymmetric footprint in both orientations)
        if actor.actor_type == "forklift":
            endpoint_states = [
                ("patrol_start", sx, sz, yaw_fwd, "departing forward"),
                ("patrol_start", sx, sz, yaw_rev, "reversing at start"),
                ("patrol_end", ex, ez, yaw_fwd, "arriving forward at end"),
                ("patrol_end", ex, ez, yaw_rev, "reversing at end"),
            ]

            for ep_name, px, pz, heading, phase_desc in endpoint_states:
                corners = get_forklift_obb_corners(px, pz, heading)

                # Boundary check at endpoint
                for cx, cz in corners:
                    if not (self.nav_bounds.min_x <= cx <= self.nav_bounds.max_x and
                            self.nav_bounds.min_z <= cz <= self.nav_bounds.max_z):
                        issues.append(
                            ValidationIssue(
                                severity="ERROR",
                                code="FORKLIFT_ENDPOINT_REVERSAL_OUT_OF_BOUNDS",
                                message=(
                                    f"Forklift '{actor.name}' footprint exceeds warehouse boundaries when "
                                    f"{phase_desc} at {ep_name} [{px:.2f}, {pz:.2f}] facing {math.degrees(heading):.1f}°."
                                ),
                                affected_entity_id=actor.id,
                                details={"endpoint": ep_name, "position": [px, pz], "heading_deg": math.degrees(heading)},
                            )
                        )
                        break

                # Static obstacle/hazard collision check at endpoint
                for obs_name, obs_corners in obstacles_to_check:
                    if polygons_intersect_sat(corners, obs_corners):
                        issues.append(
                            ValidationIssue(
                                severity="ERROR",
                                code="FORKLIFT_ENDPOINT_REVERSAL_COLLISION",
                                message=(
                                    f"Forklift '{actor.name}' will collide with {obs_name} when "
                                    f"{phase_desc} at {ep_name} [{px:.2f}, {pz:.2f}] facing {math.degrees(heading):.1f}° "
                                    f"(front forks extend +1.50m / rear extends 0.80m)."
                                ),
                                affected_entity_id=actor.id,
                                details={
                                    "endpoint": ep_name,
                                    "position": [px, pz],
                                    "heading_deg": math.degrees(heading),
                                    "obstacle": obs_name,
                                },
                            )
                        )

        # 2. Complete Bidirectional Swept Envelope Check
        is_asymm = (actor.actor_type == "forklift")
        swept_hull = compute_bidirectional_swept_path_polygon(
            sx, sz, ex, ez, half_w, rear_ext, front_ext, yaw_fwd, is_asymmetric=is_asymm
        )

        for obs_name, obs_corners in obstacles_to_check:
            if polygons_intersect_sat(swept_hull, obs_corners):
                issues.append(
                    ValidationIssue(
                        severity="ERROR",
                        code="SWEPT_PATH_COLLIDES_RACK",
                        message=f"Actor '{actor.name}' swept patrol path traverses through {obs_name}.",
                        affected_entity_id=actor.id,
                        details={"obstacle": obs_name},
                    )
                )

    def _validate_pairwise_actor_separations(self, actors: List[ActorDefinition], robot: RobotMissionSetup, issues: List[ValidationIssue]):
        """
        Validates minimum physical separation between actors and between actors and the AMR.
        Governed by actual collider dimensions, not arbitrary constants.
        """
        rx, ry, rz = robot.start_position
        robot_radius = 0.34
        robot_yaw = robot.start_rotation_rad

        # 1. Actor vs AMR checks
        for actor in actors:
            ax, ay, az = actor.spawn_position
            dist_to_amr = math.hypot(ax - rx, az - rz)

            # Physical collider overlap check at t=0
            if actor.actor_type == "forklift":
                forklift_corners = get_forklift_obb_corners(ax, az, actor.initial_heading_rad)
                if circle_intersects_polygon(rx, rz, robot_radius, forklift_corners):
                    issues.append(
                        ValidationIssue(
                            severity="ERROR",
                            code="SPAWN_COLLIDES_AMR",
                            message=f"Forklift '{actor.name}' collides with AMR robot footprint at spawn [{ax:.2f}, {az:.2f}].",
                            affected_entity_id=actor.id,
                        )
                    )
            elif actor.actor_type == "worker":
                if dist_to_amr <= (robot_radius + 0.30 + 0.10):
                    issues.append(
                        ValidationIssue(
                            severity="ERROR",
                            code="SPAWN_COLLIDES_AMR",
                            message=f"Worker '{actor.name}' collides with AMR robot footprint at spawn.",
                            affected_entity_id=actor.id,
                        )
                    )

            # Check if actor is directly ahead within deliberate hazard warning zone (<= 3.0m)
            dx = ax - rx
            dz = az - rz
            cos_y = math.cos(robot_yaw)
            sin_y = math.sin(robot_yaw)
            z_local = sin_y * dx + cos_y * dz
            x_local = cos_y * dx - sin_y * dz

            if z_local > 0 and abs(x_local) <= 1.0 and dist_to_amr <= 3.5:
                issues.append(
                    ValidationIssue(
                        severity="WARNING",
                        code="HAZARD_IN_AMR_FORWARD_PATH",
                        message=f"Adversarial hazard: '{actor.name}' is positioned {dist_to_amr:.1f}m directly ahead in AMR forward path.",
                        affected_entity_id=actor.id,
                        details={"distance_m": dist_to_amr},
                    )
                )

        # 2. Actor vs Actor pairwise checks
        n = len(actors)
        for i in range(n):
            for j in range(i + 1, n):
                a1 = actors[i]
                a2 = actors[j]

                # Check OBB/Circle intersection at spawn
                if a1.actor_type == "forklift" and a2.actor_type == "forklift":
                    c1 = get_forklift_obb_corners(a1.spawn_position[0], a1.spawn_position[2], a1.initial_heading_rad)
                    c2 = get_forklift_obb_corners(a2.spawn_position[0], a2.spawn_position[2], a2.initial_heading_rad)
                    if polygons_intersect_sat(c1, c2):
                        issues.append(
                            ValidationIssue(
                                severity="ERROR",
                                code="ACTOR_SPAWN_OVERLAP",
                                message=f"Forklifts '{a1.name}' and '{a2.name}' compound colliders intersect at spawn.",
                                affected_entity_id=a1.id,
                                details={"conflicting_actor_id": a2.id},
                            )
                        )
                elif a1.actor_type == "forklift" and a2.actor_type == "worker":
                    c1 = get_forklift_obb_corners(a1.spawn_position[0], a1.spawn_position[2], a1.initial_heading_rad)
                    if circle_intersects_polygon(a2.spawn_position[0], a2.spawn_position[2], 0.30, c1):
                        issues.append(
                            ValidationIssue(
                                severity="ERROR",
                                code="ACTOR_SPAWN_OVERLAP",
                                message=f"Worker '{a2.name}' overlaps forklift '{a1.name}' at spawn.",
                                affected_entity_id=a2.id,
                            )
                        )
                elif a1.actor_type == "worker" and a2.actor_type == "worker":
                    dist = math.hypot(a1.spawn_position[0] - a2.spawn_position[0], a1.spawn_position[2] - a2.spawn_position[2])
                    if dist < 0.65:  # 0.30m + 0.30m + 0.05m
                        issues.append(
                            ValidationIssue(
                                severity="ERROR",
                                code="ACTOR_SPAWN_OVERLAP",
                                message=f"Workers '{a1.name}' and '{a2.name}' spawn cylinders overlap (distance {dist:.2f}m < 0.65m).",
                                affected_entity_id=a1.id,
                            )
                        )

    def _validate_static_hazard(self, hazard: StaticHazardDefinition, robot_setup: Optional[RobotMissionSetup], issues: List[ValidationIssue]):
        hx, hy, hz = hazard.position
        half_w = 0.4
        half_l = 0.4
        if hazard.size:
            half_w = hazard.size[0] / 2.0
            half_l = hazard.size[2] / 2.0 if len(hazard.size) >= 3 else hazard.size[0] / 2.0

        corners = get_static_cube_corners(hx, hz, half_w, half_l, hazard.rotation_rad)

        for cx, cz in corners:
            if not (self.nav_bounds.min_x <= cx <= self.nav_bounds.max_x and self.nav_bounds.min_z <= cz <= self.nav_bounds.max_z):
                issues.append(
                    ValidationIssue(
                        severity="ERROR",
                        code="HAZARD_OUT_OF_BOUNDS",
                        message=f"Static hazard '{hazard.name}' exceeds warehouse boundaries.",
                        affected_entity_id=hazard.id,
                    )
                )
                break

        for obstacle in self.static_obstacles:
            obs_corners = aabb_to_corners(obstacle)
            if polygons_intersect_sat(corners, obs_corners):
                issues.append(
                    ValidationIssue(
                        severity="ERROR",
                        code="HAZARD_COLLIDES_RACK",
                        message=f"Static hazard '{hazard.name}' collides with {obstacle.name}.",
                        affected_entity_id=hazard.id,
                    )
                )

        # Check collision with robot starting pose (prevent spawning obstacle on top of robot)
        if robot_setup:
            rx, _, rz = robot_setup.start_position
            amr_effective_radius = 0.54  # 0.34m chassis + 0.20m margin
            hazard_radius = math.hypot(half_w, half_l)
            dist_to_robot = math.hypot(hx - rx, hz - rz)
            if dist_to_robot < (amr_effective_radius + hazard_radius):
                issues.append(
                    ValidationIssue(
                        severity="ERROR",
                        code="HAZARD_COLLIDES_ROBOT",
                        message=f"Static hazard '{hazard.name}' spawns inside or too close to robot start position (dist: {dist_to_robot:.2f}m).",
                        affected_entity_id=hazard.id,
                    )
                )

    def _validate_pairwise_hazard_separations(self, hazards: List[StaticHazardDefinition], issues: List[ValidationIssue]):
        """Ensure static hazards do not physically overlap each other at spawn."""
        n = len(hazards)
        for i in range(n):
            h1 = hazards[i]
            w1 = (h1.size[0] / 2.0) if h1.size else 0.4
            l1 = (h1.size[2] / 2.0 if h1.size and len(h1.size) >= 3 else (h1.size[0] / 2.0 if h1.size else 0.4))
            c1 = get_static_cube_corners(h1.position[0], h1.position[2], w1, l1, h1.rotation_rad)

            for j in range(i + 1, n):
                h2 = hazards[j]
                w2 = (h2.size[0] / 2.0) if h2.size else 0.4
                l2 = (h2.size[2] / 2.0 if h2.size and len(h2.size) >= 3 else (h2.size[0] / 2.0 if h2.size else 0.4))
                c2 = get_static_cube_corners(h2.position[0], h2.position[2], w2, l2, h2.rotation_rad)

                if polygons_intersect_sat(c1, c2):
                    issues.append(
                        ValidationIssue(
                            severity="ERROR",
                            code="HAZARD_SPAWN_OVERLAP",
                            message=f"Static hazards '{h1.name}' and '{h2.name}' physically overlap at spawn.",
                            affected_entity_id=h1.id,
                            details={"hazard1": h1.id, "hazard2": h2.id},
                        )
                    )

# Global singleton validator instance
scenario_validator = ScenarioValidator()
