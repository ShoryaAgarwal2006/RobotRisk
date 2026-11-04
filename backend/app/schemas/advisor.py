from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional
from datetime import datetime, timezone

class TelemetrySnapshot(BaseModel):
    position: List[float] = Field(default_factory=lambda: [0.0, 0.0, 0.0])
    rotation: float = 0.0
    linear_velocity: float = 0.0
    angular_velocity: float = 0.0
    ttc: Optional[float] = None
    min_clearance: Optional[float] = None
    highest_risk_obstacle: Optional[str] = None
    safety_status: Optional[str] = None
    stopping_distance: Optional[float] = None

class IncidentData(BaseModel):
    incident_id: str
    incident_type: str
    sim_time: float
    description: str
    snapshot: TelemetrySnapshot

class FailureAnalysisRequest(BaseModel):
    incident: IncidentData
    current_robot_config: Dict[str, Any]
    navigation_preference: Optional[str] = "default"
    environment_name: Optional[str] = "Warehouse"
    nearby_spatial_risk_level: Optional[str] = "CLEAR"

class EvidenceItem(BaseModel):
    metric_name: str
    measured_value: str
    threshold_or_baseline: str
    evidence_type: str = "MEASURED_GROUND_TRUTH"

class ProposedChange(BaseModel):
    parameter_key: str
    label: str
    current_value: Any
    proposed_value: Any
    unit: Optional[str] = None
    allowed_range: Optional[List[float]] = None

class RecommendationItem(BaseModel):
    id: str
    category: str  # "SOFTWARE_PARAMETER" | "ROUTE_PREFERENCE" | "HARDWARE_ADVISORY"
    title: str
    problem_explanation: str
    supporting_evidence: List[EvidenceItem]
    proposed_changes: List[ProposedChange]
    expected_benefit: str
    potential_tradeoffs: str
    is_hardware_advisory: bool = False

class FailureAnalysisResponse(BaseModel):
    incident_id: str
    primary_failure_mode: str
    summary_explanation: str
    contributing_factors: List[str]
    measured_evidence: List[EvidenceItem]
    hypothesized_causes: List[str]
    recommendations: List[RecommendationItem]
    analyzed_at_iso: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
