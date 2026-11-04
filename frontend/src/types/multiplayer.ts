import { InteractiveObject, AisleBarrier, RobotPose, NavState, SensorData, MissionMetrics, NavigationDiagnostics } from './simulation';

export type UserRole = 'operator' | 'controller' | 'observer';

export interface Participant {
  clientId: string;
  role: UserRole;
  name: string;
  isHost: boolean;
  connectedAt: number;
}

export interface MultiplayerSessionInfo {
  sessionId: string;
  hostClientId: string;
  createdAt: number;
  participants: Participant[];
  isRunning: boolean;
  difficulty: string;
  activeObstacleCount: number;
  activeBarrierCount: number;
}

export type MultiplayerMessageType =
  | 'session_welcome'
  | 'peer_joined'
  | 'peer_left'
  | 'sim_telemetry'
  | 'robot_telemetry'
  | 'robot_pose_update'
  | 'telemetry_update'
  | 'set_clock_state'
  | 'simulation_clock_update'
  | 'spawn_object'
  | 'spawn_obstacle'
  | 'obstacle_spawned'
  | 'remove_object'
  | 'remove_obstacle'
  | 'obstacle_removed'
  | 'clear_objects'
  | 'clear_obstacles'
  | 'block_aisle'
  | 'aisle_blocked'
  | 'remove_barrier'
  | 'barrier_removed'
  | 'clear_barriers'
  | 'set_difficulty'
  | 'scenario_updated'
  | 'start_mission'
  | 'pause_mission'
  | 'resume_mission'
  | 'emergency_stop'
  | 'trigger_challenge'
  | 'challenge_triggered'
  | 'create_scenario'
  | 'natural_language_command'
  | 'ai_command_executed'
  | 'request_sync'
  | 'session_snapshot'
  | 'simulation_snapshot'
  | 'mission_status_changed'
  | 'collision_detected'
  | 'robot_teleop'
  | 'reset_pose'
  | 'permission_denied'
  | 'ping'
  | 'pong';

export interface MultiplayerMessage<T = any> {
  type: MultiplayerMessageType;
  sessionId: string;
  clientId: string;
  role: UserRole;
  timestamp: number;
  eventId?: string;
  payload: T;
}

export interface SimTelemetryPayload {
  robotPose?: RobotPose;
  navState?: NavState;
  plannedPath?: Array<[number, number]>;
  currentWaypointIndex?: number;
  sensorData?: SensorData;
  missionMetrics?: MissionMetrics;
  diagnostics?: NavigationDiagnostics;
  interactiveObjects?: InteractiveObject[];
  activeBarriers?: AisleBarrier[];
  currentTime?: number;
  isRunning?: boolean;
  difficulty?: string;
}

export interface PredefinedChallenge {
  id: string;
  title: string;
  category: 'incident' | 'traffic' | 'hazard' | 'stress';
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  details: string;
  iconName: string;
}
