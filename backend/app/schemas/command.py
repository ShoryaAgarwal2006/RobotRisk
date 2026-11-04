from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any, Literal

CommandActionType = Literal[
    "spawn_obstacle",
    "spawn_workers",
    "block_aisle",
    "unblock_aisle",
    "clear_obstacles",
    "set_simulation_state",
    "start_mission",
    "pause_mission",
    "resume_mission",
    "emergency_stop",
    "reset_simulation",
    "set_difficulty",
    "replan_route",
    "remove_target_obstacle",
    "query_explanation",
    "query_events",
    "clarification_needed",
    "unknown"
]

class ConversationHistoryItem(BaseModel):
    sender: str
    text: str
    action: Optional[str] = None

class CommandContext(BaseModel):
    robot_position: Optional[List[float]] = None
    robot_yaw: Optional[float] = None
    robot_speed: Optional[float] = None
    nav_state: Optional[str] = None
    is_e_stopped: Optional[bool] = None
    is_running: Optional[bool] = None
    closest_obstacle: Optional[str] = None
    obstacle_position: Optional[List[float]] = None
    forward_clearance: Optional[float] = None
    risk_level: Optional[str] = None
    stopping_distance: Optional[float] = None
    braking_status: Optional[str] = None
    route_validity: Optional[str] = None
    failure_explanation: Optional[str] = None
    collision_count: Optional[int] = None
    last_collision_force: Optional[float] = None
    recent_events: Optional[List[str]] = None
    current_difficulty: Optional[str] = "normal"
    last_spawned_obstacle_id: Optional[str] = None
    last_action_type: Optional[str] = None
    conversation_history: Optional[List[ConversationHistoryItem]] = None

class CommandParameters(BaseModel):
    objectType: Optional[str] = None
    position: Optional[List[float]] = None
    relativeToRobot: Optional[Dict[str, float]] = None
    aisleId: Optional[str] = None
    aisleName: Optional[str] = None
    count: Optional[int] = None
    simulationRunning: Optional[bool] = None
    destinationId: Optional[str] = None
    difficulty: Optional[str] = None
    navigationPreference: Optional[str] = None
    targetObstacleId: Optional[str] = None
    emergencyStopActive: Optional[bool] = None

class SubAction(BaseModel):
    id: str
    action: CommandActionType
    intent: str
    confidence: float
    parameters: CommandParameters
    description: str
    requires_approval: bool
    impact_summary: str
    proposed_changes: List[str]

class CommandParseRequest(BaseModel):
    prompt: str = Field(..., description="Natural language command from operator")
    context: Optional[CommandContext] = None

class CommandParseResponse(BaseModel):
    action: CommandActionType
    intent: str
    confidence: float
    parameters: CommandParameters
    description: str
    requires_approval: bool
    impact_summary: str
    proposed_changes: List[str]
    direct_response: Optional[str] = None
    sub_actions: Optional[List[SubAction]] = None
    is_multi_intent: bool = False
    clarification_question: Optional[str] = None
    parser_mode: str = "deterministic_fallback"
