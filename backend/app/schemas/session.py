from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any, Literal

UserRole = Literal["operator", "controller", "observer"]

class Participant(BaseModel):
    clientId: str
    role: UserRole
    name: str
    isHost: bool = False
    connectedAt: float = 0.0

class SessionInfo(BaseModel):
    sessionId: str
    hostClientId: str
    createdAt: float
    participants: List[Participant] = []
    isRunning: bool = True
    difficulty: str = "normal"
    activeObstacleCount: int = 0
    activeBarrierCount: int = 0

class CreateSessionRequest(BaseModel):
    role: Optional[UserRole] = "operator"
    name: Optional[str] = "Host Operator"

class CreateSessionResponse(BaseModel):
    sessionId: str
    clientId: str
    role: UserRole
    hostRole: Optional[UserRole] = None
    joinUrl: str
    wsUrl: str

class JoinSessionRequest(BaseModel):
    sessionId: str
    role: Optional[UserRole] = "controller"
    name: Optional[str] = "Scenario Controller"

class JoinSessionResponse(BaseModel):
    sessionId: str
    clientId: str
    role: UserRole
    wsUrl: str
    sessionInfo: SessionInfo
    participants: Optional[List[Participant]] = None
    currentSnapshot: Optional[Dict[str, Any]] = None

class WebSocketMessage(BaseModel):
    type: str
    sessionId: str
    clientId: str
    role: UserRole
    timestamp: float
    eventId: Optional[str] = None
    payload: Dict[str, Any] = Field(default_factory=dict)
