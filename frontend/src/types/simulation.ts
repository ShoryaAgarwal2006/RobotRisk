export type SimulationMode = 'manual' | 'autonomous' | 'ai_command';

export type CameraView = 'follow' | 'orbit' | 'top_down';

export type BackendStatus = 'checking' | 'connected' | 'offline';

export type NavState =
  | 'IDLE'
  | 'PLANNING'
  | 'MOVING'
  | 'AVOIDING'
  | 'STOPPED'
  | 'COMPLETED'
  | 'FAILED';

export interface RobotPose {
  position: [number, number, number];
  rotation: number; // Yaw in radians
  linearVelocity: number; // m/s
  angularVelocity: number; // rad/s
}

export interface RobotConfig {
  maxLinearSpeed: number; // m/s
  maxAngularSpeed: number; // rad/s
  linearAcceleration: number; // m/s²
  angularAcceleration: number; // rad/s²
  linearDamping: number;
  angularDamping: number;
  wheelRadius: number; // m
  trackWidth: number; // m
}

export interface RobotStatus {
  battery: number; // 0 - 100%
  isEmergencyStopped: boolean;
  collisionCount: number;
  lastCollisionForce: number;
}

export interface SensorData {
  forwardDist: number;
  leftDist: number;
  rightDist: number;
  riskLevel: 'clear' | 'caution' | 'critical';
  closestObstacle: string | null;
  obstaclePosition?: [number, number] | null;
  ttc?: number | null;
  safetyStatus?: 'SAFE' | 'WARNING' | 'CRITICAL';
  highestRiskObstacle?: string | null;
  minClearance?: number;
  isCollisionCourse?: boolean;
}

export interface DestinationTarget {
  id: string;
  name: string;
  position: [number, number, number];
}

export interface MissionMetrics {
  missionStatus: 'idle' | 'running' | 'paused' | 'completed' | 'failed' | 'aborted';
  missionTime: number; // seconds
  distanceTravelled: number; // meters
  obstaclesDetected: number;
  replanCount: number;
  timeStopped: number; // seconds
  collisions: number;
  nearMisses: number;
}

export type PlacementType = 'box' | 'sphere' | 'barrier';
export type PlacementMode = PlacementType | null;

export interface AisleBarrier {
  id: string;
  aisleId: string;
  name: string;
  position: [number, number, number];
  width: number;
  depth: number;
  height: number;
  rotation: number; // yaw in radians
}

export interface InteractiveObject {
  id: string;
  type: 'cube' | 'sphere' | 'worker' | 'forklift';
  position: [number, number, number];
  color: string;
  size: number;
  rotation?: number; // yaw in radians
  name?: string;
  patrolStart?: [number, number]; // [X, Z]
  patrolEnd?: [number, number];   // [X, Z]
  patrolSpeed?: number;          // m/s
  patrolDirection?: number;      // 1 or -1
  velocity?: [number, number, number]; // [Vx, Vy, Vz] in m/s
}

export interface NavigationDiagnostics {
  currentWaypoint: [number, number] | null;
  currentWaypointIndex: number;
  totalWaypoints: number;
  lastMovedTime: number;
  timeStopped: number;
  obstaclePosition: [number, number] | null;
  obstacleName: string | null;
  routeValidity: 'valid' | 'blocked' | 'deviating';
  replanReason: string;
  routeDiffers: boolean;
  failureExplanation: string | null;
  stoppingDistance?: number;
  availableClearance?: number;
  brakingStatus?: 'cruising' | 'controlled_braking' | 'emergency_braking' | 'stopped';
}

export interface BackendCapabilities {
  physics_engine: string;
  scenario_validation: boolean;
  failure_analysis: boolean;
  deterministic_fallback: boolean;
  human_in_the_loop_approval: boolean;
}

export interface HealthCheckResponse {
  status: string;
  service: string;
  version: string;
  timestamp: string;
  active_modes: string[];
  capabilities: BackendCapabilities;
}
