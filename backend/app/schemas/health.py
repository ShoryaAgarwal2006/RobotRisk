from pydantic import BaseModel, Field
from typing import List, Dict, Any
from datetime import datetime, timezone

class HealthCheckResponse(BaseModel):
    status: str = Field(default="ok", description="Operational status of backend")
    service: str = Field(default="ROBOTRISK AI Core Engine", description="Service name")
    version: str = Field(default="0.1.0", description="API version")
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), description="UTC timestamp")
    active_modes: List[str] = Field(
        default=["manual", "autonomous", "ai_command"],
        description="Supported simulation modes"
    )
    capabilities: Dict[str, Any] = Field(
        default_factory=lambda: {
            "physics_engine": "Rapier 3D (client-side synchronized)",
            "scenario_validation": True,
            "failure_analysis": True,
            "deterministic_fallback": True,
            "human_in_the_loop_approval": True,
        }
    )

