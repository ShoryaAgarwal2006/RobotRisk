"""
Scenario Schemas & Physical Collider Models
ROBOTRISK AI — PHASE 5.5C

This module defines Pydantic V2 schemas for AI scenario generation, parameter provenance,
compound physical collider geometries, and physical validation results.
"""

from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any, Literal

# Provenance of individual scenario parameters for transparent human audit
ProvenanceType = Literal["EXPLICIT_USER", "INFERRED_DEFAULT", "SYSTEM_CONSTRAINED"]

class ParameterProvenance(BaseModel):
    field_name: str
    provenance: ProvenanceType
    rationale: Optional[str] = None
    original_extracted_value: Optional[str] = None

# ==============================================================================
# ACTOR PHYSICAL COLLIDER GEOMETRY DEFINITIONS
# ==============================================================================

class ForkliftCompoundColliderGeometry(BaseModel):
    """
    Exact compound Rapier collider representation for industrial forklift:
    1. Main Chassis & Overhead Cage: Half-extents [0.50, 0.95, 0.70] at [0, 0.95, -0.10]
       Span: X in [-0.50, 0.50] (Width 1.00m), Z in [-0.80, 0.60] (Length 1.40m)
    2. Low-Profile Front Forks: Half-extents [0.38, 0.08, 0.45] at [0, 0.08, 1.05]
       Span: X in [-0.38, 0.38] (Width 0.76m), Z in [0.60, 1.50] (Length 0.90m)
    Composite local bounding footprint: Width 1.00m, Length 2.30m (Rear -0.80m, Front +1.50m)
    """
    chassis_width: float = 1.00
    chassis_length: float = 1.40
    chassis_offset_z: float = -0.10
    forks_width: float = 0.76
    forks_length: float = 0.90
    forks_offset_z: float = 1.05
    overall_width: float = 1.00
    overall_length: float = 2.30
    rear_extent_z: float = 0.80
    front_extent_z: float = 1.50

class WorkerColliderGeometry(BaseModel):
    """
    Rapier CapsuleCollider representation for warehouse pedestrian worker:
    Radius 0.30m (diameter 0.60m), height 1.70m (half-height 0.55m + hemispherical caps).
    """
    radius: float = 0.30
    height: float = 1.70

class AMRColliderGeometry(BaseModel):
    """
    Physical differential drive chassis of the AMR robot:
    Radius 0.34m (diameter 0.68m), with nominal physical safety margin 0.20m (total 0.54m).
    """
    chassis_radius: float = 0.34
    safety_margin: float = 0.20
    effective_clearance_radius: float = 0.54

class ActorGeometry(BaseModel):
    geometry_type: Literal["forklift_compound", "worker_cylinder"]
    forklift: Optional[ForkliftCompoundColliderGeometry] = None
    worker: Optional[WorkerColliderGeometry] = None

# ==============================================================================
# SCENARIO ACTORS & HAZARDS
# ==============================================================================

class ActorDefinition(BaseModel):
    id: str
    name: str
    actor_type: Literal["forklift", "worker"]
    spawn_position: List[float] = Field(..., min_length=3, max_length=3)  # [X, Y, Z]
    patrol_start: List[float] = Field(..., min_length=2, max_length=2)    # [X, Z]
    patrol_end: List[float] = Field(..., min_length=2, max_length=2)      # [X, Z]
    patrol_speed: float = Field(..., ge=0.2, le=2.5)                     # m/s
    initial_heading_rad: float                                            # radians (0 = facing +Z)
    direction: Literal[1, -1] = 1                                         # +1: S -> E, -1: E -> S
    initial_patrol_progress: float = Field(0.0, ge=0.0, le=1.0)           # alpha along segment [0, 1]
    color: Optional[str] = "#eab308"
    role_description: Optional[str] = None
    geometry: ActorGeometry = Field(
        default_factory=lambda: ActorGeometry(
            geometry_type="forklift_compound",
            forklift=ForkliftCompoundColliderGeometry()
        )
    )

class StaticHazardDefinition(BaseModel):
    id: str
    hazard_type: Literal["cube", "sphere", "barrier"]
    name: str
    position: List[float] = Field(..., min_length=3, max_length=3)
    size: Optional[List[float]] = None  # [width, height, depth] or [radius]
    rotation_rad: float = 0.0
    aisle_id: Optional[str] = None
    shape: Optional[str] = None
    is_static: bool = True
    collider_type: Optional[str] = None

class RobotMissionSetup(BaseModel):
    start_position: List[float] = Field(..., min_length=3, max_length=3)
    start_rotation_rad: float = 0.0
    destination_id: str
    destination_name: str
    destination_position: List[float] = Field(..., min_length=3, max_length=3)
    navigation_preference: Literal["default", "shortest_safe_path", "alternative_route"] = "default"

# ==============================================================================
# VALIDATION MODELS
# ==============================================================================

class ValidationIssue(BaseModel):
    severity: Literal["ERROR", "WARNING"]
    code: str
    message: str
    affected_entity_id: Optional[str] = None
    details: Dict[str, Any] = Field(default_factory=dict)

class ScenarioValidationResult(BaseModel):
    is_valid: bool
    issues: List[ValidationIssue] = Field(default_factory=list)
    tested_footprints_count: int = 0
    swept_path_segments_count: int = 0

# ==============================================================================
# GENERATED SCENARIO DEFINITION & API CONTRACTS
# ==============================================================================

class GeneratedScenario(BaseModel):
    scenario_id: str
    title: str
    description: str
    environment: Literal["warehouse"] = "warehouse"
    difficulty: Literal["normal", "hard", "extreme"] = "extreme"
    seed: int
    robot_setup: RobotMissionSetup
    actors: List[ActorDefinition] = Field(default_factory=list)
    static_hazards: List[StaticHazardDefinition] = Field(default_factory=list)
    provenance_audit: List[ParameterProvenance] = Field(default_factory=list)
    unsupported_features: List[str] = Field(default_factory=list)
    generator_engine: Literal["GEMINI_1_5_FLASH", "GEMINI_STRUCTURED", "DETERMINISTIC_PATTERN_FALLBACK"]

class ScenarioGenerateRequest(BaseModel):
    prompt: str = Field(..., min_length=2, description="Natural language description of scenario")
    preferred_corridor: Optional[str] = None
    difficulty: Optional[Literal["normal", "hard", "extreme"]] = None

class ScenarioGenerateResponse(BaseModel):
    scenario: GeneratedScenario
    validation: ScenarioValidationResult

class ScenarioValidateRequest(BaseModel):
    scenario: GeneratedScenario

class ScenarioValidateResponse(BaseModel):
    validation: ScenarioValidationResult
