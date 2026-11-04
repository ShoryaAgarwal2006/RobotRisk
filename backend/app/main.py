from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from backend.app.schemas.health import HealthCheckResponse
from backend.app.schemas.command import CommandParseRequest, CommandParseResponse
from backend.app.schemas.advisor import FailureAnalysisRequest, FailureAnalysisResponse
from backend.app.schemas.scenario import (
    ScenarioGenerateRequest,
    ScenarioGenerateResponse,
    ScenarioValidateRequest,
    ScenarioValidateResponse,
)
from backend.app.schemas.session import (
    CreateSessionRequest,
    CreateSessionResponse,
    JoinSessionRequest,
    JoinSessionResponse,
    SessionInfo,
)
from backend.app.services.parser import parse_natural_language_command
from backend.app.services.advisor import analyze_incident_and_recommend
from backend.app.services.scenario_generator import (
    scenario_service,
    ScenarioPhysicalValidationError,
)
from backend.app.services.session_manager import session_manager
import time

app = FastAPI(
    title="ROBOTRISK AI Core API",
    description="Safety testing and intelligent scenario simulation engine for autonomous mobile robots",
    version="0.1.0"
)

# Enable CORS for frontend development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Open for development
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

START_TIME = time.time()

@app.get("/", tags=["Root"])
def root():
    return {
        "service": "ROBOTRISK AI Core API",
        "status": "online",
        "docs_url": "/docs",
        "health_url": "/api/health"
    }

@app.get("/api/health", response_model=HealthCheckResponse, tags=["Health"])
def health_check():
    return HealthCheckResponse(
        status="ok",
        service="ROBOTRISK AI Core Engine",
        version="0.1.0"
    )

@app.post("/api/command/parse", response_model=CommandParseResponse, tags=["Command Center"])
def parse_command(request: CommandParseRequest):
    return parse_natural_language_command(request)

@app.post("/api/advisor/analyze", response_model=FailureAnalysisResponse, tags=["Optimization Advisor"])
def analyze_failure(request: FailureAnalysisRequest):
    return analyze_incident_and_recommend(request)

# ==========================================
# NATURAL-LANGUAGE SCENARIO GENERATOR ROUTES
# ==========================================

@app.post("/api/scenario/generate", response_model=ScenarioGenerateResponse, tags=["Scenario Generator"])
def generate_scenario_endpoint(request: ScenarioGenerateRequest):
    try:
        return scenario_service.generate_scenario(request)
    except ScenarioPhysicalValidationError as e:
        error_issues = [i.model_dump() for i in e.validation_result.issues if i.severity == "ERROR"]
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "error": "SCENARIO_PHYSICAL_VALIDATION_FAILED",
                "message": "Generated scenario failed physical warehouse geometry validation.",
                "issues": error_issues,
            },
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Scenario generation failed: {str(e)}",
        )

@app.post("/api/scenario/validate", response_model=ScenarioValidateResponse, tags=["Scenario Generator"])
def validate_scenario_endpoint(request: ScenarioValidateRequest):
    try:
        return scenario_service.validate_scenario(request)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Scenario validation failed: {str(e)}"
        )

# ==========================================
# MULTI-DEVICE COLLABORATION SESSION ROUTES
# ==========================================

@app.post("/api/session/create", response_model=CreateSessionResponse, tags=["Collaboration"])
def create_session(request: CreateSessionRequest):
    assigned_role = request.role or "operator"
    session_id, client_id = session_manager.create_session(
        host_name=request.name or "Host Operator",
        role=assigned_role,
    )
    return CreateSessionResponse(
        sessionId=session_id,
        clientId=client_id,
        role=assigned_role,
        hostRole=assigned_role,
        joinUrl=f"/?session={session_id}&role=controller",
        wsUrl=f"/ws/session/{session_id}/{client_id}",
    )

@app.post("/api/session/join", response_model=JoinSessionResponse, tags=["Collaboration"])
def join_session(request: JoinSessionRequest):
    try:
        assigned_role = request.role or "controller"
        client_id, session = session_manager.join_session(
            session_id=request.sessionId,
            name=request.name or "Scenario Controller",
            role=assigned_role,
        )
        return JoinSessionResponse(
            sessionId=session.session_id,
            clientId=client_id,
            role=assigned_role,
            wsUrl=f"/ws/session/{session.session_id}/{client_id}",
            sessionInfo=session.to_info(),
            participants=list(session.participants.values()),
            currentSnapshot=session.to_full_snapshot(),
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))

@app.get("/api/session/{session_id}", response_model=SessionInfo, tags=["Collaboration"])
def get_session_info(session_id: str):
    session = session_manager.get_session(session_id)
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Session {session_id} not found.")
    return session.to_info()

@app.get("/api/session/{session_id}/snapshot", tags=["Collaboration"])
def get_session_snapshot(session_id: str):
    session = session_manager.get_session(session_id)
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Session {session_id} not found.")
    return session.to_full_snapshot()

@app.websocket("/ws/session/{session_id}/{client_id}")
async def session_websocket_endpoint(websocket: WebSocket, session_id: str, client_id: str):
    try:
        session = await session_manager.connect_client(session_id, client_id, websocket)
    except ValueError as e:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    # Send initial welcome packet with full authoritative snapshot
    p = session.participants.get(client_id)
    await websocket.send_json({
        "type": "session_welcome",
        "sessionId": session.session_id,
        "clientId": client_id,
        "role": p.role if p else "observer",
        "timestamp": time.time(),
        "payload": {
            "sessionInfo": session.to_info().model_dump(),
            "snapshot": session.to_full_snapshot(),
        },
    })

    # Broadcast peer_joined notification to existing peers in the room
    await session_manager.broadcast(
        session.session_id,
        {
            "type": "peer_joined",
            "sessionId": session.session_id,
            "clientId": client_id,
            "role": p.role if p else "observer",
            "timestamp": time.time(),
            "payload": {
                "participant": p.model_dump() if p else {},
                "participants": [x.model_dump() for x in session.participants.values()],
            },
        },
        exclude_client_id=client_id,
    )

    try:
        while True:
            data = await websocket.receive_json()
            await session_manager.process_incoming_message(session_id, client_id, data)
    except WebSocketDisconnect:
        await session_manager.disconnect_client(session_id, client_id)
    except Exception:
        await session_manager.disconnect_client(session_id, client_id)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.app.main:app", host="0.0.0.0", port=8000, reload=True)
