import time
import uuid
import random
import string
import logging
import math
from typing import Dict, List, Optional, Set, Any
from fastapi import WebSocket, WebSocketDisconnect
from backend.app.schemas.session import Participant, SessionInfo, UserRole, WebSocketMessage

logger = logging.getLogger("robotrisk.session_manager")

# Permissions map per role
ROLE_PERMISSIONS: Dict[str, Set[str]] = {
    "operator": {
        "sim_telemetry",
        "robot_telemetry",
        "robot_pose_update",
        "set_clock_state",
        "simulation_clock_update",
        "start_mission",
        "pause_mission",
        "resume_mission",
        "emergency_stop",
        "robot_teleop",
        "reset_pose",
        "select_destination",
        "ping",
        "request_sync",
        # Operator can also inject for self-testing if no controller is present
        "spawn_object",
        "spawn_obstacle",
        "remove_object",
        "remove_obstacle",
        "clear_objects",
        "clear_obstacles",
        "block_aisle",
        "remove_barrier",
        "clear_barriers",
        "set_difficulty",
        "trigger_challenge",
        "ai_command_executed",
        "create_scenario",
        "natural_language_command",
    },
    "controller": {
        "spawn_object",
        "spawn_obstacle",
        "remove_object",
        "remove_obstacle",
        "clear_objects",
        "clear_obstacles",
        "block_aisle",
        "remove_barrier",
        "clear_barriers",
        "set_difficulty",
        "trigger_challenge",
        "ai_command_executed",
        "create_scenario",
        "natural_language_command",
        "ping",
        "request_sync",
        # Controller can request sim clock pause/resume as part of scenarios
        "set_clock_state",
        "simulation_clock_update",
    },
    "observer": {
        "ping",
        "request_sync",
    },
}

class SessionState:
    def __init__(self, session_id: str, host_client_id: str):
        self.session_id = session_id
        self.host_client_id = host_client_id
        self.created_at = time.time()
        self.participants: Dict[str, Participant] = {}
        self.connections: Dict[str, WebSocket] = {}
        
        # Authoritative cached state
        self.is_running: bool = True
        self.time_scale: float = 1.0
        self.difficulty: str = "normal"
        self.selected_destination_id: str = "bay-4"
        self.last_telemetry_log_time: float = 0.0
        self.interactive_objects: List[Dict[str, Any]] = []
        self.active_barriers: List[Dict[str, Any]] = []
        self.robot_pose: Dict[str, Any] = {
            "position": [-14.5, 0.22, -10.5],
            "rotation": 0.0,
            "linearVelocity": 0.0,
            "angularVelocity": 0.0,
        }
        self.nav_state: str = "IDLE"
        self.planned_path: List[List[float]] = []
        self.current_waypoint_index: int = 0
        self.sensor_data: Dict[str, Any] = {
            "forwardDist": 5.5,
            "leftDist": 3.0,
            "rightDist": 3.0,
            "riskLevel": "clear",
            "closestObstacle": None,
            "obstaclePosition": None,
        }
        self.mission_metrics: Dict[str, Any] = {
            "missionStatus": "idle",
            "missionTime": 0.0,
            "distanceTravelled": 0.0,
            "obstaclesDetected": 0,
            "replanCount": 0,
            "timeStopped": 0.0,
            "collisions": 0,
        }
        self.diagnostics: Dict[str, Any] = {
            "routeValidity": "valid",
            "failureExplanation": None,
            "stoppingDistance": 0.0,
            "availableClearance": 5.5,
            "brakingStatus": "cruising",
        }
        self.event_log: List[str] = [f"[SESSION] Collaborative room {session_id} initialized."]

    def to_info(self) -> SessionInfo:
        return SessionInfo(
            sessionId=self.session_id,
            hostClientId=self.host_client_id,
            createdAt=self.created_at,
            participants=list(self.participants.values()),
            isRunning=self.is_running,
            difficulty=self.difficulty,
            activeObstacleCount=len(self.interactive_objects),
            activeBarrierCount=len(self.active_barriers),
        )

    def to_full_snapshot(self) -> Dict[str, Any]:
        return {
            "sessionId": self.session_id,
            "hostClientId": self.host_client_id,
            "createdAt": self.created_at,
            "participants": [p.model_dump() for p in self.participants.values()],
            "isRunning": self.is_running,
            "timeScale": self.time_scale,
            "difficulty": self.difficulty,
            "selectedDestinationId": self.selected_destination_id,
            "interactiveObjects": self.interactive_objects,
            "activeBarriers": self.active_barriers,
            "robotPose": self.robot_pose,
            "navState": self.nav_state,
            "plannedPath": self.planned_path,
            "currentWaypointIndex": self.current_waypoint_index,
            "sensorData": self.sensor_data,
            "missionMetrics": self.mission_metrics,
            "diagnostics": self.diagnostics,
            "eventLog": self.event_log[:20],
        }


def execute_challenge_on_session(session: SessionState, challenge_id: str):
    """Executes a predefined challenge authoritatively on the session state."""
    rx = session.robot_pose.get("position", [-14.5, 0.22, -10.5])[0]
    rz = session.robot_pose.get("position", [-14.5, 0.22, -10.5])[2]
    yaw = session.robot_pose.get("rotation", 0.0)

    if challenge_id == "sudden_pedestrian_crossing":
        fwd_x = math.sin(yaw)
        fwd_z = math.cos(yaw)
        perp_x = math.cos(yaw)
        perp_z = -math.sin(yaw)
        tx = rx + fwd_x * 3.5
        tz = rz + fwd_z * 3.5
        start = [round(tx - perp_x * 4.0, 2), round(tz - perp_z * 4.0, 2)]
        end = [round(tx + perp_x * 4.0, 2), round(tz + perp_z * 4.0, 2)]
        worker_obj = {
            "id": f"worker-ch-{int(time.time()*1000)}",
            "type": "worker",
            "position": [start[0], 0.75, start[1]],
            "color": "#f97316",
            "size": 0.55,
            "rotation": 0.0,
            "name": "Warehouse Worker",
            "patrolStart": start,
            "patrolEnd": end,
            "patrolSpeed": 1.4,
            "patrolDirection": 1,
        }
        session.interactive_objects.append(worker_obj)
        session.event_log.insert(0, "[CHALLENGE] Sudden Pedestrian Crossing deployed across path!")

    elif challenge_id == "falling_box":
        bx = round(rx + math.sin(yaw) * 3.2, 2)
        bz = round(rz + math.cos(yaw) * 3.2, 2)
        box_obj = {
            "id": f"box-ch-{int(time.time()*1000)}",
            "type": "cube",
            "position": [bx, 0.4, bz],
            "color": "#f43f5e",
            "size": 0.75,
            "rotation": 0.0,
            "name": "Falling Cargo Box",
        }
        session.interactive_objects.append(box_obj)
        session.event_log.insert(0, "[CHALLENGE] Falling Cargo Box tumbled into active transit corridor!")

    elif challenge_id == "blocked_aisle":
        barrier = {
            "id": f"barrier-aisle-2-{int(time.time()*1000)}",
            "aisleId": "aisle-2",
            "name": "Aisle 2 Center Crossing",
            "position": [0.0, 0.75, 0.0],
            "width": 3.0,
            "depth": 0.6,
            "height": 1.5,
            "rotation": 1.5707963267948966,
        }
        session.active_barriers = [b for b in session.active_barriers if b.get("aisleId") != "aisle-2"]
        session.active_barriers.append(barrier)
        session.event_log.insert(0, "[CHALLENGE] Aisle 2 Barricaded! Global rerouting triggered.")

    elif challenge_id == "multiple_moving_workers":
        configs = [
            ([-8.0, 0.0], [8.0, 0.0], 1.2),
            ([-6.5, -6.0], [-6.5, 6.0], 1.0),
            ([0.0, -7.0], [0.0, 7.0], 1.1),
            ([6.5, -6.0], [6.5, 6.0], 1.0),
        ]
        for i, (start, end, spd) in enumerate(configs):
            w = {
                "id": f"worker-crowd-{i}-{int(time.time()*1000)}",
                "type": "worker",
                "position": [start[0], 0.75, start[1]],
                "color": "#f97316",
                "size": 0.55,
                "rotation": 0.0,
                "name": f"Warehouse Worker {i+1}",
                "patrolStart": start,
                "patrolEnd": end,
                "patrolSpeed": spd,
                "patrolDirection": 1,
            }
            session.interactive_objects.append(w)
        session.event_log.insert(0, "[CHALLENGE] 4 Moving Warehouse Workers deployed.")

    elif challenge_id == "unexpected_trolley":
        trolley_obj = {
            "id": f"trolley-ch-{int(time.time()*1000)}",
            "type": "cube",
            "position": [0.0, 0.4, 0.0],
            "color": "#38bdf8",
            "size": 0.85,
            "rotation": 0.0,
            "name": "Errant Rolling Trolley",
        }
        session.interactive_objects.append(trolley_obj)
        session.event_log.insert(0, "[CHALLENGE] Errant Rolling Trolley placed at central intersection.")

    elif challenge_id == "multiple_simultaneous_hazards":
        barrier = {
            "id": f"barrier-aisle-2-{int(time.time()*1000)}",
            "aisleId": "aisle-2",
            "name": "Aisle 2 Center Crossing",
            "position": [0.0, 0.75, 0.0],
            "width": 3.0,
            "depth": 0.6,
            "height": 1.5,
            "rotation": 1.5707963267948966,
        }
        session.active_barriers = [b for b in session.active_barriers if b.get("aisleId") != "aisle-2"]
        session.active_barriers.append(barrier)
        cx = round(rx + math.sin(yaw) * 3.0, 2)
        cz = round(rz + math.cos(yaw) * 3.0, 2)
        session.interactive_objects.append({
            "id": f"box-multi-{int(time.time()*1000)}",
            "type": "cube",
            "position": [cx, 0.4, cz],
            "color": "#f43f5e",
            "size": 0.75,
            "rotation": 0.0,
            "name": "Catastrophe Crate",
        })
        configs = [
            ([-8.0, 0.0], [8.0, 0.0], 1.2),
            ([-6.5, -6.0], [-6.5, 6.0], 1.0),
        ]
        for i, (start, end, spd) in enumerate(configs):
            session.interactive_objects.append({
                "id": f"worker-multi-{i}-{int(time.time()*1000)}",
                "type": "worker",
                "position": [start[0], 0.75, start[1]],
                "color": "#f97316",
                "size": 0.55,
                "rotation": 0.0,
                "name": f"Warehouse Worker {i+1}",
                "patrolStart": start,
                "patrolEnd": end,
                "patrolSpeed": spd,
                "patrolDirection": 1,
            })
        session.event_log.insert(0, "[CHALLENGE] MULTI-HAZARD CATASTROPHE deployed!")

    elif challenge_id == "impossible_mission_normal":
        session.difficulty = "normal"
        session.interactive_objects = []
        session.active_barriers = []
        session.event_log.insert(0, "[CHALLENGE] Normal Baseline Scenario restored.")

    elif challenge_id == "impossible_mission_hard":
        session.difficulty = "hard"
        session.event_log.insert(0, "[CHALLENGE] Hard Difficulty Preset engaged.")

    elif challenge_id == "impossible_mission_extreme":
        session.difficulty = "extreme"
        session.event_log.insert(0, "[CHALLENGE] EXTREME IMPOSSIBLE MISSION engaged!")


class SessionManager:
    def __init__(self):
        self.sessions: Dict[str, SessionState] = {}

    def generate_session_code(self) -> str:
        """Generates a clean 6-character room code like RR-8421 or RR-X7M2."""
        for _ in range(50):
            chars = ''.join(random.choices(string.ascii_uppercase + string.digits, k=4))
            code = f"RR-{chars}"
            if code not in self.sessions:
                return code
        return f"RR-{uuid.uuid4().hex[:4].upper()}"

    def create_session(self, host_name: str = "Host Operator", role: UserRole = "operator") -> tuple[str, str]:
        session_id = self.generate_session_code()
        client_id = f"client-{uuid.uuid4().hex[:8]}"

        session = SessionState(session_id=session_id, host_client_id=client_id)
        session.participants[client_id] = Participant(
            clientId=client_id,
            role=role,
            name=host_name,
            isHost=True,
            connectedAt=time.time(),
        )
        self.sessions[session_id] = session
        logger.info(f"Created session {session_id} with host {client_id} ({role})")
        return session_id, client_id

    def join_session(self, session_id: str, name: str = "Scenario Controller", role: UserRole = "controller") -> tuple[str, SessionState]:
        clean_id = session_id.strip().upper()
        if clean_id not in self.sessions:
            raise ValueError(f"Session {clean_id} not found.")

        session = self.sessions[clean_id]
        client_id = f"client-{uuid.uuid4().hex[:8]}"

        session.participants[client_id] = Participant(
            clientId=client_id,
            role=role,
            name=name,
            isHost=False,
            connectedAt=time.time(),
        )
        logger.info(f"Client {client_id} ({role}) joined session {clean_id}")
        return client_id, session

    def get_session(self, session_id: str) -> Optional[SessionState]:
        return self.sessions.get(session_id.strip().upper())

    async def connect_client(self, session_id: str, client_id: str, websocket: WebSocket) -> SessionState:
        clean_id = session_id.strip().upper()
        if clean_id not in self.sessions:
            raise ValueError(f"Session {clean_id} does not exist.")

        session = self.sessions[clean_id]
        await websocket.accept()
        session.connections[client_id] = websocket

        # If participant doesn't exist, create a fallback participant
        if client_id not in session.participants:
            role: UserRole = "controller" if client_id != session.host_client_id else "operator"
            session.participants[client_id] = Participant(
                clientId=client_id,
                role=role,
                name=f"User {client_id[-4:]}",
                isHost=(client_id == session.host_client_id),
                connectedAt=time.time(),
            )

        logger.info(f"WebSocket connected for {client_id} in {clean_id}")
        return session

    async def disconnect_client(self, session_id: str, client_id: str):
        clean_id = session_id.strip().upper()
        if clean_id in self.sessions:
            session = self.sessions[clean_id]
            if client_id in session.connections:
                del session.connections[client_id]
            
            p = session.participants.get(client_id)
            name = p.name if p else client_id
            
            # Broadcast peer_left notification
            await self.broadcast(
                clean_id,
                {
                    "type": "peer_left",
                    "sessionId": clean_id,
                    "clientId": client_id,
                    "role": p.role if p else "observer",
                    "timestamp": time.time(),
                    "payload": {
                        "name": name,
                        "participants": [x.model_dump() for x in session.participants.values() if x.clientId != client_id],
                    },
                },
                exclude_client_id=client_id,
            )

            # Note: We preserve session state even if someone disconnects so they can reconnect!
            logger.info(f"Client {client_id} disconnected from {clean_id}. Remaining active connections: {len(session.connections)}")

    def validate_permission(self, role: UserRole, message_type: str) -> bool:
        allowed = ROLE_PERMISSIONS.get(role, set())
        return message_type in allowed

    async def broadcast(self, session_id: str, message: Dict[str, Any], exclude_client_id: Optional[str] = None):
        clean_id = session_id.strip().upper()
        if clean_id not in self.sessions:
            return

        session = self.sessions[clean_id]
        dead_clients: List[str] = []

        for cid, ws in list(session.connections.items()):
            if exclude_client_id and cid == exclude_client_id:
                continue
            try:
                await ws.send_json(message)
            except Exception as e:
                logger.warning(f"Error broadcasting to {cid}: {e}")
                dead_clients.append(cid)

        for cid in dead_clients:
            if cid in session.connections:
                del session.connections[cid]

    async def process_incoming_message(self, session_id: str, client_id: str, raw_msg: Dict[str, Any]):
        clean_id = session_id.strip().upper()
        if clean_id not in self.sessions:
            return

        session = self.sessions[clean_id]
        msg_type = raw_msg.get("type", "")
        role = raw_msg.get("role", "observer")
        payload = raw_msg.get("payload", {})
        event_id = raw_msg.get("eventId") or str(uuid.uuid4())

        # 1. Check role permissions
        if not self.validate_permission(role, msg_type):
            logger.warning(f"Security Alert: {client_id} with role '{role}' attempted forbidden action '{msg_type}' in {clean_id}")
            # Reply with rejection notice to the sender
            ws = session.connections.get(client_id)
            if ws:
                await ws.send_json({
                    "type": "permission_denied",
                    "sessionId": clean_id,
                    "clientId": client_id,
                    "role": role,
                    "timestamp": time.time(),
                    "eventId": event_id,
                    "payload": {
                        "action": msg_type,
                        "reason": f"Role '{role}' is not authorized to execute '{msg_type}'.",
                    },
                })
            return

        now = time.time()
        response_msg = {
            "type": msg_type,
            "sessionId": clean_id,
            "clientId": client_id,
            "role": role,
            "timestamp": now,
            "eventId": event_id,
            "payload": payload,
        }

        # 2. Update Server Authoritative Session State based on message type
        if msg_type in ("sim_telemetry", "robot_telemetry", "robot_pose_update"):
            # Update telemetry and robot pose cache
            if "robotPose" in payload:
                session.robot_pose = payload["robotPose"]
            if "navState" in payload:
                session.nav_state = payload["navState"]
            if "plannedPath" in payload:
                session.planned_path = payload["plannedPath"]
            if "currentWaypointIndex" in payload:
                session.current_waypoint_index = payload["currentWaypointIndex"]
            if "sensorData" in payload:
                session.sensor_data = payload["sensorData"]
            if "missionMetrics" in payload:
                session.mission_metrics = payload["missionMetrics"]
            if "diagnostics" in payload:
                session.diagnostics = payload["diagnostics"]
            
            # Broadcast to peers (excluding sender)
            await self.broadcast(clean_id, response_msg, exclude_client_id=client_id)

            # Throttled Diagnostic Logging for Backend (every 1 second)
            now = time.time()
            if now - session.last_telemetry_log_time >= 1.0:
                session.last_telemetry_log_time = now
                peer_count = max(0, len(session.connections) - 1)
                pos = session.robot_pose.get("position", [])
                logger.info(
                    f"[MULTI-DIAGNOSTIC][BACKEND] Received telemetry from {client_id}: "
                    f"pos={pos}, broadcasting to {peer_count} connected peers in {clean_id}"
                )

        elif msg_type in ("set_clock_state", "simulation_clock_update"):
            session.is_running = payload.get("isRunning", True)
            session.event_log.insert(0, f"[CLOCK] Simulation {'Resumed' if session.is_running else 'Paused'} by {role.upper()}")
            await self.broadcast(clean_id, response_msg)

        elif msg_type in ("spawn_object", "spawn_obstacle"):
            obj = payload.get("object") or payload.get("obstacle")
            if not obj and "type" in payload and "position" in payload:
                obj = payload
            if obj:
                # Remove if already exists with same id, then append
                session.interactive_objects = [o for o in session.interactive_objects if o.get("id") != obj.get("id")]
                session.interactive_objects.append(obj)
                session.event_log.insert(0, f"[HAZARD] {role.upper()} injected {obj.get('name', 'Object')} at {obj.get('position')}")
            await self.broadcast(clean_id, response_msg)

        elif msg_type in ("remove_object", "remove_obstacle"):
            obj_id = payload.get("objectId") or payload.get("obstacleId") or payload.get("id")
            if obj_id:
                session.interactive_objects = [o for o in session.interactive_objects if o.get("id") != obj_id]
                session.event_log.insert(0, f"[HAZARD] Removed obstacle {obj_id}")
            await self.broadcast(clean_id, response_msg)

        elif msg_type in ("clear_objects", "clear_obstacles"):
            session.interactive_objects = []
            session.event_log.insert(0, f"[HAZARD] Cleared all dynamic obstacles")
            await self.broadcast(clean_id, response_msg)

        elif msg_type in ("block_aisle", "aisle_blocked"):
            barrier = payload.get("barrier")
            aisle_id = payload.get("aisleId")
            if not barrier and aisle_id:
                barrier = {
                    "id": f"barrier-{aisle_id}-{int(time.time()*1000)}",
                    "aisleId": aisle_id,
                    "name": payload.get("aisleName", aisle_id),
                    "position": [0, 0.75, 0],
                    "width": 3.0,
                    "depth": 0.6,
                    "height": 1.5,
                    "rotation": 0,
                }
            if barrier:
                session.active_barriers = [b for b in session.active_barriers if b.get("aisleId") != barrier.get("aisleId")]
                session.active_barriers.append(barrier)
                session.event_log.insert(0, f"[BARRICADE] {role.upper()} barricaded {barrier.get('name', barrier.get('aisleId'))}")
            await self.broadcast(clean_id, response_msg)

        elif msg_type in ("remove_barrier", "barrier_removed"):
            barrier_id = payload.get("barrierId")
            aisle_id = payload.get("aisleId")
            if barrier_id:
                session.active_barriers = [b for b in session.active_barriers if b.get("id") != barrier_id]
            elif aisle_id:
                session.active_barriers = [b for b in session.active_barriers if b.get("aisleId") != aisle_id]
            session.event_log.insert(0, f"[BARRICADE] Removed barricade")
            await self.broadcast(clean_id, response_msg)

        elif msg_type == "clear_barriers":
            session.active_barriers = []
            session.event_log.insert(0, f"[BARRICADE] Cleared all corridor barricades")
            await self.broadcast(clean_id, response_msg)

        elif msg_type in ("set_difficulty", "scenario_updated"):
            diff = payload.get("difficulty", "extreme")
            session.difficulty = diff
            session.event_log.insert(0, f"[DIFFICULTY] Scenario difficulty set to {diff.upper()} by {role.upper()}")
            await self.broadcast(clean_id, response_msg)

        elif msg_type == "start_mission":
            dest = payload.get("destinationId", "bay-4")
            pref = payload.get("preference", "default")
            session.nav_state = "PLANNING"
            session.selected_destination_id = dest
            session.event_log.insert(0, f"[MISSION] Autonomous mission started to {dest} ({pref})")
            await self.broadcast(clean_id, response_msg)

        elif msg_type == "emergency_stop":
            session.nav_state = "STOPPED"
            session.event_log.insert(0, f"[SAFETY] EMERGENCY STOP ENGAGED by {role.upper()}!")
            await self.broadcast(clean_id, response_msg)

        elif msg_type in ("trigger_challenge", "challenge_triggered"):
            ch_id = payload.get("challengeId", "")
            ch_name = payload.get("challengeName", ch_id or "Custom Challenge")
            execute_challenge_on_session(session, ch_id)
            session.event_log.insert(0, f"[CHALLENGE] Scenario Controller triggered '{ch_name}'")
            
            # Enrich payload with updated objects and barriers for guaranteed synchronization
            response_msg["payload"]["interactiveObjects"] = session.interactive_objects
            response_msg["payload"]["activeBarriers"] = session.active_barriers
            response_msg["payload"]["difficulty"] = session.difficulty
            await self.broadcast(clean_id, response_msg)

        elif msg_type in ("ai_command_executed", "create_scenario", "natural_language_command"):
            intent = payload.get("intent", "AI Command")
            session.event_log.insert(0, f"[AI-SCENARIO] Executed: {intent}")
            await self.broadcast(clean_id, response_msg)

        elif msg_type in ("request_sync", "get_snapshot"):
            # Send complete snapshot to the requesting client
            ws = session.connections.get(client_id)
            if ws:
                full_snap = session.to_full_snapshot()
                # Use type requested by client, default to session_snapshot
                snap_type = "simulation_snapshot" if msg_type == "get_snapshot" else "session_snapshot"
                await ws.send_json({
                    "type": snap_type,
                    "sessionId": clean_id,
                    "clientId": client_id,
                    "role": role,
                    "timestamp": now,
                    "eventId": event_id,
                    "payload": full_snap,
                })

        elif msg_type == "ping":
            ws = session.connections.get(client_id)
            if ws:
                await ws.send_json({
                    "type": "pong",
                    "sessionId": clean_id,
                    "clientId": client_id,
                    "role": role,
                    "timestamp": now,
                    "eventId": event_id,
                    "payload": {"clientTime": payload.get("clientTime", now)},
                })


# Global singleton manager instance
session_manager = SessionManager()
