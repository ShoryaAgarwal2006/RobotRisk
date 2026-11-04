import { create } from 'zustand';
import {
  SimulationMode,
  CameraView,
  BackendStatus,
  InteractiveObject,
  HealthCheckResponse,
  RobotPose,
  RobotConfig,
  RobotStatus,
  NavState,
  SensorData,
  DestinationTarget,
  MissionMetrics,
  PlacementMode,
  AisleBarrier,
  NavigationDiagnostics,
} from '../types/simulation';
import { ChatMessage, ParsedCommand, CommandActionType } from '../types/command';
import {
  parseCommandWithBackend,
  generateTelemetryExplanation,
  generateEventsSummary,
} from '../services/aiCommandParser';
import { WAREHOUSE_CONFIG } from '../simulation/environments/warehouseConfig';
import {
  UserRole,
  Participant,
  MultiplayerMessageType,
  MultiplayerMessage,
  SimTelemetryPayload,
} from '../types/multiplayer';
import { multiplayerService } from '../services/multiplayerService';
import { createSessionApi, joinSessionApi } from '../services/api';
import { PREDEFINED_CHALLENGES } from '../simulation/challenges/challengeLibrary';
import { evaluateSceneTTC } from '../navigation/ttcUtils';
import { flightRecorderService, IncidentType } from '../services/flightRecorder';
import { benchmarkService, BenchmarkRun, MissionOutcome } from '../services/benchmarkService';
import { SpatialRiskLayer, SpatialIncident } from '../services/spatialRiskService';
import { ScenarioSnapshot } from '../services/failureAnalysisService';
import { GeneratedScenario, StagingStatus, ScenarioExecutionStatus, AuthoritativeExecutionRecord } from '../types/scenario';
import { SimulationSnapshot, clonePlainSnapshotData, verifyRollbackState } from './snapshotUtils';
import { physicsMountRegistry } from '../simulation/PhysicsMountRegistry';

interface SimulationState {
  // Mode selection (Unified engine)
  mode: SimulationMode;
  setMode: (mode: SimulationMode) => void;

  // AI Command Center
  chatMessages: ChatMessage[];
  pendingCommand: ParsedCommand | null;
  isAiThinking: boolean;
  difficulty: 'normal' | 'hard' | 'extreme';
  sendChatMessage: (prompt: string) => Promise<void>;
  approveCommand: (commandId: string) => void;
  rejectCommand: (commandId: string) => void;
  clearChatMessages: () => void;
  spawnWorker: (
    position?: [number, number, number],
    patrolStart?: [number, number],
    patrolEnd?: [number, number],
    speed?: number
  ) => void;
  spawnForklift: (
    position?: [number, number, number],
    patrolStart?: [number, number],
    patrolEnd?: [number, number],
    speed?: number,
    name?: string
  ) => void;
  spawnCrowdedScenario: (count?: number) => void;
  setDifficulty: (level: 'normal' | 'hard' | 'extreme') => void;
  updateInteractiveObjectPosition: (id: string, pos: [number, number, number]) => void;

  // Simulation Clock
  isRunning: boolean;
  timeScale: number;
  currentTime: number;
  togglePlayPause: () => void;
  setTimeScale: (scale: number) => void;
  resetSimulation: () => void;
  tick: (delta: number) => void;

  // Camera Controls
  cameraView: CameraView;
  setCameraView: (view: CameraView) => void;
  cameraResetTrigger: number;
  triggerResetCamera: () => void;

  // Shared Robot State (Unified single AMR instance)
  robotPose: RobotPose;
  robotConfig: RobotConfig;
  robotStatus: RobotStatus;
  needsResetPose: boolean;
  targetResetPos: [number, number, number];
  targetResetRot: number;
  poseResetEpoch: number;
  lastAcknowledgedPoseEpoch: number;

  updateRobotPose: (
    position: [number, number, number],
    rotation: number,
    linearVelocity: number,
    angularVelocity: number
  ) => void;
  setEmergencyStop: (stopped: boolean) => void;
  toggleEmergencyStop: () => void;
  resetRobotPose: (pos?: [number, number, number], rot?: number) => void;
  acknowledgeResetPose: (
    actualPos?: [number, number, number],
    actualYaw?: number,
    ackEpoch?: number
  ) => void;
  recordCollision: (impulse: number, details?: string) => void;
  drainBattery: (amount: number) => void;
  rechargeBattery: () => void;

  // AI Scenario Generator & Staged Simulation Lifecycle
  isScenarioGeneratorOpen: boolean;
  setScenarioGeneratorOpen: (open: boolean) => void;
  stagingStatus: StagingStatus;
  stagingError: string | null;
  stagingTransactionToken: string;
  activeScenarioId: string | null;
  activeScenarioMetadata: GeneratedScenario | null;
  scenarioExecutionStatus: ScenarioExecutionStatus;
  minObservedClearance: number;
  minObservedTtc: number;
  authoritativeExecutionRecord: AuthoritativeExecutionRecord;
  clearActiveScenario: () => void;
  captureSimulationSnapshot: () => SimulationSnapshot;
  applyScenario: (scenario: GeneratedScenario, shouldLaunch?: boolean) => Promise<void>;
  launchCommittedScenario: (scenario: GeneratedScenario) => Promise<void>;
  rollbackToSnapshot: (snapshot: SimulationSnapshot, originalError: Error) => Promise<void>;

  // Autonomous Lab Navigation & Sensor State
  navState: NavState;
  plannedPath: Array<[number, number]>;
  currentWaypointIndex: number;
  selectedDestinationId: string;
  destinations: DestinationTarget[];
  sensorData: SensorData;
  actualTrajectory: Array<[number, number, number]>;
  missionMetrics: MissionMetrics;
  triggerReplanCounter: number;
  navigationPreference: 'default' | 'shortest_safe_path' | 'alternative_route';
  setNavigationPreference: (pref: 'default' | 'shortest_safe_path' | 'alternative_route') => void;

  startMission: (
    destId?: string,
    options?: { preference?: 'default' | 'shortest_safe_path' | 'alternative_route' }
  ) => void;
  pauseMission: () => void;
  resumeMission: () => void;
  abortMission: () => void;
  selectDestination: (destId: string) => void;
  setPlannedPath: (path: Array<[number, number]>) => void;
  updateWaypointIndex: (idx: number) => void;
  updateNavState: (navState: NavState) => void;
  updateSensorData: (data: SensorData) => void;
  appendTrajectoryPoint: (point: [number, number, number]) => void;
  incrementReplan: (reason?: string) => void;
  incrementObstacleDetected: () => void;
  incrementNearMiss: (details?: string) => void;
  triggerReplan: () => void;

  // Real-time Navigation Diagnostics
  diagnostics: NavigationDiagnostics;
  updateDiagnostics: (partial: Partial<NavigationDiagnostics>) => void;

  // Backend Connectivity
  backendStatus: BackendStatus;
  backendInfo: HealthCheckResponse | null;
  setBackendStatus: (status: BackendStatus, info?: HealthCheckResponse | null) => void;

  // Interactive Object Placement Mode
  placementMode: PlacementMode;
  previewPosition: [number, number, number];
  previewRotation: number;
  isPlacementValid: boolean;
  selectedAisleToBlock: string | null;
  setPlacementMode: (mode: PlacementMode, aisleId?: string) => void;
  updatePlacementPreview: (pos: [number, number, number], valid: boolean) => void;
  rotatePlacementPreview: (deltaRad?: number) => void;
  confirmPlacement: () => void;
  cancelPlacement: () => void;

  // Placed Interactive Test Objects
  interactiveObjects: InteractiveObject[];
  selectedObjectId: string | null;
  selectObject: (id: string | null) => void;
  spawnInteractiveObject: (
    type?: 'cube' | 'sphere',
    position?: [number, number, number],
    rotation?: number
  ) => void;
  deleteSelectedObject: () => void;
  deleteInteractiveObject: (id: string) => void;
  clearInteractiveObjects: () => void;

  // Aisle Physical Barriers
  activeBarriers: AisleBarrier[];
  blockAisle: (aisleId: string) => void;
  removeBarrier: (barrierId: string) => void;
  clearAllBarriers: () => void;

  // Collaborative Multiplayer State
  isMultiplayerActive: boolean;
  sessionId: string | null;
  clientId: string | null;
  userRole: UserRole;
  connectionStatus: 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';
  latencyMs: number;
  participants: Participant[];
  isMultiplayerModalOpen: boolean;
  isChallengeLibraryOpen: boolean;

  setMultiplayerModalOpen: (open: boolean) => void;
  setChallengeLibraryOpen: (open: boolean) => void;
  createMultiplayerSession: (userName?: string, preferredRole?: UserRole) => Promise<string>;
  joinMultiplayerSession: (sessionId: string, userName?: string, preferredRole?: UserRole) => Promise<void>;
  leaveMultiplayerSession: () => void;
  setUserRole: (role: UserRole) => void;
  setLatencyMs: (latency: number) => void;
  triggerPredefinedChallenge: (challengeId: string) => void;
  executeChallengeLocally: (challengeId: string) => void;
  broadcastMultiplayer: (msgType: MultiplayerMessageType, payload?: any) => void;
  handleMultiplayerMessage: (msg: MultiplayerMessage) => void;
  applyIncomingTelemetry: (telemetry: SimTelemetryPayload) => void;

  // Black Box Flight Recorder & Telemetry System
  isFlightRecorderOpen: boolean;
  setFlightRecorderOpen: (open: boolean) => void;
  isRecordingFlightData: boolean;
  flightRecorderStats: {
    frameCount: number;
    incidentCount: number;
    duration: number;
    activeRecordingId: string | null;
  };
  startFlightRecording: () => void;
  stopFlightRecording: () => void;
  clearFlightRecordings: () => void;
  recordFlightIncident: (type: IncidentType, description: string, details?: Record<string, any>) => void;

  // Benchmark Center State & Actions
  isBenchmarkCenterOpen: boolean;
  setBenchmarkCenterOpen: (open: boolean) => void;
  saveActiveSessionAsBenchmark: (
    name?: string,
    variantTag?: 'baseline' | 'optimized' | 'custom',
    targetSessionId?: string
  ) => BenchmarkRun | null;

  // Spatial Risk Heatmap State (Phase 5.3D)
  isSpatialHeatmapOpen: boolean;
  setSpatialHeatmapOpen: (open: boolean) => void;
  isSpatialRiskOverlay3DVisible: boolean;
  setSpatialRiskOverlay3DVisible: (visible: boolean) => void;
  spatialRiskActiveLayer: SpatialRiskLayer;
  setSpatialRiskActiveLayer: (layer: SpatialRiskLayer) => void;

  // UI Panels Drawer & Visibility State (Phase 5.5C Layout Optimization)
  isLeftPanelOpen: boolean;
  setLeftPanelOpen: (open: boolean) => void;
  toggleLeftPanel: () => void;
  isRightPanelOpen: boolean;
  setRightPanelOpen: (open: boolean) => void;
  toggleRightPanel: () => void;
  isZenMode: boolean;
  toggleZenMode: () => void;

  // AI Failure Analysis & Optimization Advisor State (Phase 5.4)
  isAdvisorOpen: boolean;
  setAdvisorOpen: (open: boolean) => void;
  advisorSelectedIncident: SpatialIncident | null;
  setAdvisorSelectedIncident: (inc: SpatialIncident | null) => void;
  configHistory: RobotConfig[];
  baselineConfig: RobotConfig | null;
  activeScenarioSnapshot: ScenarioSnapshot | null;
  updateRobotConfig: (partial: Partial<RobotConfig>, reason?: string) => void;
  saveScenarioSnapshot: (benchmarkRunId?: string) => ScenarioSnapshot;
  rollbackRobotConfig: () => boolean;
  rerunSameScenario: () => void;

  // Adversarial Scenario: Vertical Impact Falling Pallet Test
  fallingPalletHazard: FallingPalletHazardState;
  startVerticalImpactScenario: () => void;
  triggerFallingPalletDrop: () => void;
  recordFallingPalletImpact: (impulse: number) => void;
  resetVerticalImpactScenario: () => void;

  // Crash & Recovery State (Falling Object Scenario)
  crashState: CrashState;
  handleFallingObjectCrash: (impulse: number, details?: string) => void;
  restartMissionAfterCrash: () => void;
  continueWithoutRestart: () => void;

  // Event stream
  eventLog: string[];
  addLog: (msg: string) => void;
}

export interface FallingPalletHazardState {
  isActive: boolean;
  palletId: string;
  palletPosition: [number, number, number];
  palletSize: [number, number, number];
  triggerDistance: number;
  isDropped: boolean;
  dropTime: number | null;
  impactTime: number | null;
  hasImpacted: boolean;
  impactImpulse: number | null;
}

export interface CrashState {
  hasCrashed: boolean;
  showConfirmationModal: boolean;
  incidentDetails: {
    objectName: string;
    impulse: number;
    time: number;
    position: [number, number, number];
  } | null;
}

const initialCrashState: CrashState = {
  hasCrashed: false,
  showConfirmationModal: false,
  incidentDetails: null,
};

const initialFallingPalletState: FallingPalletHazardState = {
  isActive: false,
  palletId: 'falling-pallet-1',
  palletPosition: [-8.5, 3.6, -10.5],
  palletSize: [1.2, 0.25, 1.2],
  triggerDistance: 3.0,
  isDropped: false,
  dropTime: null,
  impactTime: null,
  hasImpacted: false,
  impactImpulse: null,
};

const PALETTE = ['#00f0ff', '#ff3366', '#00ff88', '#ffaa00', '#a855f7', '#3b82f6'];

const DEFAULT_ROBOT_CONFIG: RobotConfig = {
  maxLinearSpeed: 3.5, // m/s
  maxAngularSpeed: 2.8, // rad/s
  linearAcceleration: 6.0, // m/s²
  angularAcceleration: 8.0, // rad/s²
  linearDamping: 1.5,
  angularDamping: 2.0,
  wheelRadius: 0.14,
  trackWidth: 0.54,
};

const INITIAL_ROBOT_POS: [number, number, number] = [-14.5, 0.22, -10.5];
const INITIAL_ROBOT_ROT = 0;

const DESTINATIONS: DestinationTarget[] = [
  { id: 'bay-4', name: 'Bay 4 Delivery Drop-off', position: [14.0, 0, 10.5] },
  { id: 'charging-dock', name: 'Automated Charging Dock', position: [-14.5, 0, -10.5] },
  { id: 'inbound-staging', name: 'Inbound Freight Staging', position: [-14.0, 0, 4.0] },
  { id: 'aisle-1', name: 'Aisle 1 Storage Bay', position: [-6.5, 0, 0.0] },
  { id: 'aisle-2', name: 'Aisle 2 Center Crossing', position: [0.0, 0, 0.0] },
  { id: 'aisle-3', name: 'Aisle 3 Storage Bay', position: [6.5, 0, 0.0] },
];

const DEFAULT_DIAGNOSTICS: NavigationDiagnostics = {
  currentWaypoint: null,
  currentWaypointIndex: 0,
  totalWaypoints: 0,
  lastMovedTime: 0,
  timeStopped: 0,
  obstaclePosition: null,
  obstacleName: null,
  routeValidity: 'valid',
  replanReason: 'System Ready',
  routeDiffers: false,
  failureExplanation: null,
};

// Internal debounce tracker for collisions
let lastCollisionTimestamp = 0;
let lastCollidedObjectName = '';

export async function waitForPhysicalPoseReset(
  expectedEpoch: number,
  expectedPos: [number, number, number],
  expectedYaw: number,
  timeoutMs: number = 4000
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const s = useSimulationStore.getState();
    if (!s.needsResetPose && s.lastAcknowledgedPoseEpoch === expectedEpoch) {
      const dx = Math.abs(s.robotPose.position[0] - expectedPos[0]);
      const dy = Math.abs(s.robotPose.position[1] - expectedPos[1]);
      const dz = Math.abs(s.robotPose.position[2] - expectedPos[2]);
      const posDist = Math.hypot(dx, dy, dz);
      let yawDiff = Math.abs(s.robotPose.rotation - expectedYaw);
      while (yawDiff > Math.PI) yawDiff = Math.abs(yawDiff - 2 * Math.PI);
      if (posDist <= 0.05 && yawDiff <= 0.05) {
        return;
      }
    }
    await new Promise((r) => setTimeout(r, 20));
  }
  const s = useSimulationStore.getState();
  throw new Error(
    `Physical pose reset timed out. Epoch: ${s.lastAcknowledgedPoseEpoch}/${expectedEpoch}, needsReset: ${s.needsResetPose}, pos: [${s.robotPose.position.map((n) => n.toFixed(2)).join(', ')}] vs expected [${expectedPos.map((n) => n.toFixed(2)).join(', ')}]`
  );
}

export const useSimulationStore = create<SimulationState>((set, get, api) => {
  (api as any).getServerState = () => api.getState();
  return {
    mode: 'manual',
  setMode: (mode) => {
    set((state) => ({
      mode,
      eventLog: [`[SYSTEM] Mode switched to: ${String(mode || 'manual').toUpperCase()}`, ...state.eventLog.slice(0, 19)],
    }));
  },

  isRunning: true,
  timeScale: 1.0,
  currentTime: 0,

  togglePlayPause: () => {
    set((state) => {
      const nextRunning = !state.isRunning;
      if (state.isMultiplayerActive) {
        multiplayerService.send('set_clock_state', { isRunning: nextRunning });
      }
      return {
        isRunning: nextRunning,
        eventLog: [
          `[CLOCK] Simulation ${nextRunning ? 'Resumed' : 'Paused'}`,
          ...state.eventLog.slice(0, 19),
        ],
      };
    });
  },

  setTimeScale: (timeScale) => {
    set((state) => ({
      timeScale,
      eventLog: [`[CLOCK] Time scale set to ${timeScale}x`, ...state.eventLog.slice(0, 19)],
    }));
  },

  resetSimulation: () => {
    set((state) => ({
      currentTime: 0,
      eventLog: ['[SYSTEM] Simulation reset to t=0.00s', ...state.eventLog.slice(0, 19)],
    }));
  },

  tick: (delta) => {
    set((state) => {
      if (!state.isRunning) return state;

      const isMoving =
        Math.abs(state.robotPose.linearVelocity) > 0.05 ||
        Math.abs(state.robotPose.angularVelocity) > 0.05;

      const drainRate = isMoving ? 0.08 : 0.01;
      const newBattery = Math.max(
        0,
        state.robotStatus.battery - drainRate * delta * state.timeScale
      );

      // Track genuine mission metrics if mission is running
      const metrics = { ...state.missionMetrics };
      if (metrics.missionStatus === 'running') {
        metrics.missionTime += delta * state.timeScale;
        if (!isMoving) {
          metrics.timeStopped += delta * state.timeScale;
        }
      }

      // Update diagnostics timeStopped
      const diagnostics = { ...state.diagnostics };
      if (metrics.missionStatus === 'running') {
        diagnostics.timeStopped = metrics.timeStopped;
      }

      // Update moving actors (workers & forklifts) along patrol routes
      let objects = state.interactiveObjects;
      const hasActors = objects.some(
        (o) => (o.type === 'worker' || o.type === 'forklift') && o.patrolStart && o.patrolEnd
      );
      if (hasActors) {
        objects = objects.map((obj) => {
          if ((obj.type === 'worker' || obj.type === 'forklift') && obj.patrolStart && obj.patrolEnd) {
            const [sx, sz] = obj.patrolStart;
            const [ex, ez] = obj.patrolEnd;
            const defaultSpeed = obj.type === 'forklift' ? 1.4 : 1.1;
            const speed = obj.patrolSpeed || defaultSpeed;
            let dir = obj.patrolDirection || 1;
            const dx = ex - sx;
            const dz = ez - sz;
            const len = Math.hypot(dx, dz);
            if (len < 0.1) return obj;

            const ux = dx / len;
            const uz = dz / len;

            const curDx = obj.position[0] - sx;
            const curDz = obj.position[2] - sz;
            let progress = curDx * ux + curDz * uz;

            progress += speed * delta * state.timeScale * dir;
            if (progress >= len) {
              progress = len;
              dir = -1;
            } else if (progress <= 0) {
              progress = 0;
              dir = 1;
            }

            const nx = sx + ux * progress;
            const nz = sz + uz * progress;
            const heading = dir > 0 ? Math.atan2(dx, dz) : Math.atan2(-dx, -dz);
            const vx = ux * speed * dir;
            const vz = uz * speed * dir;

            return {
              ...obj,
              position: [nx, obj.position[1], nz] as [number, number, number],
              rotation: heading,
              patrolDirection: dir,
              velocity: [vx, 0, vz] as [number, number, number],
            };
          }
          return obj;
        });
      }

      const newCurrentTime = state.currentTime + delta * state.timeScale;

      // Sample Flight Recorder frame at 10 Hz against authoritative simulation clock
      let recorderStats = state.flightRecorderStats;
      if (state.isRecordingFlightData) {
        flightRecorderService.sampleFrame(
          newCurrentTime,
          state.robotPose,
          state.navState,
          state.sensorData,
          objects,
          state.activeBarriers,
          {
            brakingStatus: diagnostics.brakingStatus,
            routeValidity: diagnostics.routeValidity,
            replanCount: metrics.replanCount,
          }
        );
        const curSession = flightRecorderService.getCurrentSession();
        if (curSession) {
          recorderStats = {
            frameCount: curSession.frames.length,
            incidentCount: curSession.incidents.length,
            duration: Number((newCurrentTime - curSession.startTimeSim).toFixed(1)),
            activeRecordingId: curSession.recordingId,
          };
        }
      }

      return {
        currentTime: newCurrentTime,
        robotStatus: {
          ...state.robotStatus,
          battery: newBattery,
        },
        missionMetrics: metrics,
        diagnostics,
        interactiveObjects: objects,
        flightRecorderStats: recorderStats,
      };
    });
  },

  cameraView: 'follow',
  setCameraView: (cameraView) => set({ cameraView }),
  cameraResetTrigger: 0,
  triggerResetCamera: () =>
    set((state) => ({
      cameraResetTrigger: state.cameraResetTrigger + 1,
      eventLog: ['[CAMERA] Reset view angle to default', ...state.eventLog.slice(0, 19)],
    })),

  // Robot State
  robotPose: {
    position: INITIAL_ROBOT_POS,
    rotation: INITIAL_ROBOT_ROT,
    linearVelocity: 0,
    angularVelocity: 0,
  },
  robotConfig: DEFAULT_ROBOT_CONFIG,
  robotStatus: {
    battery: 100,
    isEmergencyStopped: false,
    collisionCount: 0,
    lastCollisionForce: 0,
  },
  needsResetPose: false,
  targetResetPos: INITIAL_ROBOT_POS,
  targetResetRot: INITIAL_ROBOT_ROT,
  poseResetEpoch: 0,
  lastAcknowledgedPoseEpoch: 0,

  updateRobotPose: (position, rotation, linearVelocity, angularVelocity) => {
    set((state) => {
      // Calculate true displacement delta from previous physical pose
      const prevPos = state.robotPose.position;
      const dx = position[0] - prevPos[0];
      const dz = position[2] - prevPos[2];
      const stepDist = Math.hypot(dx, dz);

      let newDist = state.missionMetrics.distanceTravelled;
      // Accumulate only physically realistic movement steps (exclude resets > 2.0m)
      if (state.missionMetrics.missionStatus === 'running' && stepDist > 0.001 && stepDist < 2.0) {
        newDist += stepDist;
      }

      // Track last moved timestamp when robot actually moves
      let lastMovedTime = state.diagnostics.lastMovedTime;
      if (stepDist > 0.02) {
        lastMovedTime = state.currentTime;
      }

      return {
        robotPose: {
          position,
          rotation,
          linearVelocity,
          angularVelocity,
        },
        missionMetrics: {
          ...state.missionMetrics,
          distanceTravelled: newDist,
        },
        diagnostics: {
          ...state.diagnostics,
          lastMovedTime,
        },
      };
    });
  },

  setEmergencyStop: (stopped) => {
    set((state) => {
      if (state.isMultiplayerActive && state.userRole === 'controller') {
        return {
          eventLog: [
            '[SAFETY] Permission Denied: Emergency Stop control is reserved for Robot Operator.',
            ...state.eventLog.slice(0, 19),
          ],
        };
      }
      if (state.isMultiplayerActive && state.userRole === 'operator') {
        multiplayerService.send('emergency_stop', { isEmergencyStopped: stopped });
      }
      if (state.isRecordingFlightData && stopped) {
        flightRecorderService.recordIncident(
          'EMERGENCY_BRAKING',
          'Emergency Stop Engaged manually by operator!',
          state.currentTime,
          state.robotPose,
          'STOPPED',
          state.sensorData,
          state.interactiveObjects,
          state.activeBarriers
        );
      }
      return {
        robotStatus: {
          ...state.robotStatus,
          isEmergencyStopped: stopped,
        },
        navState: stopped ? 'STOPPED' : state.navState === 'STOPPED' ? 'IDLE' : state.navState,
        eventLog: [
          `[SAFETY] Emergency Stop ${stopped ? 'ENGAGED' : 'DISENGAGED'}`,
          ...state.eventLog.slice(0, 19),
        ],
      };
    });
  },

  toggleEmergencyStop: () => {
    set((state) => {
      if (state.isMultiplayerActive && state.userRole === 'controller') {
        return {
          eventLog: [
            '[SAFETY] Permission Denied: Emergency Stop control is reserved for Robot Operator.',
            ...state.eventLog.slice(0, 19),
          ],
        };
      }
      const next = !state.robotStatus.isEmergencyStopped;
      if (state.isMultiplayerActive && state.userRole === 'operator') {
        multiplayerService.send('emergency_stop', { isEmergencyStopped: next });
      }
      return {
        robotStatus: {
          ...state.robotStatus,
          isEmergencyStopped: next,
        },
        navState: next ? 'STOPPED' : state.navState === 'STOPPED' ? 'IDLE' : state.navState,
        eventLog: [
          `[SAFETY] Emergency Stop ${next ? 'ENGAGED' : 'DISENGAGED'}`,
          ...state.eventLog.slice(0, 19),
        ],
      };
    });
  },

  resetRobotPose: (pos = INITIAL_ROBOT_POS, rot = INITIAL_ROBOT_ROT) => {
    if (get().isMultiplayerActive && get().userRole !== 'operator') {
      get().addLog('[PERMISSION DENIED] Resetting robot pose is reserved for Robot Operator (Device A).');
      return;
    }
    set((state) => ({
      needsResetPose: true,
      targetResetPos: pos,
      targetResetRot: rot,
      robotPose: {
        position: pos,
        rotation: rot,
        linearVelocity: 0,
        angularVelocity: 0,
      },
      robotStatus: {
        ...state.robotStatus,
        isEmergencyStopped: false,
      },
      navState: 'IDLE',
      plannedPath: [],
      currentWaypointIndex: 0,
      actualTrajectory: [pos],
      missionMetrics: {
        missionStatus: 'idle',
        missionTime: 0,
        distanceTravelled: 0,
        obstaclesDetected: 0,
        replanCount: 0,
        timeStopped: 0,
        collisions: 0,
        nearMisses: 0,
      },
      diagnostics: {
        ...DEFAULT_DIAGNOSTICS,
        lastMovedTime: state.currentTime,
      },
      eventLog: [
        `[ROBOT] Reset position to [${pos[0]}, ${pos[1]}, ${pos[2]}]`,
        ...state.eventLog.slice(0, 19),
      ],
    }));
  },

  acknowledgeResetPose: (actualPos, actualYaw, ackEpoch) => {
    set((state) => ({
      needsResetPose: false,
      lastAcknowledgedPoseEpoch: ackEpoch !== undefined ? ackEpoch : state.poseResetEpoch,
      ...(actualPos && actualYaw !== undefined
        ? {
            robotPose: {
              ...state.robotPose,
              position: actualPos,
              rotation: actualYaw,
              linearVelocity: 0,
              angularVelocity: 0,
            },
          }
        : {}),
    }));
  },

  // AI Scenario Generator & Staged Simulation Lifecycle
  isScenarioGeneratorOpen: false,
  setScenarioGeneratorOpen: (open) => set({ isScenarioGeneratorOpen: open }),
  stagingStatus: 'IDLE',
  stagingError: null,
  stagingTransactionToken: 'INIT',
  activeScenarioId: null,
  activeScenarioMetadata: null,
  scenarioExecutionStatus: 'IDLE',
  minObservedClearance: Infinity,
  minObservedTtc: Infinity,
  authoritativeExecutionRecord: {
    scenarioId: null,
    scenarioTitle: null,
    recordingSessionId: null,
    executionId: null,
    startTime: 0,
    missionStatus: 'IDLE',
    collisionCount: 0,
    nearMissCount: 0,
    minObservedClearance: null,
    minObservedTtc: null,
    currentClearance: null,
    currentTtc: null,
    safetyStatus: 'SAFE',
    failureReason: null,
  },

  clearActiveScenario: () => {
    console.log('[SCENARIO_DEBUG] Clearing active scenario');
    set({
      activeScenarioId: null,
      activeScenarioMetadata: null,
      interactiveObjects: [],
      activeBarriers: [],
      stagingStatus: 'IDLE',
      scenarioExecutionStatus: 'IDLE',
      minObservedClearance: Infinity,
      minObservedTtc: Infinity,
      robotStatus: {
        ...get().robotStatus,
        collisionCount: 0,
      },
      missionMetrics: {
        ...get().missionMetrics,
        collisions: 0,
        nearMisses: 0,
      },
      authoritativeExecutionRecord: {
        scenarioId: null,
        scenarioTitle: null,
        recordingSessionId: null,
        executionId: null,
        startTime: 0,
        missionStatus: 'IDLE',
        collisionCount: 0,
        nearMissCount: 0,
        minObservedClearance: null,
        minObservedTtc: null,
        currentClearance: null,
        currentTtc: null,
        safetyStatus: 'SAFE',
        failureReason: null,
      },
      eventLog: ['[SCENARIO] Active scenario cleared from simulation.', ...get().eventLog.slice(0, 19)],
    });
  },

  captureSimulationSnapshot: (): SimulationSnapshot => {
    const s = get();
    return clonePlainSnapshotData({
      isRunning: s.isRunning,
      currentTime: s.currentTime,
      timeScale: s.timeScale,
      interactiveObjects: s.interactiveObjects,
      activeBarriers: s.activeBarriers,
      robotPose: {
        position: [...s.robotPose.position],
        rotation: s.robotPose.rotation,
        linearVelocity: s.robotPose.linearVelocity,
        angularVelocity: s.robotPose.angularVelocity,
      },
      needsResetPose: s.needsResetPose,
      targetResetPos: [...s.targetResetPos],
      targetResetRot: s.targetResetRot,
      poseResetEpoch: s.poseResetEpoch,
      lastAcknowledgedPoseEpoch: s.lastAcknowledgedPoseEpoch,
      selectedDestinationId: s.selectedDestinationId,
      difficulty: s.difficulty,
      navigationPreference: s.navigationPreference,
      activeScenarioId: s.activeScenarioId,
      activeScenarioMetadata: s.activeScenarioMetadata,
      isEmergencyStopped: s.robotStatus.isEmergencyStopped,
      navState: s.navState,
      missionMetrics: { ...s.missionMetrics },
      actualTrajectory: s.actualTrajectory.map((p) => [...p] as [number, number, number]),
      diagnostics: { ...s.diagnostics },
    });
  },

  applyScenario: async (scenario: GeneratedScenario, shouldLaunch = true) => {
    const s = get();
    if (s.isMultiplayerActive) {
      throw new Error(
        'Cannot apply AI scenarios while a multiplayer session is active. Please leave or disconnect the session first.'
      );
    }
    if (s.isRecordingFlightData) {
      throw new Error(
        'Cannot apply AI scenario while a Flight Recording is actively running. Please stop the current recording first.'
      );
    }

    // 1. Capture complete undisturbed pre-staging simulation snapshot
    const snapshot = s.captureSimulationSnapshot();

    // 2. Pause the simulation clock
    set({
      isRunning: false,
      stagingStatus: 'STAGING',
      stagingError: null,
      eventLog: [
        `[SCENARIO] Initiating staged application for "${scenario.title}"...`,
        ...get().eventLog.slice(0, 19),
      ],
    });

    try {
      const transactionToken = `tx_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      const nextPoseEpoch = get().poseResetEpoch + 1;

      // 3. Map actors and static hazards
      const mappedActors: InteractiveObject[] = scenario.actors.map((actor) => {
        const [sx, sz] = actor.patrol_start;
        const [ex, ez] = actor.patrol_end;
        const dx = ex - sx;
        const dz = ez - sz;
        const len = Math.hypot(dx, dz);
        const dir = actor.direction || 1;
        const ux = len > 0.001 ? dx / len : 0;
        const uz = len > 0.001 ? dz / len : 0;
        const vx = ux * actor.patrol_speed * dir;
        const vz = uz * actor.patrol_speed * dir;

        return {
          id: actor.id,
          type: actor.actor_type,
          position: actor.spawn_position,
          rotation: actor.initial_heading_rad,
          color: actor.color || (actor.actor_type === 'forklift' ? '#eab308' : '#f97316'),
          size: actor.actor_type === 'forklift' ? 1.0 : 0.6,
          name: actor.name || (actor.actor_type === 'forklift' ? 'Heavy Industrial Forklift' : 'Warehouse Worker'),
          patrolStart: actor.patrol_start,
          patrolEnd: actor.patrol_end,
          patrolSpeed: actor.patrol_speed,
          patrolDirection: dir,
          velocity: [vx, 0, vz],
        };
      });

      const mappedBarriers: AisleBarrier[] = [];
      const hazardsAsObjects: InteractiveObject[] = [];

      scenario.static_hazards.forEach((hazard) => {
        if (hazard.hazard_type === 'barrier') {
          const w = hazard.size?.[0] ?? 2.4;
          const d = hazard.size?.[1] ?? 0.4;
          const h = hazard.size?.[2] ?? 1.1;
          const posY = hazard.position[1] > 0.05 ? hazard.position[1] : h / 2;
          mappedBarriers.push({
            id: hazard.id,
            aisleId: hazard.aisle_id || `aisle-${hazard.id}`,
            name: hazard.name || hazard.id,
            position: [hazard.position[0], posY, hazard.position[2]],
            width: w,
            height: h,
            depth: d,
            rotation: hazard.rotation_rad || 0,
          });
        } else {
          const sz = hazard.size?.[0] ?? 0.8;
          const posY = hazard.position[1] > 0.05 ? hazard.position[1] : sz / 2;
          hazardsAsObjects.push({
            id: hazard.id,
            type: hazard.hazard_type === 'sphere' ? 'sphere' : 'cube',
            position: [hazard.position[0], posY, hazard.position[2]],
            size: sz,
            color: '#f59e0b',
            name: hazard.name || `${hazard.hazard_type} (${hazard.id})`,
            rotation: hazard.rotation_rad || 0,
            velocity: [0, 0, 0],
          });
        }
      });

      // Match destination by ID or Name
      const targetDest =
        get().destinations.find(
          (d) =>
            d.id.toLowerCase() === scenario.robot_setup.destination_id.toLowerCase() ||
            d.name.toLowerCase() === scenario.robot_setup.destination_name.toLowerCase()
        ) || get().destinations[0];

      const difficultyLevel = (
        ['normal', 'hard', 'extreme'].includes(scenario.difficulty.toLowerCase())
          ? scenario.difficulty.toLowerCase()
          : 'normal'
      ) as 'normal' | 'hard' | 'extreme';

      // 4. Stage state in Zustand
      set({
        stagingTransactionToken: transactionToken,
        poseResetEpoch: nextPoseEpoch,
        needsResetPose: true,
        targetResetPos: scenario.robot_setup.start_position,
        targetResetRot: scenario.robot_setup.start_rotation_rad,
        robotPose: {
          position: [...scenario.robot_setup.start_position],
          rotation: scenario.robot_setup.start_rotation_rad,
          linearVelocity: 0,
          angularVelocity: 0,
        },
        interactiveObjects: [...mappedActors, ...hazardsAsObjects],
        activeBarriers: mappedBarriers,
        difficulty: difficultyLevel,
        selectedDestinationId: targetDest.id,
        triggerReplanCounter: get().triggerReplanCounter + 1,
      });

      // 5. Asynchronously await Rapier bodies and colliders mounting
      const expectedEntityIds = [
        ...scenario.actors.map((a) => a.id),
        ...scenario.static_hazards.map((h) => h.id),
      ];
      await physicsMountRegistry.waitForAllMounted(transactionToken, expectedEntityIds, 5000);

      // 6. Asynchronously await AMR physical pose reset acknowledgement
      await waitForPhysicalPoseReset(
        nextPoseEpoch,
        scenario.robot_setup.start_position,
        scenario.robot_setup.start_rotation_rad,
        4000
      );

      // 7. Verification succeeded: Commit scenario
      set({
        stagingStatus: 'COMMITTED',
        activeScenarioId: scenario.scenario_id,
        activeScenarioMetadata: scenario,
        scenarioExecutionStatus: 'STAGED',
        minObservedClearance: Infinity,
        minObservedTtc: Infinity,
        authoritativeExecutionRecord: {
          scenarioId: scenario.scenario_id,
          scenarioTitle: scenario.title,
          recordingSessionId: null,
          executionId: null,
          startTime: get().currentTime,
          missionStatus: 'STAGED',
          collisionCount: 0,
          nearMissCount: 0,
          minObservedClearance: null,
          minObservedTtc: null,
          currentClearance: null,
          currentTtc: null,
          safetyStatus: 'SAFE',
          failureReason: null,
        },
        robotStatus: {
          ...get().robotStatus,
          collisionCount: 0,
        },
        missionMetrics: {
          ...get().missionMetrics,
          collisions: 0,
          nearMisses: 0,
        },
        eventLog: [
          `[SCENARIO] Successfully staged & verified scenario "${scenario.title}" (${scenario.generator_engine})`,
          ...get().eventLog.slice(0, 19),
        ],
      });
      console.log('[SCENARIO_DEBUG] Scenario committed successfully:', {
        scenario_id: scenario.scenario_id,
        title: scenario.title,
        engine: scenario.generator_engine,
        actorCount: scenario.actors.length,
      });

      // 8. Launch mission if requested
      if (shouldLaunch) {
        await get().launchCommittedScenario(scenario);
      }
    } catch (err: any) {
      set({
        stagingStatus: 'ROLLING_BACK',
        stagingError: err.message || 'Staging failure',
        eventLog: [
          `[SCENARIO ERROR] Staging failed: ${err.message}. Initiating rollback to previous state...`,
          ...get().eventLog.slice(0, 19),
        ],
      });
      await get().rollbackToSnapshot(snapshot, err);
    }
  },

  rollbackToSnapshot: async (snapshot: SimulationSnapshot, originalError: Error) => {
    try {
      const rollbackToken = `tx_rb_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      const rollbackEpoch = get().poseResetEpoch + 1;

      // 1. Restore all captured Zustand fields with safe policy normalization
      set({
        stagingTransactionToken: rollbackToken,
        poseResetEpoch: rollbackEpoch,
        needsResetPose: true,
        targetResetPos: [...snapshot.robotPose.position],
        targetResetRot: snapshot.robotPose.rotation,
        robotPose: {
          position: [...snapshot.robotPose.position],
          rotation: snapshot.robotPose.rotation,
          linearVelocity: 0,
          angularVelocity: 0,
        },
        robotStatus: {
          ...get().robotStatus,
          isEmergencyStopped: snapshot.isEmergencyStopped,
        },
        interactiveObjects: snapshot.interactiveObjects.map((obj) => ({
          ...obj,
          velocity: [0, 0, 0], // Enforce zero-velocity recovery policy
        })),
        activeBarriers: snapshot.activeBarriers.map((b) => ({ ...b })),
        selectedDestinationId: snapshot.selectedDestinationId || 'bay-4',
        difficulty: snapshot.difficulty,
        navigationPreference: snapshot.navigationPreference,
        navState: snapshot.navState,
        missionMetrics: { ...snapshot.missionMetrics },
        actualTrajectory: snapshot.actualTrajectory.map((p) => [...p] as [number, number, number]),
        diagnostics: { ...snapshot.diagnostics },
        activeScenarioId: snapshot.activeScenarioId,
        activeScenarioMetadata: snapshot.activeScenarioMetadata,
        currentTime: snapshot.currentTime,
        timeScale: snapshot.timeScale,
        triggerReplanCounter: get().triggerReplanCounter + 1,
        isRunning: false, // Critical safety policy: stay paused
      });

      // 2. Wait for restored Rapier physics bodies to mount
      const expectedRestoreIds = [
        ...snapshot.interactiveObjects.map((o) => o.id),
        ...snapshot.activeBarriers.map((b) => b.id),
      ];
      if (expectedRestoreIds.length > 0) {
        await physicsMountRegistry.waitForAllMounted(rollbackToken, expectedRestoreIds, 5000);
      }

      // 3. Wait for AMR physical pose reset handshake
      await waitForPhysicalPoseReset(
        rollbackEpoch,
        snapshot.robotPose.position,
        snapshot.robotPose.rotation,
        4000
      );

      // 4. Exhaustive verification of all fields against snapshot
      const current = {
        ...get(),
        robotStatus: get().robotStatus,
        isEmergencyStopped: get().robotStatus.isEmergencyStopped,
      };
      const verification = verifyRollbackState(current, snapshot, rollbackEpoch);
      if (!verification.passed) {
        throw new Error(
          `Exhaustive rollback verification failed:\n- ${verification.mismatches.join('\n- ')}`
        );
      }

      set({
        stagingStatus: 'FAILED',
        stagingError: `Scenario failed to stage: ${originalError.message}. Successfully rolled back to previous state.`,
        eventLog: [
          `[SCENARIO ROLLBACK] Previous simulation state successfully restored and verified. Simulation safely paused.`,
          ...get().eventLog.slice(0, 19),
        ],
      });
    } catch (recoveryErr: any) {
      set({
        stagingStatus: 'RECOVERY_FAILED',
        stagingError: `Rollback verification failed: ${recoveryErr.message}. (Original error: ${originalError.message})`,
        isRunning: false,
        eventLog: [
          `[CRITICAL RECOVERY FAILURE] Rollback state verification failed! Simulation locked in pause: ${recoveryErr.message}`,
          ...get().eventLog.slice(0, 19),
        ],
      });
    }
  },

  launchCommittedScenario: async (scenario: GeneratedScenario) => {
    try {
      const s = get();
      const isAuthoritative = !s.isMultiplayerActive || s.userRole === 'operator';
      const role: 'operator' | 'controller' | 'local' = s.isMultiplayerActive
        ? s.userRole === 'operator'
          ? 'operator'
          : 'controller'
        : 'local';
      const activeSession = s.sessionId || 'LOCAL-SIMULATION';

      // 1. Start Flight Recorder session with scenario metadata
      const recordingSession = flightRecorderService.startRecording(
        s.currentTime,
        isAuthoritative,
        role,
        activeSession,
        {
          scenarioId: scenario.scenario_id,
          scenarioTitle: scenario.title,
          generatorEngine: scenario.generator_engine,
          scenarioSeed: scenario.seed,
        }
      );

      set({
        isRecordingFlightData: true,
        flightRecorderStats: {
          frameCount: 0,
          incidentCount: 0,
          duration: 0,
          activeRecordingId: recordingSession.recordingId,
        },
        eventLog: [
          `[FLIGHT RECORDER] Started flight recording for scenario "${scenario.title}" (${recordingSession.recordingId})`,
          ...get().eventLog.slice(0, 19),
        ],
      });

      // 2. Switch simulation mode to 'autonomous' so Autonomous HUD & telemetry deck are active
      const executionId = `exec_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      lastCollisionTimestamp = 0;
      lastCollidedObjectName = '';
      set({
        mode: 'autonomous',
        scenarioExecutionStatus: 'RUNNING',
        minObservedClearance: Infinity,
        minObservedTtc: Infinity,
        authoritativeExecutionRecord: {
          scenarioId: scenario.scenario_id,
          scenarioTitle: scenario.title,
          recordingSessionId: recordingSession.recordingId,
          executionId,
          startTime: s.currentTime,
          missionStatus: 'RUNNING',
          collisionCount: 0,
          nearMissCount: 0,
          minObservedClearance: null,
          minObservedTtc: null,
          currentClearance: null,
          currentTtc: null,
          safetyStatus: 'SAFE',
          failureReason: null,
        },
        robotStatus: {
          ...get().robotStatus,
          collisionCount: 0,
        },
        missionMetrics: {
          ...get().missionMetrics,
          collisions: 0,
          nearMisses: 0,
        },
      });

      // 3. Start autonomous mission
      get().startMission(get().selectedDestinationId, {
        preference: get().navigationPreference,
      });

      // 4. Resume simulation clock
      set({ isRunning: true });
      console.log('[SCENARIO_DEBUG] Scenario mission successfully launched in autonomous mode:', {
        scenario_id: scenario.scenario_id,
        title: scenario.title,
        engine: scenario.generator_engine,
      });
    } catch (launchErr: any) {
      // Failure boundary: discard only newly started Flight Recorder session
      flightRecorderService.discardCurrentSession();
      set({
        isRecordingFlightData: false,
        isRunning: false,
        stagingStatus: 'RECOVERY_FAILED',
        stagingError: `Scenario launch failed: ${launchErr.message}`,
      });
      throw launchErr;
    }
  },

  recordCollision: (impulse, details = 'Obstacle') => {
    const now = Date.now();
    // Debounce collisions with the same collider within 400ms to prevent duplicate counting
    if (now - lastCollisionTimestamp < 400 && details === lastCollidedObjectName) {
      return;
    }
    lastCollisionTimestamp = now;
    lastCollidedObjectName = details;

    const s = get();
    // Intercept falling object collision
    const isFallingHazard =
      details === 'Heavy-Overhead-Cargo-Pallet' || details === 'Heavy Overhead Falling Pallet';
    if (isFallingHazard) {
      if (!s.crashState.hasCrashed && !s.fallingPalletHazard.hasImpacted) {
        s.handleFallingObjectCrash(impulse, details);
      }
      return;
    }

    set((state) => {
      if (state.isRecordingFlightData) {
        flightRecorderService.recordIncident(
          'COLLISION',
          `Collision impact with ${details}! Force: ${impulse.toFixed(1)} N`,
          state.currentTime,
          state.robotPose,
          state.navState,
          state.sensorData,
          state.interactiveObjects,
          state.activeBarriers,
          { impulse, obstacle: details }
        );
      }
      return {
        robotStatus: {
          ...state.robotStatus,
          collisionCount: state.robotStatus.collisionCount + 1,
          lastCollisionForce: impulse,
        },
        missionMetrics: {
          ...state.missionMetrics,
          collisions: state.missionMetrics.collisions + 1,
        },
        authoritativeExecutionRecord: {
          ...state.authoritativeExecutionRecord,
          collisionCount: state.authoritativeExecutionRecord.collisionCount + 1,
          safetyStatus: 'CRITICAL',
        },
        eventLog: [
          `[COLLISION] Impact with ${details}! Force: ${impulse.toFixed(1)} N`,
          ...state.eventLog.slice(0, 19),
        ],
      };
    });
  },

  drainBattery: (amount) => {
    set((state) => ({
      robotStatus: {
        ...state.robotStatus,
        battery: Math.max(0, state.robotStatus.battery - amount),
      },
    }));
  },

  rechargeBattery: () => {
    set((state) => ({
      robotStatus: {
        ...state.robotStatus,
        battery: 100,
      },
      eventLog: ['[POWER] Battery recharged to 100%', ...state.eventLog.slice(0, 19)],
    }));
  },

  // Autonomous Lab Navigation State
  navState: 'IDLE',
  plannedPath: [],
  currentWaypointIndex: 0,
  selectedDestinationId: 'bay-4',
  destinations: DESTINATIONS,
  sensorData: {
    forwardDist: 5.5,
    leftDist: 3.0,
    rightDist: 3.0,
    riskLevel: 'clear',
    closestObstacle: null,
    obstaclePosition: null,
    ttc: null,
    safetyStatus: 'SAFE',
    highestRiskObstacle: null,
    minClearance: 999.0,
    isCollisionCourse: false,
  },
  actualTrajectory: [INITIAL_ROBOT_POS],
  missionMetrics: {
    missionStatus: 'idle',
    missionTime: 0,
    distanceTravelled: 0,
    obstaclesDetected: 0,
    replanCount: 0,
    timeStopped: 0,
    collisions: 0,
    nearMisses: 0,
  },
  triggerReplanCounter: 0,
  navigationPreference: 'default',
  setNavigationPreference: (pref) => {
    set({ navigationPreference: pref });
  },

  diagnostics: DEFAULT_DIAGNOSTICS,
  updateDiagnostics: (partial) => {
    set((state) => ({
      diagnostics: { ...state.diagnostics, ...partial },
    }));
  },

  // Black Box Flight Recorder & Telemetry Actions
  isFlightRecorderOpen: false,
  setFlightRecorderOpen: (open) => set({ isFlightRecorderOpen: open }),
  isRecordingFlightData: false,
  flightRecorderStats: {
    frameCount: 0,
    incidentCount: 0,
    duration: 0,
    activeRecordingId: null,
  },

  startFlightRecording: () => {
    const s = get();
    const isAuthoritative = !s.isMultiplayerActive || s.userRole === 'operator';
    const role: 'operator' | 'controller' | 'local' = s.isMultiplayerActive ? (s.userRole === 'operator' ? 'operator' : 'controller') : 'local';
    const activeSession = s.sessionId || 'LOCAL-SIMULATION';

    const session = flightRecorderService.startRecording(s.currentTime, isAuthoritative, role, activeSession);

    set((state) => ({
      isRecordingFlightData: true,
      flightRecorderStats: {
        frameCount: 0,
        incidentCount: 0,
        duration: 0,
        activeRecordingId: session.recordingId,
      },
      eventLog: [
        `[FLIGHT RECORDER] Started recording flight log (${session.recordingId}) [${isAuthoritative ? 'AUTHORITATIVE' : 'REMOTE MIRROR'}]`,
        ...state.eventLog.slice(0, 19),
      ],
    }));
  },

  stopFlightRecording: () => {
    const s = get();
    const completed = flightRecorderService.stopRecording(s.currentTime);

    set((state) => ({
      isRecordingFlightData: false,
      flightRecorderStats: {
        frameCount: completed?.frames.length ?? state.flightRecorderStats.frameCount,
        incidentCount: completed?.incidents.length ?? state.flightRecorderStats.incidentCount,
        duration: completed ? Number((completed.endTimeSim - completed.startTimeSim).toFixed(1)) : 0,
        activeRecordingId: null,
      },
      eventLog: [
        `[FLIGHT RECORDER] Recording stopped (${completed?.recordingId}). Captured ${completed?.frames.length || 0} frames, ${completed?.incidents.length || 0} incidents.`,
        ...state.eventLog.slice(0, 19),
      ],
    }));
  },

  clearFlightRecordings: () => {
    flightRecorderService.clearAllSessions();
    set((state) => ({
      isRecordingFlightData: false,
      flightRecorderStats: {
        frameCount: 0,
        incidentCount: 0,
        duration: 0,
        activeRecordingId: null,
      },
      eventLog: ['[FLIGHT RECORDER] Cleared all recorded flight sessions.', ...state.eventLog.slice(0, 19)],
    }));
  },

  recordFlightIncident: (type, description, details) => {
    const s = get();
    if (s.isRecordingFlightData) {
      flightRecorderService.recordIncident(
        type,
        description,
        s.currentTime,
        s.robotPose,
        s.navState,
        s.sensorData,
        s.interactiveObjects,
        s.activeBarriers,
        details
      );
    }
  },

  // Benchmark Center Actions
  isBenchmarkCenterOpen: false,
  setBenchmarkCenterOpen: (open) => set({ isBenchmarkCenterOpen: open }),
  saveActiveSessionAsBenchmark: (name, variantTag = 'custom', targetSessionId) => {
    const s = get();
    const allSessions = flightRecorderService.getAllSessions();
    const session = targetSessionId
      ? allSessions.find((sess) => sess.recordingId === targetSessionId) || flightRecorderService.getCurrentSession()
      : flightRecorderService.getCurrentSession() || flightRecorderService.getPastSessions()[0];

    if (!session) {
      s.addLog('[BENCHMARK] Error: No flight recording session found to benchmark.');
      return null;
    }

    // Accurate Mission Outcome Classification (Requirement 1)
    let outcome: MissionOutcome = 'COMPLETED';
    if (s.navState === 'COMPLETED' || s.missionMetrics.missionStatus === 'completed') {
      outcome = 'COMPLETED';
    } else if (s.navState === 'FAILED' || s.missionMetrics.missionStatus === 'failed') {
      outcome = 'FAILED';
    } else {
      outcome = 'ABORTED';
    }

    const targetDest = s.destinations.find((d) => d.id === s.selectedDestinationId) || null;
    const envName = s.activeBarriers.length > 0
      ? `Warehouse (${s.activeBarriers[0].name || 'Barricaded'})`
      : s.interactiveObjects.length > 0
      ? `Warehouse (${s.interactiveObjects.length} Hazards)`
      : 'Warehouse (Baseline)';

    const { run, evictedRunId } = benchmarkService.createRunFromSession(
      session,
      outcome,
      s.robotConfig,
      targetDest,
      s.navigationPreference,
      envName,
      'normal',
      name,
      variantTag
    );

    const logMsg = evictedRunId
      ? `[BENCHMARK] Saved Run "${run.name}" (Capacity reached: oldest run ${evictedRunId} was archived)`
      : `[BENCHMARK] Saved Run "${run.name}" (${run.indicators.compositeSafetyScore}/100 Safety Rating)`;

    s.addLog(logMsg);
    return run;
  },

  // Spatial Risk Heatmap State & Actions (Phase 5.3D)
  isSpatialHeatmapOpen: false,
  setSpatialHeatmapOpen: (open) => set({ isSpatialHeatmapOpen: open }),
  isSpatialRiskOverlay3DVisible: true,
  setSpatialRiskOverlay3DVisible: (visible) => set({ isSpatialRiskOverlay3DVisible: visible }),
  spatialRiskActiveLayer: 'COMBINED',
  setSpatialRiskActiveLayer: (layer) => set({ spatialRiskActiveLayer: layer }),

  // UI Panels Drawer & Visibility Actions (Phase 5.5C Layout Optimization)
  isLeftPanelOpen: true,
  setLeftPanelOpen: (open) => set({ isLeftPanelOpen: open }),
  toggleLeftPanel: () => set((state) => ({ isLeftPanelOpen: !state.isLeftPanelOpen })),
  isRightPanelOpen: true,
  setRightPanelOpen: (open) => set({ isRightPanelOpen: open }),
  toggleRightPanel: () => set((state) => ({ isRightPanelOpen: !state.isRightPanelOpen })),
  isZenMode: false,
  toggleZenMode: () =>
    set((state) => {
      const nextZen = !state.isZenMode;
      return {
        isZenMode: nextZen,
        isLeftPanelOpen: !nextZen,
        isRightPanelOpen: !nextZen,
      };
    }),

  // AI Failure Analysis & Optimization Advisor State & Actions (Phase 5.4)
  isAdvisorOpen: false,
  setAdvisorOpen: (open) => set({ isAdvisorOpen: open }),
  advisorSelectedIncident: null,
  setAdvisorSelectedIncident: (inc) => set({ advisorSelectedIncident: inc }),
  configHistory: [],
  baselineConfig: null,
  activeScenarioSnapshot: null,
  updateRobotConfig: (partial, reason) => {
    set((state) => {
      const prev = { ...state.robotConfig };
      const updated = { ...state.robotConfig, ...partial };
      return {
        robotConfig: updated,
        configHistory: [...state.configHistory, prev],
        baselineConfig: state.baselineConfig || prev,
        eventLog: [
          `[CONFIG] Updated robot config: ${Object.entries(partial).map(([k, v]) => `${k}=${v}`).join(', ')}${reason ? ` (${reason})` : ''}`,
          ...state.eventLog.slice(0, 19),
        ],
      };
    });
  },
  saveScenarioSnapshot: (benchmarkRunId?: string) => {
    const s = get();
    const dest = s.destinations.find((d) => d.id === s.selectedDestinationId) || s.destinations[0];
    const snap: ScenarioSnapshot = {
      scenarioId: `SCENARIO-${Date.now()}`,
      environmentName: s.activeBarriers.length > 0
        ? `Warehouse (${s.activeBarriers[0].name || 'Barricaded'})`
        : 'Warehouse (Baseline)',
      difficulty: s.difficulty,
      startPosition: [...s.robotPose.position],
      startRotation: s.robotPose.rotation,
      destinationId: dest.id,
      destinationName: dest.name,
      interactiveObjects: JSON.parse(JSON.stringify(s.interactiveObjects)),
      activeBarriers: JSON.parse(JSON.stringify(s.activeBarriers)),
      navigationPreference: s.navigationPreference,
      baselineConfig: JSON.parse(JSON.stringify(s.robotConfig)),
      baselineRunId: benchmarkRunId,
      recordedAt: Date.now(),
    };
    set({ activeScenarioSnapshot: snap });
    s.addLog(`[ADVISOR] Captured exact scenario snapshot for "${dest.name}". Ready for rerun comparison.`);
    return snap;
  },
  rollbackRobotConfig: () => {
    const s = get();
    if (!s.baselineConfig && s.configHistory.length === 0) return false;
    const restored = s.baselineConfig || s.configHistory[0];
    if (!restored) return false;
    set({
      robotConfig: { ...restored },
      configHistory: [],
      baselineConfig: null,
      eventLog: [
        `[OPTIMIZATION] Rolled back configuration to baseline: maxLinearSpeed = ${restored.maxLinearSpeed} m/s`,
        ...s.eventLog.slice(0, 19),
      ],
    });
    return true;
  },
  rerunSameScenario: () => {
    const s = get();
    const snap = s.activeScenarioSnapshot;
    if (!snap) {
      s.addLog('[ADVISOR] Error: Cannot rerun scenario without active snapshot.');
      return;
    }

    // 1. Restore exact scenario hazards & barriers
    set({
      interactiveObjects: JSON.parse(JSON.stringify(snap.interactiveObjects)),
      activeBarriers: JSON.parse(JSON.stringify(snap.activeBarriers)),
      difficulty: snap.difficulty,
      selectedDestinationId: snap.destinationId,
      needsResetPose: true,
      targetResetPos: snap.startPosition,
      targetResetRot: snap.startRotation,
      robotPose: {
        position: snap.startPosition,
        rotation: snap.startRotation,
        linearVelocity: 0,
        angularVelocity: 0,
      },
    });

    // 2. Start Flight Recording automatically for Candidate Run
    flightRecorderService.startRecording(
      0.0,
      !s.isMultiplayerActive || s.userRole === 'operator',
      s.userRole === 'observer' ? 'controller' : s.userRole,
      s.sessionId || 'LOCAL-RERUN'
    );
    set({ isRecordingFlightData: true });

    // 3. Start Mission with candidate config
    s.startMission(snap.destinationId, { preference: s.navigationPreference });
    s.addLog(`[ADVISOR] Rerunning scenario to ${snap.destinationName} with candidate config (maxLinearSpeed = ${s.robotConfig.maxLinearSpeed} m/s).`);
  },

  // Adversarial Scenario: Vertical Impact Falling Pallet Test
  fallingPalletHazard: initialFallingPalletState,

  startVerticalImpactScenario: () => {
    lastCollisionTimestamp = 0;
    lastCollidedObjectName = '';
    const s = get();
    // 1. Set mode to autonomous & difficulty to extreme
    set({
      mode: 'autonomous',
      difficulty: 'extreme',
      needsResetPose: true,
      targetResetPos: [-14.5, 0.22, -10.5],
      targetResetRot: 0,
      robotPose: {
        position: [-14.5, 0.22, -10.5],
        rotation: 0,
        linearVelocity: 0,
        angularVelocity: 0,
      },
      interactiveObjects: [],
      activeBarriers: [],
      fallingPalletHazard: {
        isActive: true,
        palletId: 'falling-pallet-1',
        palletPosition: [-8.5, 3.6, -10.5],
        palletSize: [1.2, 0.25, 1.2],
        triggerDistance: 3.0,
        isDropped: false,
        dropTime: null,
        impactTime: null,
        hasImpacted: false,
        impactImpulse: null,
      },
      crashState: initialCrashState,
    });

    // 2. Start Flight Recording session for black-box telemetry
    flightRecorderService.startRecording(
      0.0,
      !s.isMultiplayerActive || s.userRole === 'operator',
      s.userRole === 'observer' ? 'controller' : s.userRole,
      'VERTICAL-IMPACT-TEST'
    );
    set({ isRecordingFlightData: true });

    // 3. Dispatch AMR autonomously on straight corridor to Bay 4
    s.startMission('bay-4', { preference: 'shortest_safe_path' });

    s.addLog('[SCENARIO] 🏗️ Adversarial Scenario Engaged: VERTICAL IMPACT — FALLING PALLET TEST');
    s.addLog('[SCENARIO] AMR dispatched autonomously down straight North corridor towards Bay 4.');
    s.addLog('[SCENARIO] 250kg Pallet suspended at Y=3.6m directly above corridor centerline.');
    s.addLog('[SCENARIO] Drop Trigger: Proximity <= 3.0 metres.');
    s.addLog('[AUDIT PREVIEW] SENSORS: 2D Horizontal LiDAR (0° elevation) has an overhead blind spot.');
    s.addLog('[AUDIT PREVIEW] PREDICTION: Planar TTC does not model vertical kinematics or gravitational acceleration.');
  },

  triggerFallingPalletDrop: () => {
    const s = get();
    if (s.fallingPalletHazard.isDropped) return;
    set((state) => ({
      fallingPalletHazard: {
        ...state.fallingPalletHazard,
        isDropped: true,
        dropTime: state.currentTime,
      },
      eventLog: [
        `[HAZARD] ⚠️ Proximity trigger reached (< 3.0m)! Overhead rigging released! Pallet in free fall under gravity (g=9.81 m/s²)!`,
        ...state.eventLog.slice(0, 19),
      ],
    }));
  },

  recordFallingPalletImpact: (impulse: number) => {
    const s = get();
    if (s.fallingPalletHazard.hasImpacted || s.crashState.hasCrashed) return;
    s.handleFallingObjectCrash(impulse, 'Heavy Overhead Falling Pallet');
  },

  resetVerticalImpactScenario: () => {
    set({
      fallingPalletHazard: initialFallingPalletState,
      crashState: initialCrashState,
    });
    get().addLog('[SCENARIO] Vertical Impact scenario reset.');
  },

  // Crash & Recovery State (Falling Object Scenario)
  crashState: initialCrashState,

  handleFallingObjectCrash: (impulse: number, details = 'Heavy Overhead Falling Pallet') => {
    const s = get();

    // Preserve multiplayer authority: only the authoritative simulation instance registers/handles crash
    if (s.isMultiplayerActive && s.userRole === 'controller') {
      return;
    }

    // Technical safeguard: Prevent duplicate collision callbacks from firing multiple times
    if (s.crashState.hasCrashed || s.fallingPalletHazard.hasImpacted) {
      return;
    }

    // 1. Immediately pause simulation, stop robot movement & autonomous navigation, and record collision
    set((state) => {
      if (state.isRecordingFlightData) {
        flightRecorderService.recordIncident(
          'COLLISION',
          `Collision impact with ${details}! Force: ${impulse.toFixed(1)} N`,
          state.currentTime,
          state.robotPose,
          state.navState,
          state.sensorData,
          state.interactiveObjects,
          state.activeBarriers,
          { impulse, obstacle: details }
        );
      }
      return {
        isRunning: false,
        robotPose: {
          ...state.robotPose,
          linearVelocity: 0,
          angularVelocity: 0,
        },
        robotStatus: {
          ...state.robotStatus,
          collisionCount: state.robotStatus.collisionCount + 1,
          lastCollisionForce: impulse,
        },
        navState: 'STOPPED',
        missionMetrics: {
          ...state.missionMetrics,
          collisions: state.missionMetrics.collisions + 1,
          missionStatus: 'failed',
        },
        authoritativeExecutionRecord: {
          ...state.authoritativeExecutionRecord,
          collisionCount: state.authoritativeExecutionRecord.collisionCount + 1,
          missionStatus: 'FAILED',
          safetyStatus: 'CRITICAL',
          failureReason: 'Stopped: Physical collision with falling object',
        },
        diagnostics: {
          ...state.diagnostics,
          replanReason: 'Stopped: Physical collision with falling object',
        },
        fallingPalletHazard: {
          ...state.fallingPalletHazard,
          hasImpacted: true,
          impactTime: state.currentTime,
          impactImpulse: impulse,
        },
        crashState: {
          hasCrashed: true,
          showConfirmationModal: true,
          incidentDetails: {
            objectName: details,
            impulse,
            time: state.currentTime,
            position: [state.robotPose.position[0], state.robotPose.position[1], state.robotPose.position[2]],
          },
        },
        eventLog: [
          `[COLLISION] Impact with ${details}! Force: ${impulse.toFixed(1)} N`,
          `[CRASH] 🚨 ROBOT COLLISION DETECTED: 250kg Pallet impact force ${impulse.toFixed(1)} N! Autonomous navigation stopped.`,
          ...state.eventLog.slice(0, 18),
        ],
      };
    });

    s.addLog(`[IMPACT AUDIT] 🚨 VERTICAL IMPACT CONFIRMED: 250kg Pallet struck RobotRisk-AMR! Force: ${impulse.toFixed(1)} N.`);
    s.addLog(`[IMPACT AUDIT] 1. OVERHEAD SENSOR: FALSE (Horizontal 2D LiDAR blind to vertical descent).`);
    s.addLog(`[IMPACT AUDIT] 2. VERTICAL TTC PREDICTION: FALSE (Planar 2D TTC does not model Vy or gravity).`);
    s.addLog(`[IMPACT AUDIT] 3. STOPPING DISTANCE: Collision was physically unavoidable at 3.0m trigger with 0.83s fall time.`);
    s.addLog(`[IMPACT AUDIT] 4. FLIGHT RECORDER: Exact-time collision telemetry captured for AI Failure Analysis.`);
  },

  restartMissionAfterCrash: () => {
    lastCollisionTimestamp = 0;
    lastCollidedObjectName = '';
    const s = get();

    // 1. Reset robot pose to original starting position & orientation
    set({
      needsResetPose: true,
      targetResetPos: [-14.5, 0.22, -10.5],
      targetResetRot: 0,
      robotPose: {
        position: [-14.5, 0.22, -10.5],
        rotation: 0,
        linearVelocity: 0,
        angularVelocity: 0,
      },
      actualTrajectory: [[-14.5, 0.22, -10.5]],
      fallingPalletHazard: {
        ...s.fallingPalletHazard,
        isActive: true,
        palletPosition: [-8.5, 3.6, -10.5],
        isDropped: false,
        dropTime: null,
        impactTime: null,
        hasImpacted: false,
        impactImpulse: null,
      },
      crashState: {
        hasCrashed: false,
        showConfirmationModal: false,
        incidentDetails: null,
      },
      isRunning: true,
    });

    // 2. Start a fresh mission towards Bay 4 (historical Flight Recorder sessions are preserved)
    s.startMission('bay-4', { preference: 'shortest_safe_path' });

    s.addLog('[MISSION] 🔄 Mission restarted from base. Overhead pallet re-armed at Y=3.6m.');
  },

  continueWithoutRestart: () => {
    set((state) => ({
      crashState: {
        ...state.crashState,
        showConfirmationModal: false,
      },
      isRunning: false, // Ensure simulation remains paused
      eventLog: [
        '[CRASH] Operator selected: Continue Without Restart. Scene preserved for physical inspection.',
        ...state.eventLog.slice(0, 19),
      ],
    }));
  },

  startMission: (destId, options) => {
    const currentState = get();
    if (currentState.isMultiplayerActive && currentState.userRole === 'controller') {
      currentState.addLog('[MISSION] Permission Denied: Autonomous mission control is reserved for Robot Operator.');
      return;
    }
    set((state) => {
      const targetId = destId || state.selectedDestinationId;
      const target = state.destinations.find((d) => d.id === targetId) || state.destinations[0];
      const pref = options?.preference || state.navigationPreference || 'default';

      if (state.isMultiplayerActive && state.userRole === 'operator') {
        multiplayerService.send('start_mission', { destinationId: target.id, preference: pref });
      }

      return {
        selectedDestinationId: target.id,
        navigationPreference: pref,
        navState: 'PLANNING',
        robotStatus: {
          ...state.robotStatus,
          collisionCount: 0,
        },
        missionMetrics: {
          missionStatus: 'running',
          missionTime: 0,
          distanceTravelled: 0,
          obstaclesDetected: 0,
          replanCount: 0,
          timeStopped: 0,
          collisions: 0,
          nearMisses: 0,
        },
        diagnostics: {
          ...DEFAULT_DIAGNOSTICS,
          lastMovedTime: state.currentTime,
          replanReason: `Mission initiated to ${target.name}${pref === 'shortest_safe_path' ? ' [Shortest Safe Route]' : ''}`,
        },
        actualTrajectory: [state.robotPose.position],
        triggerReplanCounter: state.triggerReplanCounter + 1,
        eventLog: [
          `[MISSION] Started autonomous navigation to ${target.name}${pref === 'shortest_safe_path' ? ' (Shortest Safe Route)' : ''}`,
          ...state.eventLog.slice(0, 19),
        ],
      };
    });
  },

  pauseMission: () => {
    const currentState = get();
    if (currentState.isMultiplayerActive && currentState.userRole === 'controller') {
      currentState.addLog('[MISSION] Permission Denied: Autonomous mission control is reserved for Robot Operator.');
      return;
    }
    if (currentState.isMultiplayerActive && currentState.userRole === 'operator') {
      multiplayerService.send('pause_mission', {});
    }
    set((state) => ({
      navState: 'STOPPED',
      missionMetrics: {
        ...state.missionMetrics,
        missionStatus: 'paused',
      },
      diagnostics: {
        ...state.diagnostics,
        replanReason: 'Paused by operator',
      },
      eventLog: ['[MISSION] Mission paused by operator', ...state.eventLog.slice(0, 19)],
    }));
  },

  resumeMission: () => {
    const currentState = get();
    if (currentState.isMultiplayerActive && currentState.userRole === 'controller') {
      currentState.addLog('[MISSION] Permission Denied: Autonomous mission control is reserved for Robot Operator.');
      return;
    }
    if (currentState.isMultiplayerActive && currentState.userRole === 'operator') {
      multiplayerService.send('resume_mission', {});
    }
    set((state) => ({
      navState: 'MOVING',
      missionMetrics: {
        ...state.missionMetrics,
        missionStatus: 'running',
      },
      diagnostics: {
        ...state.diagnostics,
        lastMovedTime: state.currentTime,
        replanReason: 'Resumed by operator',
      },
      eventLog: ['[MISSION] Mission resumed', ...state.eventLog.slice(0, 19)],
    }));
  },

  abortMission: () => {
    set((state) => ({
      navState: 'IDLE',
      plannedPath: [],
      currentWaypointIndex: 0,
      scenarioExecutionStatus: state.activeScenarioId ? 'ABORTED' : state.scenarioExecutionStatus,
      authoritativeExecutionRecord: {
        ...state.authoritativeExecutionRecord,
        missionStatus: state.activeScenarioId ? 'ABORTED' : state.authoritativeExecutionRecord.missionStatus,
      },
      missionMetrics: {
        ...state.missionMetrics,
        missionStatus: 'aborted',
      },
      diagnostics: {
        ...state.diagnostics,
        currentWaypoint: null,
        routeValidity: 'valid',
        replanReason: 'Aborted by operator',
      },
      eventLog: ['[MISSION] Mission aborted by operator', ...state.eventLog.slice(0, 19)],
    }));
  },

  selectDestination: (destId) => {
    set((state) => {
      const dest = state.destinations.find((d) => d.id === destId);
      return {
        selectedDestinationId: destId,
        eventLog: [
          `[NAV] Target destination changed to ${dest?.name || destId}`,
          ...state.eventLog.slice(0, 19),
        ],
      };
    });
  },

  setPlannedPath: (path) => {
    set((state) => {
      const isValid = path.length > 0;
      const currentWp = isValid ? path[0] : null;

      return {
        plannedPath: path,
        currentWaypointIndex: 0,
        navState: isValid ? 'MOVING' : 'FAILED',
        diagnostics: {
          ...state.diagnostics,
          currentWaypoint: currentWp,
          currentWaypointIndex: 0,
          totalWaypoints: path.length,
          routeValidity: isValid ? 'valid' : 'blocked',
          failureExplanation: isValid
            ? null
            : 'Target destination is completely unreachable! All corridors are obstructed.',
        },
        eventLog: [
          isValid
            ? `[NAV] Generated optimal A* route with ${path.length} waypoints`
            : '[NAV] Warning: Target destination is unreachable! No valid path found.',
          ...state.eventLog.slice(0, 19),
        ],
      };
    });
  },

  updateWaypointIndex: (currentWaypointIndex) => {
    set((state) => {
      const currentWp =
        currentWaypointIndex < state.plannedPath.length
          ? state.plannedPath[currentWaypointIndex]
          : null;
      return {
        currentWaypointIndex,
        diagnostics: {
          ...state.diagnostics,
          currentWaypointIndex,
          currentWaypoint: currentWp,
        },
      };
    });
  },

  updateNavState: (navState) => {
    set((state) => {
      if (state.navState === navState) return state;

      const metrics = { ...state.missionMetrics };
      let scenarioStatus = state.scenarioExecutionStatus;
      const execRecord = { ...state.authoritativeExecutionRecord };

      if (navState === 'COMPLETED') {
        metrics.missionStatus = 'completed';
        if (state.activeScenarioId) {
          scenarioStatus = 'COMPLETED';
          execRecord.missionStatus = 'COMPLETED';
          console.log('[SCENARIO_DEBUG] Scenario mission COMPLETED:', {
            scenarioId: state.activeScenarioId,
            title: state.activeScenarioMetadata?.title,
            distance: metrics.distanceTravelled,
            clearance: state.minObservedClearance,
            ttc: state.minObservedTtc,
            collisions: state.robotStatus.collisionCount,
          });
        }
      } else if (navState === 'FAILED') {
        metrics.missionStatus = 'failed';
        if (state.activeScenarioId) {
          scenarioStatus = 'FAILED';
          execRecord.missionStatus = 'FAILED';
          execRecord.failureReason = state.diagnostics.failureExplanation || 'Path unreachable or collision halt';
          console.log('[SCENARIO_DEBUG] Scenario mission FAILED:', {
            scenarioId: state.activeScenarioId,
            title: state.activeScenarioMetadata?.title,
            collisions: state.robotStatus.collisionCount,
          });
        }
      }

      return {
        navState,
        scenarioExecutionStatus: scenarioStatus,
        missionMetrics: metrics,
        authoritativeExecutionRecord: execRecord,
        eventLog: [`[NAV] State changed to: ${navState}`, ...state.eventLog.slice(0, 19)],
      };
    });
  },

  updateSensorData: (sensorData) => {
    set((state) => {
      // Evaluate scene dynamic TTC & near-miss detection
      const sceneTTC = evaluateSceneTTC(
        state.robotPose,
        state.interactiveObjects,
        state.activeBarriers,
        undefined,
        state.currentTime
      );

      const mergedSensorData: SensorData = {
        ...sensorData,
        ttc: sensorData.ttc !== undefined ? sensorData.ttc : sceneTTC.minTtc,
        safetyStatus: sensorData.safetyStatus !== undefined ? sensorData.safetyStatus : sceneTTC.safetyStatus,
        highestRiskObstacle: sensorData.highestRiskObstacle !== undefined ? sensorData.highestRiskObstacle : sceneTTC.highestRiskObstacle,
        minClearance: sensorData.minClearance !== undefined ? sensorData.minClearance : sceneTTC.minClearance,
        isCollisionCourse: sensorData.isCollisionCourse !== undefined ? sensorData.isCollisionCourse : sceneTTC.isCollisionCourse,
      };

      // Update scenario runtime tracking metrics & Authoritative Record
      let minObservedClearance = state.minObservedClearance;
      let minObservedTtc = state.minObservedTtc;
      const execRecord = { ...state.authoritativeExecutionRecord };

      execRecord.currentClearance = sceneTTC.minClearance;
      execRecord.currentTtc = sceneTTC.minTtc ?? null;

      if (state.activeScenarioId && (state.scenarioExecutionStatus === 'RUNNING' || execRecord.missionStatus === 'RUNNING')) {
        if (sceneTTC.minClearance < minObservedClearance) {
          minObservedClearance = sceneTTC.minClearance;
        }
        if (
          sceneTTC.minTtc !== null &&
          sceneTTC.minTtc !== undefined &&
          !isNaN(sceneTTC.minTtc) &&
          sceneTTC.minTtc < minObservedTtc
        ) {
          minObservedTtc = sceneTTC.minTtc;
        }

        execRecord.minObservedClearance =
          execRecord.minObservedClearance === null
            ? sceneTTC.minClearance
            : Math.min(execRecord.minObservedClearance, sceneTTC.minClearance);

        if (sceneTTC.minTtc !== null && sceneTTC.minTtc !== undefined && !isNaN(sceneTTC.minTtc)) {
          execRecord.minObservedTtc =
            execRecord.minObservedTtc === null
              ? sceneTTC.minTtc
              : Math.min(execRecord.minObservedTtc, sceneTTC.minTtc);
        }

        if (execRecord.collisionCount > 0) {
          execRecord.safetyStatus = 'CRITICAL';
        } else if (mergedSensorData.safetyStatus === 'CRITICAL') {
          execRecord.safetyStatus = 'CRITICAL';
        } else if (mergedSensorData.safetyStatus === 'WARNING') {
          execRecord.safetyStatus = 'WARNING';
        } else {
          execRecord.safetyStatus = 'SAFE';
        }
      }

      if (state.isRecordingFlightData && sceneTTC.newNearMissDetected) {
        flightRecorderService.recordIncident(
          'NEAR_MISS',
          `Near-Miss Proximity Event! Clearance: ${sceneTTC.minClearance.toFixed(2)}m with ${sceneTTC.highestRiskObstacle || 'Obstacle'}`,
          state.currentTime,
          state.robotPose,
          state.navState,
          mergedSensorData,
          state.interactiveObjects,
          state.activeBarriers,
          { minClearance: sceneTTC.minClearance, obstacle: sceneTTC.highestRiskObstacle }
        );
      }

      if (sceneTTC.newNearMissDetected) {
        execRecord.nearMissCount += 1;
      }

      const newNearMisses = sceneTTC.newNearMissDetected
        ? (state.missionMetrics.nearMisses || 0) + 1
        : (state.missionMetrics.nearMisses || 0);

      const newLog = sceneTTC.newNearMissDetected
        ? [
            `[SAFETY] Near-Miss Detected! Clearance: ${sceneTTC.minClearance.toFixed(2)}m with ${sceneTTC.highestRiskObstacle || 'Obstacle'}`,
            ...state.eventLog.slice(0, 19),
          ]
        : state.eventLog;

      return {
        sensorData: mergedSensorData,
        minObservedClearance,
        minObservedTtc,
        authoritativeExecutionRecord: execRecord,
        missionMetrics: {
          ...state.missionMetrics,
          nearMisses: newNearMisses,
        },
        eventLog: newLog,
        diagnostics: {
          ...state.diagnostics,
          obstaclePosition: sensorData.obstaclePosition || null,
          obstacleName: sensorData.closestObstacle || null,
        },
      };
    });
  },

  appendTrajectoryPoint: (point) => {
    set((state) => {
      const traj = state.actualTrajectory;
      const lastPoint = traj[traj.length - 1];
      if (
        !lastPoint ||
        Math.hypot(point[0] - lastPoint[0], point[2] - lastPoint[2]) > 0.3
      ) {
        return {
          actualTrajectory: [...traj.slice(-150), point],
        };
      }
      return state;
    });
  },

  incrementReplan: (reason = 'Dynamic Obstruction') => {
    set((state) => ({
      missionMetrics: {
        ...state.missionMetrics,
        replanCount: state.missionMetrics.replanCount + 1,
      },
      diagnostics: {
        ...state.diagnostics,
        replanReason: reason,
      },
      triggerReplanCounter: state.triggerReplanCounter + 1,
      eventLog: [`[NAV] Replan #${state.missionMetrics.replanCount + 1}: ${reason}`, ...state.eventLog.slice(0, 19)],
    }));
  },

  incrementObstacleDetected: () => {
    set((state) => ({
      missionMetrics: {
        ...state.missionMetrics,
        obstaclesDetected: state.missionMetrics.obstaclesDetected + 1,
      },
    }));
  },

  incrementNearMiss: (details?: string) => {
    set((state) => ({
      missionMetrics: {
        ...state.missionMetrics,
        nearMisses: (state.missionMetrics.nearMisses || 0) + 1,
      },
      eventLog: [
        `[SAFETY] Near-Miss Detected${details ? ` with ${details}` : ''}! Proximity risk recorded.`,
        ...state.eventLog.slice(0, 19),
      ],
    }));
  },

  triggerReplan: () => {
    set((state) => ({
      triggerReplanCounter: state.triggerReplanCounter + 1,
      navState: 'PLANNING',
      diagnostics: {
        ...state.diagnostics,
        replanReason: 'Operator manual replan requested',
      },
      eventLog: ['[NAV] Manual path recalculation requested', ...state.eventLog.slice(0, 19)],
    }));
  },

  backendStatus: 'checking',
  backendInfo: null,
  setBackendStatus: (backendStatus, backendInfo = null) =>
    set({ backendStatus, backendInfo: backendInfo ?? null }),

  // Placement Mode State
  placementMode: null,
  previewPosition: [0, 0.4, 0],
  previewRotation: 0,
  isPlacementValid: true,
  selectedAisleToBlock: null,

  setPlacementMode: (mode, aisleId) => {
    if (!mode) {
      set({
        placementMode: null,
        selectedAisleToBlock: null,
      });
      return;
    }

    // If placing a barrier for a specific aisle, snap preview to aisle center
    let initialPos: [number, number, number] = [0, 0.5, 0];
    let initialRot = 0;

    if (mode === 'barrier' && aisleId) {
      const aisle = WAREHOUSE_CONFIG.aisles.find((a) => a.id === aisleId);
      if (aisle) {
        initialPos = [
          (aisle.start[0] + aisle.end[0]) / 2,
          0.75,
          (aisle.start[1] + aisle.end[1]) / 2,
        ];
        // If aisle runs along X, barrier is rotated 90°
        const dx = Math.abs(aisle.end[0] - aisle.start[0]);
        const dz = Math.abs(aisle.end[1] - aisle.start[1]);
        initialRot = dx > dz ? Math.PI / 2 : 0;
      }
    }

    set({
      placementMode: mode,
      selectedAisleToBlock: aisleId || null,
      previewPosition: initialPos,
      previewRotation: initialRot,
      isPlacementValid: true,
    });
  },

  updatePlacementPreview: (pos, valid) => {
    set({
      previewPosition: pos,
      isPlacementValid: valid,
    });
  },

  rotatePlacementPreview: (deltaRad = Math.PI / 4) => {
    set((state) => ({
      previewRotation: (state.previewRotation + deltaRad) % (Math.PI * 2),
    }));
  },

  confirmPlacement: () => {
    const state = get();
    if (!state.placementMode || !state.isPlacementValid) return;

    if (state.placementMode === 'box') {
      state.spawnInteractiveObject('cube', state.previewPosition, state.previewRotation);
    } else if (state.placementMode === 'sphere') {
      state.spawnInteractiveObject('sphere', state.previewPosition, 0);
    } else if (state.placementMode === 'barrier' && state.selectedAisleToBlock) {
      state.blockAisle(state.selectedAisleToBlock);
    }

    set({
      placementMode: null,
      selectedAisleToBlock: null,
    });
  },

  cancelPlacement: () => {
    set((state) => ({
      placementMode: null,
      selectedAisleToBlock: null,
      eventLog: ['[PLACEMENT] Object placement cancelled', ...state.eventLog.slice(0, 19)],
    }));
  },

  // Placed Interactive Test Objects
  interactiveObjects: [],
  selectedObjectId: null,

  selectObject: (id) => {
    set({ selectedObjectId: id });
  },

  spawnInteractiveObject: (type = 'cube', customPosition, rotation = 0) => {
    const id = `obj-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const position: [number, number, number] = customPosition || [
      (Math.random() - 0.5) * 12,
      0.4,
      (Math.random() - 0.5) * 10,
    ];
    const color = PALETTE[Math.floor(Math.random() * PALETTE.length)];
    const size = type === 'cube' ? 0.75 : 0.5;

    const newObj: InteractiveObject = {
      id,
      type,
      position,
      color,
      size,
      rotation,
      name: `User ${type === 'cube' ? 'Cargo Box' : 'Safety Sphere'}`,
    };

    if (get().isMultiplayerActive) {
      multiplayerService.send('spawn_object', { object: newObj });
    }

    set((state) => ({
      interactiveObjects: [...state.interactiveObjects, newObj],
      triggerReplanCounter: state.triggerReplanCounter + 1, // Triggers reactive replan
      eventLog: [
        `[PHYSICS] Placed ${newObj.name} at [${position[0].toFixed(1)}, ${position[2].toFixed(1)}]`,
        ...state.eventLog.slice(0, 19),
      ],
    }));
  },

  deleteSelectedObject: () => {
    const { selectedObjectId, deleteInteractiveObject } = get();
    if (selectedObjectId) {
      deleteInteractiveObject(selectedObjectId);
    }
  },

  deleteInteractiveObject: (id) => {
    if (get().isMultiplayerActive) {
      multiplayerService.send('remove_object', { objectId: id });
    }
    set((state) => ({
      interactiveObjects: state.interactiveObjects.filter((o) => o.id !== id),
      selectedObjectId: state.selectedObjectId === id ? null : state.selectedObjectId,
      triggerReplanCounter: state.triggerReplanCounter + 1,
      eventLog: [`[PHYSICS] Removed object ${id}`, ...state.eventLog.slice(0, 19)],
    }));
  },

  clearInteractiveObjects: () => {
    if (get().isMultiplayerActive) {
      multiplayerService.send('clear_objects', {});
    }
    set((state) => ({
      interactiveObjects: [],
      selectedObjectId: null,
      triggerReplanCounter: state.triggerReplanCounter + 1,
      eventLog: ['[PHYSICS] Cleared all placed dynamic test objects', ...state.eventLog.slice(0, 19)],
    }));
  },

  // Aisle Barrier Implementation
  activeBarriers: [],

  blockAisle: (aisleId) => {
    const aisle = WAREHOUSE_CONFIG.aisles.find((a) => a.id === aisleId);
    if (!aisle) return;

    // Check if already blocked
    const existing = get().activeBarriers.find((b) => b.aisleId === aisleId);
    if (existing) {
      get().addLog(`[BARRIER] Aisle '${aisle.name}' is already blocked!`);
      return;
    }

    const midX = (aisle.start[0] + aisle.end[0]) / 2;
    const midZ = (aisle.start[1] + aisle.end[1]) / 2;
    const dx = Math.abs(aisle.end[0] - aisle.start[0]);
    const dz = Math.abs(aisle.end[1] - aisle.start[1]);
    const isRotated = dx > dz;

    const barrier: AisleBarrier = {
      id: `barrier-${aisleId}-${Date.now()}`,
      aisleId,
      name: aisle.name,
      position: [midX, 0.75, midZ],
      width: aisle.width,
      depth: 0.6,
      height: 1.5,
      rotation: isRotated ? Math.PI / 2 : 0,
    };

    if (get().isMultiplayerActive) {
      multiplayerService.send('block_aisle', { aisleId, aisleName: aisle.name, barrier });
    }

    set((state) => ({
      activeBarriers: [...state.activeBarriers, barrier],
      triggerReplanCounter: state.triggerReplanCounter + 1,
      eventLog: [
        `[BARRIER] Blocked ${aisle.name} with physical barricade`,
        ...state.eventLog.slice(0, 19),
      ],
    }));
  },

  removeBarrier: (barrierId) => {
    if (get().isMultiplayerActive) {
      multiplayerService.send('remove_barrier', { barrierId });
    }
    set((state) => {
      const barrier = state.activeBarriers.find((b) => b.id === barrierId);
      return {
        activeBarriers: state.activeBarriers.filter((b) => b.id !== barrierId),
        triggerReplanCounter: state.triggerReplanCounter + 1,
        eventLog: [
          `[BARRIER] Removed barricade from ${barrier?.name || barrierId}`,
          ...state.eventLog.slice(0, 19),
        ],
      };
    });
  },

  clearAllBarriers: () => {
    if (get().isMultiplayerActive) {
      multiplayerService.send('clear_barriers', {});
    }
    set((state) => ({
      activeBarriers: [],
      triggerReplanCounter: state.triggerReplanCounter + 1,
      eventLog: ['[BARRIER] Cleared all aisle barricades. All aisles reopened.', ...state.eventLog.slice(0, 19)],
    }));
  },

  // AI Command Center State & Pipeline
  chatMessages: [
    {
      id: 'msg-init-1',
      sender: 'ai',
      timestamp: Date.now(),
      text: '🤖 **ROBOTRISK AI Command Center Online.**\n\nI can configure test scenarios, spawn obstacles, block aisles, or analyze robot stoppage telemetry.\n\nAll simulation-modifying actions require your explicit approval before execution.',
    },
  ],
  pendingCommand: null,
  isAiThinking: false,
  difficulty: 'normal',

  sendChatMessage: async (prompt: string) => {
    if (!prompt.trim()) return;

    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}-u`,
      sender: 'user',
      timestamp: Date.now(),
      text: prompt.trim(),
    };

    set((state) => ({
      chatMessages: [...state.chatMessages, userMsg],
      isAiThinking: true,
    }));

    const state = get();
    const lastSpawnedObstacle = state.interactiveObjects[state.interactiveObjects.length - 1];
    const recentMessages = state.chatMessages.slice(-6).map((m) => ({
      sender: m.sender,
      text: m.text,
      action: m.parsedCommand?.action,
    }));
    const lastApprovedCmd = [...state.chatMessages].reverse().find((m) => m.status === 'approved' && m.parsedCommand);

    const ctx = {
      robotPose: state.robotPose,
      robotStatus: state.robotStatus,
      navState: state.navState,
      isRunning: state.isRunning,
      sensorData: state.sensorData,
      diagnostics: state.diagnostics,
      eventLog: state.eventLog,
      activeBarriers: state.activeBarriers,
      currentDifficulty: state.difficulty,
      lastSpawnedObstacleId: lastSpawnedObstacle?.id,
      lastActionType: lastApprovedCmd?.parsedCommand?.action,
      conversationHistory: recentMessages,
    };

    const parsed = await parseCommandWithBackend(prompt, ctx);

    // If clarification is needed
    if (parsed.action === 'clarification_needed') {
      const q = parsed.clarificationQuestion ||
        `❓ **Clarification Needed:** ${parsed.explanation || parsed.description || 'Please specify more details (e.g. which aisle or where to place the object).'}`;
      const aiMsg: ChatMessage = {
        id: `msg-${Date.now()}-ai`,
        sender: 'ai',
        timestamp: Date.now(),
        text: q,
        status: 'clarification_needed',
        parsedCommand: parsed,
      };
      set((s) => ({
        chatMessages: [...s.chatMessages, aiMsg],
        pendingCommand: null,
        isAiThinking: false,
      }));
      return;
    }

    // If query explanation
    if (parsed.action === 'query_explanation') {
      const explanation = generateTelemetryExplanation(ctx);
      const aiMsg: ChatMessage = {
        id: `msg-${Date.now()}-ai`,
        sender: 'ai',
        timestamp: Date.now(),
        text: explanation,
        status: 'executed',
      };
      set((s) => ({
        chatMessages: [...s.chatMessages, aiMsg],
        pendingCommand: null,
        isAiThinking: false,
      }));
      return;
    }

    // If query events
    if (parsed.action === 'query_events') {
      const summary = generateEventsSummary(ctx);
      const aiMsg: ChatMessage = {
        id: `msg-${Date.now()}-ai`,
        sender: 'ai',
        timestamp: Date.now(),
        text: summary,
        status: 'executed',
      };
      set((s) => ({
        chatMessages: [...s.chatMessages, aiMsg],
        pendingCommand: null,
        isAiThinking: false,
      }));
      return;
    }

    // If unknown command
    if (parsed.action === 'unknown') {
      const aiMsg: ChatMessage = {
        id: `msg-${Date.now()}-ai`,
        sender: 'ai',
        timestamp: Date.now(),
        text: `⚠️ **Command Not Recognized:** "${prompt}"\n\n**Supported commands include:**\n- *"Make it tough and take it through the shortest path."*\n- *"Create a crowded warehouse, block aisle two and start the robot."*\n- *"Place a box three metres ahead of the robot."*\n- *"Drop an obstacle at coordinates X 5, Z 8."*\n- *"Block the entire second aisle."*\n- *"Remove the aisle blockage."*\n- *"Start the autonomous mission."*\n- *"Pause the robot." / "Resume the simulation."*\n- *"Explain what happened."*`,
        status: 'failed',
      };
      set((s) => ({
        chatMessages: [...s.chatMessages, aiMsg],
        pendingCommand: null,
        isAiThinking: false,
      }));
      return;
    }

    // If immediate execution without approval (start, pause, resume, emergency stop)
    if (!parsed.requiresApproval) {
      if (parsed.action === 'emergency_stop') {
        state.setEmergencyStop(true);
        const aiMsg: ChatMessage = {
          id: `msg-${Date.now()}-ai`,
          sender: 'ai',
          timestamp: Date.now(),
          text: '🛑 **EMERGENCY STOP ENGAGED.** Physical emergency braking active (18.0 m/s²). Robot halted immediately.',
          parsedCommand: parsed,
          status: 'executed',
          executionResult: {
            success: true,
            message: 'Emergency Stop Engaged (18.0 m/s²)',
          },
        };
        set((s) => ({
          chatMessages: [...s.chatMessages, aiMsg],
          pendingCommand: null,
          isAiThinking: false,
        }));
        return;
      }

      if (parsed.action === 'set_simulation_state') {
        const run = parsed.parameters.simulationRunning ?? true;
        set({ isRunning: run });
        if (run && state.robotStatus.isEmergencyStopped) {
          state.setEmergencyStop(false);
        }
        const aiMsg: ChatMessage = {
          id: `msg-${Date.now()}-ai`,
          sender: 'ai',
          timestamp: Date.now(),
          text: run
            ? '▶ **Simulation Resumed.** Robot kinematics and active navigation are running.'
            : '⏸ **Simulation Paused.** Simulation clock and robot motion frozen.',
          parsedCommand: parsed,
          status: 'executed',
          executionResult: {
            success: true,
            message: run ? 'Simulation Resumed' : 'Simulation Paused',
          },
        };
        set((s) => ({
          chatMessages: [...s.chatMessages, aiMsg],
          pendingCommand: null,
          isAiThinking: false,
        }));
        return;
      }

      if (parsed.action === 'pause_mission') {
        state.pauseMission();
        const aiMsg: ChatMessage = {
          id: `msg-${Date.now()}-ai`,
          sender: 'ai',
          timestamp: Date.now(),
          text: '⏸ **Robot Paused.** Holding position. Route and destination preserved.',
          parsedCommand: parsed,
          status: 'executed',
          executionResult: {
            success: true,
            message: 'Robot Paused (Mission preserved)',
          },
        };
        set((s) => ({
          chatMessages: [...s.chatMessages, aiMsg],
          pendingCommand: null,
          isAiThinking: false,
        }));
        return;
      }

      if (parsed.action === 'resume_mission') {
        set({ isRunning: true });
        if (state.robotStatus.isEmergencyStopped) {
          state.setEmergencyStop(false);
        }
        if (state.navState === 'STOPPED') {
          state.resumeMission();
        } else if (state.navState === 'IDLE' || state.navState === 'FAILED') {
          state.startMission();
        }
        const aiMsg: ChatMessage = {
          id: `msg-${Date.now()}-ai`,
          sender: 'ai',
          timestamp: Date.now(),
          text: '▶ **Navigation Resumed.** Continuing mission along planned route.',
          parsedCommand: parsed,
          status: 'executed',
          executionResult: {
            success: true,
            message: 'Navigation Resumed',
          },
        };
        set((s) => ({
          chatMessages: [...s.chatMessages, aiMsg],
          pendingCommand: null,
          isAiThinking: false,
        }));
        return;
      }

      if (parsed.action === 'start_mission') {
        set({ isRunning: true });
        if (state.robotStatus.isEmergencyStopped) {
          state.setEmergencyStop(false);
        }
        const destId = parsed.parameters.destinationId || 'bay-4';
        const pref = parsed.parameters.navigationPreference || 'default';
        state.startMission(destId, { preference: pref });
        const aiMsg: ChatMessage = {
          id: `msg-${Date.now()}-ai`,
          sender: 'ai',
          timestamp: Date.now(),
          text: `🚀 **Autonomous Navigation Started.** Navigating to ${destId === 'bay-4' ? 'Bay 4 Delivery Zone' : destId}${pref === 'shortest_safe_path' ? ' via shortest safe path' : ''}.`,
          parsedCommand: parsed,
          status: 'executed',
          executionResult: {
            success: true,
            message: `Autonomous Mission Started (${pref})`,
          },
        };
        set((s) => ({
          chatMessages: [...s.chatMessages, aiMsg],
          pendingCommand: null,
          isAiThinking: false,
        }));
        return;
      }

      if (parsed.action === 'replan_route') {
        state.triggerReplan();
        const aiMsg: ChatMessage = {
          id: `msg-${Date.now()}-ai`,
          sender: 'ai',
          timestamp: Date.now(),
          text: '🔄 **Alternative Route Computed.** A* evaluating clear bypass corridors.',
          parsedCommand: parsed,
          status: 'executed',
          executionResult: {
            success: true,
            message: 'Alternative route replanned',
          },
        };
        set((s) => ({
          chatMessages: [...s.chatMessages, aiMsg],
          pendingCommand: null,
          isAiThinking: false,
        }));
        return;
      }
    }

    // Action requires human approval!
    let proposalText = `Proposed action: **${parsed.intent}**.\n\nPlease review the parameters and confirm execution.`;
    if (parsed.isMultiIntent && parsed.subActions && parsed.subActions.length > 1) {
      const stepsList = parsed.subActions
        .map((sub, idx) => `• **Step ${idx + 1}:** ${sub.description}`)
        .join('\n');
      proposalText = `Proposed composite workflow (**${parsed.subActions.length} sequential actions**):\n\n${stepsList}\n\nPlease review the execution plan and confirm approval.`;
    }

    const aiMsg: ChatMessage = {
      id: `msg-${Date.now()}-ai`,
      sender: 'ai',
      timestamp: Date.now(),
      text: proposalText,
      parsedCommand: parsed,
      status: 'pending_approval',
    };

    set((s) => ({
      chatMessages: [...s.chatMessages, aiMsg],
      pendingCommand: parsed,
      isAiThinking: false,
    }));
  },

  approveCommand: (commandId: string) => {
    const state = get();
    const msg = state.chatMessages.find((m) => m.parsedCommand?.id === commandId);
    const cmd = msg?.parsedCommand || state.pendingCommand;
    if (!cmd) return;

    const executeStoreAction = (
      action: CommandActionType,
      parameters: any,
      curState: SimulationState
    ): { success: boolean; message: string } => {
      // Scenario Controller role validation
      if (curState.isMultiplayerActive && curState.userRole === 'controller') {
        if (['start_mission', 'pause_mission', 'resume_mission', 'emergency_stop'].includes(action)) {
          return {
            success: false,
            message: `Permission Denied: Robot navigation and emergency stopping are reserved for the Robot Operator.`,
          };
        }
      }

      switch (action) {
        case 'spawn_obstacle': {
          const type = parameters.objectType || 'cube';
          const pos = parameters.position;
          if (type === 'worker') {
            curState.spawnWorker(pos);
            return {
              success: true,
              message: `Placed dynamic Worker at [${(pos ? pos[0] : 0).toFixed(1)}, ${(pos ? pos[2] : 0).toFixed(1)}].`,
            };
          } else {
            curState.spawnInteractiveObject(type, pos);
            return {
              success: true,
              message: `Placed dynamic ${type === 'cube' ? 'Cargo Box' : 'Safety Sphere'} at [${(pos ? pos[0] : 0).toFixed(1)}, ${(pos ? pos[2] : 0).toFixed(1)}].`,
            };
          }
        }
        case 'spawn_workers': {
          const count = parameters.count || 5;
          curState.spawnCrowdedScenario(count);
          return {
            success: true,
            message: `Spawned ${count} moving warehouse workers across active aisles.`,
          };
        }
        case 'block_aisle': {
          const aisleId = parameters.aisleId || 'aisle-2';
          curState.blockAisle(aisleId);
          return {
            success: true,
            message: `Barricaded ${parameters.aisleName || aisleId}. Rerouting triggered.`,
          };
        }
        case 'unblock_aisle': {
          const aisleId = parameters.aisleId;
          if (aisleId) {
            const b = curState.activeBarriers.find((x) => x.aisleId === aisleId);
            if (b) curState.removeBarrier(b.id);
            else curState.clearAllBarriers();
          } else {
            curState.clearAllBarriers();
          }
          return {
            success: true,
            message: `Cleared barricade from ${parameters.aisleName || 'aisle'}. Corridor reopened.`,
          };
        }
        case 'remove_target_obstacle': {
          const targetId = parameters.targetObstacleId;
          if (targetId) {
            curState.deleteInteractiveObject(targetId);
            return {
              success: true,
              message: `Removed dynamic obstacle (${targetId}).`,
            };
          } else {
            const lastObj = curState.interactiveObjects[curState.interactiveObjects.length - 1];
            if (lastObj) {
              curState.deleteInteractiveObject(lastObj.id);
              return {
                success: true,
                message: `Removed dynamic obstacle ${lastObj.name || lastObj.id}.`,
              };
            }
            return { success: true, message: 'No dynamic obstacles found to remove.' };
          }
        }
        case 'clear_obstacles': {
          curState.clearInteractiveObjects();
          return {
            success: true,
            message: 'Cleared all dynamic objects and obstacles from simulation.',
          };
        }
        case 'start_mission': {
          const pref = parameters.navigationPreference || 'default';
          const destId = parameters.destinationId || 'bay-4';
          curState.startMission(destId, { preference: pref });
          return {
            success: true,
            message: `Started autonomous navigation to ${destId === 'bay-4' ? 'Bay 4' : destId}${pref === 'shortest_safe_path' ? ' via shortest safe path' : ''}.`,
          };
        }
        case 'replan_route': {
          curState.triggerReplan();
          return {
            success: true,
            message: 'Triggered global route replan to compute an alternative path.',
          };
        }
        case 'start_vertical_impact_scenario': {
          curState.startVerticalImpactScenario();
          return {
            success: true,
            message: 'Adversarial Vertical Impact Falling Pallet Test initialized. Robot dispatched towards Bay A with 250kg pallet suspended at Y=3.6m.',
          };
        }
        case 'set_difficulty': {
          const level = parameters.difficulty || 'extreme';
          curState.setDifficulty(level);
          return {
            success: true,
            message: `Scenario difficulty set to ${String(level || 'extreme').toUpperCase()}. Stress obstacles injected.`,
          };
        }
        case 'set_simulation_state': {
          const run = parameters.simulationRunning ?? true;
          set({ isRunning: run });
          return {
            success: true,
            message: run ? 'Simulation Resumed.' : 'Simulation Paused.',
          };
        }
        case 'emergency_stop': {
          curState.setEmergencyStop(true);
          return {
            success: true,
            message: 'Emergency Stop engaged (18.0 m/s²). Robot halted immediately.',
          };
        }
        case 'pause_mission': {
          curState.pauseMission();
          return {
            success: true,
            message: 'Robot paused and holding position (Route & destination preserved).',
          };
        }
        case 'resume_mission': {
          set({ isRunning: true });
          if (curState.robotStatus.isEmergencyStopped) {
            curState.setEmergencyStop(false);
          }
          if (curState.navState === 'STOPPED') {
            curState.resumeMission();
          } else {
            curState.startMission();
          }
          return {
            success: true,
            message: 'Robot navigation resumed along planned route.',
          };
        }
        default:
          return { success: true, message: `Action ${action} completed.` };
      }
    };

    let resultMsg = 'Action executed successfully.';
    let success = true;
    let stepResults:
      | Array<{
          stepId: string;
          intent: string;
          step?: number;
          action?: string;
          success: boolean;
          message: string;
        }>
      | undefined = undefined;

    try {
      if (cmd.isMultiIntent && cmd.subActions && cmd.subActions.length > 0) {
        stepResults = [];
        for (let i = 0; i < cmd.subActions.length; i++) {
          const sub = cmd.subActions[i];
          const freshState = get();
          const stepRes = executeStoreAction(sub.action, sub.parameters, freshState);
          stepResults.push({
            stepId: sub.id || `step-${i + 1}`,
            intent: sub.intent || sub.action,
            step: i + 1,
            action: sub.action,
            success: stepRes.success,
            message: stepRes.message,
          });
          if (!stepRes.success) {
            success = false;
            resultMsg = `Step ${i + 1} (${sub.action}) failed: ${stepRes.message}`;
            break;
          }
        }
        if (success) {
          resultMsg = `Successfully executed all ${cmd.subActions.length} actions in composite workflow.`;
        }
      } else {
        const res = executeStoreAction(cmd.action, cmd.parameters, state);
        success = res.success;
        resultMsg = res.message;
      }
    } catch (err: any) {
      success = false;
      resultMsg = `Execution error: ${err?.message || 'Unknown error'}`;
    }

    set((s) => ({
      pendingCommand: null,
      chatMessages: s.chatMessages.map((m) =>
        m.parsedCommand?.id === commandId
          ? {
              ...m,
              status: success ? 'approved' : 'failed',
              executionResult: { success, message: resultMsg, stepResults },
            }
          : m
      ),
      eventLog: [
        `[AI-COMMAND] Operator APPROVED: ${cmd.intent}`,
        ...s.eventLog.slice(0, 19),
      ],
    }));
  },

  rejectCommand: (commandId: string) => {
    const state = get();
    const msg = state.chatMessages.find((m) => m.parsedCommand?.id === commandId);
    const cmd = msg?.parsedCommand || state.pendingCommand;

    set((s) => ({
      pendingCommand: null,
      chatMessages: s.chatMessages.map((m) =>
        m.parsedCommand?.id === commandId
          ? {
              ...m,
              status: 'rejected',
              executionResult: {
                success: false,
                message: 'Action rejected by human operator. No simulation changes applied.',
              },
            }
          : m
      ),
      eventLog: [
        `[AI-COMMAND] Operator REJECTED: ${cmd?.intent || 'Command'}`,
        ...s.eventLog.slice(0, 19),
      ],
    }));
  },

  clearChatMessages: () => {
    set({
      chatMessages: [
        {
          id: `msg-${Date.now()}-init`,
          sender: 'ai',
          timestamp: Date.now(),
          text: '🤖 **Chat history cleared.** Ready for next instruction.',
        },
      ],
      pendingCommand: null,
    });
  },

  spawnWorker: (position, patrolStart, patrolEnd, speed = 1.1) => {
    const id = `worker-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const start: [number, number] = patrolStart || [position?.[0] || 0, (position?.[2] || 0) - 5];
    const end: [number, number] = patrolEnd || [position?.[0] || 0, (position?.[2] || 0) + 5];
    const pos: [number, number, number] = position || [start[0], 0.75, start[1]];

    const workerObj: InteractiveObject = {
      id,
      type: 'worker',
      position: pos,
      color: '#f97316',
      size: 0.55,
      rotation: 0,
      name: `Warehouse Worker`,
      patrolStart: start,
      patrolEnd: end,
      patrolSpeed: speed,
      patrolDirection: 1,
    };

    if (get().isMultiplayerActive) {
      multiplayerService.send('spawn_object', { object: workerObj });
    }

    set((state) => ({
      interactiveObjects: [...state.interactiveObjects, workerObj],
      triggerReplanCounter: state.triggerReplanCounter + 1,
      eventLog: [
        `[SCENARIO] Spawned worker patrolling [${start[0].toFixed(1)}, ${start[1].toFixed(1)}] <-> [${end[0].toFixed(1)}, ${end[1].toFixed(1)}]`,
        ...state.eventLog.slice(0, 19),
      ],
    }));
  },

  spawnForklift: (
    position,
    patrolStart,
    patrolEnd,
    speed = 1.4,
    name = 'Heavy Industrial Forklift'
  ) => {
    const id = `forklift-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const defaultPos: [number, number, number] = [-14.5, 0.0, -4.0];
    const defaultStart: [number, number] = [-14.5, -8.0];
    const defaultEnd: [number, number] = [-14.5, 2.0];

    const pos: [number, number, number] =
      position || (patrolStart ? [patrolStart[0], 0.0, patrolStart[1]] : defaultPos);
    const start: [number, number] =
      patrolStart || (position ? [position[0], position[2] - 4] : defaultStart);
    const end: [number, number] =
      patrolEnd || (position ? [position[0], position[2] + 4] : defaultEnd);

    const dx = end[0] - start[0];
    const dz = end[1] - start[1];
    const len = Math.hypot(dx, dz) || 1.0;
    const initialHeading = Math.atan2(dx, dz);
    const initialVx = (dx / len) * speed;
    const initialVz = (dz / len) * speed;

    const forkliftObj: InteractiveObject = {
      id,
      type: 'forklift',
      position: pos,
      color: '#eab308',
      size: 1.6,
      rotation: initialHeading,
      name,
      patrolStart: start,
      patrolEnd: end,
      patrolSpeed: speed,
      patrolDirection: 1,
      velocity: [initialVx, 0, initialVz],
    };

    if (get().isMultiplayerActive) {
      multiplayerService.send('spawn_object', { object: forkliftObj });
    }

    set((state) => ({
      interactiveObjects: [...state.interactiveObjects, forkliftObj],
      triggerReplanCounter: state.triggerReplanCounter + 1,
      eventLog: [
        `[SCENARIO] Spawned ${name} patrolling [${start[0].toFixed(1)}, ${start[1].toFixed(1)}] <-> [${end[0].toFixed(1)}, ${end[1].toFixed(1)}]`,
        ...state.eventLog.slice(0, 19),
      ],
    }));
  },

  spawnCrowdedScenario: (count = 5) => {
    const workerConfigs = [
      { start: [-8.0, 0.0] as [number, number], end: [8.0, 0.0] as [number, number], speed: 1.2 },
      { start: [-6.5, -6.0] as [number, number], end: [-6.5, 6.0] as [number, number], speed: 1.0 },
      { start: [0.0, -7.0] as [number, number], end: [0.0, 7.0] as [number, number], speed: 1.1 },
      { start: [6.5, -6.0] as [number, number], end: [6.5, 6.0] as [number, number], speed: 1.0 },
      { start: [-10.0, -10.5] as [number, number], end: [10.0, -10.5] as [number, number], speed: 1.3 },
    ];

    const actualCount = Math.min(count, workerConfigs.length);
    for (let i = 0; i < actualCount; i++) {
      const cfg = workerConfigs[i];
      get().spawnWorker([cfg.start[0], 0.75, cfg.start[1]], cfg.start, cfg.end, cfg.speed);
    }
  },

  setDifficulty: (level) => {
    if (get().isMultiplayerActive) {
      multiplayerService.send('set_difficulty', { difficulty: level });
    }

    set((state) => ({
      difficulty: level,
      eventLog: [
        `[SCENARIO] Simulation difficulty set to ${String(level || 'normal').toUpperCase()}`,
        ...state.eventLog.slice(0, 19),
      ],
    }));

    if (level === 'extreme') {
      get().spawnCrowdedScenario(5);
      get().spawnInteractiveObject('cube', [-2.0, 0.4, 0.0]);
      get().spawnInteractiveObject('cube', [2.0, 0.4, 0.0]);
      get().blockAisle('aisle-2');
    } else if (level === 'hard') {
      get().spawnCrowdedScenario(3);
      get().spawnInteractiveObject('cube', [0.0, 0.4, 0.0]);
    }
  },

  updateInteractiveObjectPosition: (id, pos) => {
    set((state) => ({
      interactiveObjects: state.interactiveObjects.map((obj) =>
        obj.id === id ? { ...obj, position: pos } : obj
      ),
    }));
  },

  // Collaborative Multiplayer State & Implementations
  isMultiplayerActive: false,
  sessionId: null,
  clientId: null,
  userRole: 'operator',
  connectionStatus: 'disconnected',
  latencyMs: 0,
  participants: [],
  isMultiplayerModalOpen: false,
  isChallengeLibraryOpen: false,

  setMultiplayerModalOpen: (open) => set({ isMultiplayerModalOpen: open }),
  setChallengeLibraryOpen: (open) => set({ isChallengeLibraryOpen: open }),

  createMultiplayerSession: async (userName = 'Host Operator', preferredRole = 'operator') => {
    try {
      set({ connectionStatus: 'connecting' });
      const res = await createSessionApi(userName, preferredRole);
      const sid = res.sessionId;
      const cid = res.clientId;
      const role: UserRole = (res.role || res.hostRole || preferredRole || 'operator') as UserRole;

      set((s) => ({
        isMultiplayerActive: true,
        sessionId: sid,
        clientId: cid,
        userRole: role,
        connectionStatus: 'connecting',
        participants: [
          {
            clientId: cid,
            role,
            name: userName || 'Host Operator',
            isHost: true,
            connectedAt: Date.now(),
          },
        ],
        eventLog: [
          `[MULTIPLAYER] Created Session ${sid} as ${String(role || 'operator').toUpperCase()}`,
          ...s.eventLog.slice(0, 19),
        ],
      }));

      multiplayerService.connect(
        sid,
        cid,
        role,
        (msg) => get().handleMultiplayerMessage(msg),
        (status, latency) => {
          set({ connectionStatus: status, latencyMs: latency });
        }
      );

      return sid;
    } catch (err: any) {
      set({ connectionStatus: 'error' });
      get().addLog(`[MULTIPLAYER] Failed to create session: ${err.message || err}`);
      throw err;
    }
  },

  joinMultiplayerSession: async (sessionId, userName = 'Scenario Controller', preferredRole = 'controller') => {
    if (!sessionId || typeof sessionId !== 'string' || !sessionId.trim()) {
      throw new Error('Please enter a valid 6-character room code.');
    }
    try {
      set({ connectionStatus: 'connecting' });
      const cleanId = sessionId.trim().toUpperCase();
      const res = await joinSessionApi(cleanId, userName, preferredRole);
      const cid = res.clientId;
      const role: UserRole = (res.role || preferredRole || 'controller') as UserRole;
      const pList: Participant[] = res.sessionInfo?.participants || res.participants || [
        {
          clientId: cid,
          role,
          name: userName || 'Scenario Controller',
          isHost: false,
          connectedAt: Date.now(),
        },
      ];

      set((s) => ({
        isMultiplayerActive: true,
        sessionId: cleanId,
        clientId: cid,
        userRole: role,
        connectionStatus: 'connecting',
        participants: pList,
        eventLog: [
          `[MULTIPLAYER] Joined Session ${cleanId} as ${String(role || 'controller').toUpperCase()}`,
          ...s.eventLog.slice(0, 19),
        ],
      }));

      if (res.currentSnapshot) {
        get().handleMultiplayerMessage({
          type: 'session_snapshot',
          sessionId: cleanId,
          clientId: cid,
          role,
          timestamp: Date.now(),
          payload: res.currentSnapshot,
        });
      }

      multiplayerService.connect(
        cleanId,
        cid,
        role,
        (msg) => get().handleMultiplayerMessage(msg),
        (status, latency) => {
          set({ connectionStatus: status, latencyMs: latency });
        }
      );
    } catch (err: any) {
      set({ connectionStatus: 'error' });
      get().addLog(`[MULTIPLAYER] Failed to join session: ${err.message || err}`);
      throw err;
    }
  },

  leaveMultiplayerSession: () => {
    multiplayerService.disconnect();
    set((state) => ({
      isMultiplayerActive: false,
      sessionId: null,
      clientId: null,
      userRole: 'operator',
      connectionStatus: 'disconnected',
      latencyMs: 0,
      participants: [],
      eventLog: [
        '[MULTIPLAYER] Disconnected from collaborative session.',
        ...state.eventLog.slice(0, 19),
      ],
    }));
  },

  setUserRole: (role) => {
    multiplayerService.setRole(role);
    set({ userRole: role });
  },

  setLatencyMs: (latencyMs) => {
    set({ latencyMs });
  },

  triggerPredefinedChallenge: (challengeId: string) => {
    const challenge = PREDEFINED_CHALLENGES.find((c) => c.id === challengeId);
    const chName = challenge?.title || challengeId;
    const state = get();

    if (state.isMultiplayerActive) {
      multiplayerService.send('trigger_challenge', {
        challengeId,
        challengeName: chName,
      });
    }

    if (!state.isMultiplayerActive || state.userRole === 'operator') {
      state.executeChallengeLocally(challengeId);
    } else {
      state.addLog(`[CHALLENGE] Scenario Controller dispatched '${chName}' to Operator`);
    }
  },

  executeChallengeLocally: (challengeId: string) => {
    const state = get();
    const rx = state.robotPose.position[0];
    const rz = state.robotPose.position[2];
    const yaw = state.robotPose.rotation;

    switch (challengeId) {
      case 'sudden_pedestrian_crossing': {
        const fwdX = Math.sin(yaw);
        const fwdZ = Math.cos(yaw);
        const perpX = Math.cos(yaw);
        const perpZ = -Math.sin(yaw);
        const targetX = rx + fwdX * 3.5;
        const targetZ = rz + fwdZ * 3.5;
        const start: [number, number] = [targetX - perpX * 4.0, targetZ - perpZ * 4.0];
        const end: [number, number] = [targetX + perpX * 4.0, targetZ + perpZ * 4.0];
        state.spawnWorker([start[0], 0.75, start[1]], start, end, 1.4);
        state.addLog('[CHALLENGE] 🚶‍♂️ Sudden Pedestrian Crossing deployed across path!');
        break;
      }
      case 'falling_box': {
        const bx = rx + Math.sin(yaw) * 3.2;
        const bz = rz + Math.cos(yaw) * 3.2;
        state.spawnInteractiveObject('cube', [bx, 0.4, bz]);
        state.addLog('[CHALLENGE] 📦 Falling Cargo Box tumbled into active transit corridor!');
        break;
      }
      case 'blocked_aisle': {
        state.blockAisle('aisle-2');
        state.addLog('[CHALLENGE] 🚧 Aisle 2 Barricaded! Global rerouting triggered.');
        break;
      }
      case 'multiple_moving_workers': {
        state.spawnCrowdedScenario(4);
        state.addLog('[CHALLENGE] 👥 4 Moving Warehouse Workers deployed.');
        break;
      }
      case 'unexpected_trolley': {
        state.spawnInteractiveObject('cube', [0.0, 0.4, 0.0]);
        state.addLog('[CHALLENGE] 🛒 Errant Rolling Trolley placed at central intersection.');
        break;
      }
      case 'multiple_simultaneous_hazards': {
        state.blockAisle('aisle-2');
        const cx = rx + Math.sin(yaw) * 3.0;
        const cz = rz + Math.cos(yaw) * 3.0;
        state.spawnInteractiveObject('cube', [cx, 0.4, cz]);
        state.spawnCrowdedScenario(2);
        state.addLog('[CHALLENGE] ⚠️ MULTI-HAZARD CATASTROPHE deployed!');
        break;
      }
      case 'impossible_mission_normal': {
        state.setDifficulty('normal');
        state.clearInteractiveObjects();
        state.clearAllBarriers();
        state.addLog('[CHALLENGE] 🟢 Normal Baseline Scenario restored.');
        break;
      }
      case 'impossible_mission_hard': {
        state.setDifficulty('hard');
        state.addLog('[CHALLENGE] 🟠 Hard Difficulty Preset engaged.');
        break;
      }
      case 'impossible_mission_extreme': {
        state.setDifficulty('extreme');
        state.addLog('[CHALLENGE] 🔥 EXTREME IMPOSSIBLE MISSION engaged!');
        break;
      }
      default:
        state.addLog(`[CHALLENGE] Unknown challenge: ${challengeId}`);
    }
  },

  broadcastMultiplayer: (msgType, payload = {}) => {
    if (get().isMultiplayerActive) {
      multiplayerService.send(msgType, payload);
    }
  },

  applyIncomingTelemetry: (telemetry) => {
    set((state) => {
      // Operator is authoritative and does not overwrite local physics with incoming telemetry
      if (state.userRole === 'operator') return state;

      return {
        robotPose: telemetry.robotPose || state.robotPose,
        navState: telemetry.navState || state.navState,
        plannedPath: telemetry.plannedPath || state.plannedPath,
        currentWaypointIndex: telemetry.currentWaypointIndex ?? state.currentWaypointIndex,
        sensorData: telemetry.sensorData || state.sensorData,
        missionMetrics: telemetry.missionMetrics || state.missionMetrics,
        diagnostics: telemetry.diagnostics || state.diagnostics,
        currentTime: telemetry.currentTime ?? state.currentTime,
        isRunning: telemetry.isRunning ?? state.isRunning,
        difficulty: (telemetry.difficulty as any) || state.difficulty,
      };
    });
  },

  handleMultiplayerMessage: (msg: MultiplayerMessage) => {
    const state = get();

    switch (msg.type) {
      case 'session_welcome': {
        const pList = msg.payload?.participants || msg.payload?.sessionInfo?.participants || [];
        const assignedRole = msg.role || state.userRole || 'operator';
        multiplayerService.setRole(assignedRole);
        set({
          participants: pList,
          connectionStatus: 'connected',
          userRole: assignedRole,
        });
        if (msg.payload?.sessionInfo) {
          const s = msg.payload.sessionInfo;
          set({
            difficulty: s.difficulty || state.difficulty,
            isRunning: s.isRunning ?? state.isRunning,
          });
        }
        if (msg.payload?.snapshot) {
          const snap = msg.payload.snapshot;
          set((s) => ({
            difficulty: snap.difficulty || s.difficulty,
            isRunning: snap.is_running ?? snap.isRunning ?? s.isRunning,
            robotPose: snap.robot_pose || snap.robotPose || s.robotPose,
            navState: snap.nav_state || snap.navState || s.navState,
            plannedPath: snap.planned_path || snap.plannedPath || s.plannedPath,
            currentWaypointIndex: snap.current_waypoint_index ?? snap.currentWaypointIndex ?? s.currentWaypointIndex,
            sensorData: snap.sensor_data || snap.sensorData || s.sensorData,
            missionMetrics: snap.mission_metrics || snap.missionMetrics || s.missionMetrics,
            diagnostics: snap.diagnostics || s.diagnostics,
            interactiveObjects: snap.interactive_objects || snap.interactiveObjects || s.interactiveObjects,
            activeBarriers: snap.active_barriers || snap.activeBarriers || s.activeBarriers,
          }));
        }
        break;
      }
      case 'peer_joined': {
        const pList = msg.payload?.participants;
        const joined = msg.payload?.participant;
        set((s) => ({
          participants: pList && pList.length > 0 ? pList : joined ? [...s.participants, joined] : s.participants,
          eventLog: [
            `[MULTIPLAYER] ${joined?.name || 'Peer'} joined as ${String(joined?.role || 'peer').toUpperCase()}`,
            ...s.eventLog.slice(0, 19),
          ],
        }));
        break;
      }
      case 'peer_left': {
        const pList = msg.payload?.participants || [];
        const name = msg.payload?.name || msg.clientId;
        set((s) => ({
          participants: pList,
          eventLog: [
            `[MULTIPLAYER] ${name} left session`,
            ...s.eventLog.slice(0, 19),
          ],
        }));
        break;
      }
      case 'sim_telemetry':
      case 'robot_telemetry':
      case 'robot_pose_update':
      case 'telemetry_update': {
        state.applyIncomingTelemetry(msg.payload);
        break;
      }
      case 'spawn_object':
      case 'spawn_obstacle':
      case 'obstacle_spawned': {
        const obj = msg.payload?.object || msg.payload?.obstacle;
        if (obj) {
          set((s) => {
            const exists = s.interactiveObjects.some((o) => o.id === obj.id);
            return {
              interactiveObjects: exists
                ? s.interactiveObjects.map((o) => (o.id === obj.id ? obj : o))
                : [...s.interactiveObjects, obj],
              triggerReplanCounter: s.triggerReplanCounter + 1,
              eventLog: [
                `[PEER HAZARD] Injected ${obj.name || 'Obstacle'} at [${(obj.position?.[0] || 0).toFixed(1)}, ${(obj.position?.[2] || 0).toFixed(1)}]`,
                ...s.eventLog.slice(0, 19),
              ],
            };
          });
        }
        break;
      }
      case 'remove_object':
      case 'remove_obstacle':
      case 'obstacle_removed': {
        const id = msg.payload?.objectId || msg.payload?.obstacleId || msg.payload?.id;
        if (id) {
          set((s) => ({
            interactiveObjects: s.interactiveObjects.filter((o) => o.id !== id),
            triggerReplanCounter: s.triggerReplanCounter + 1,
            eventLog: [`[PEER HAZARD] Removed object ${id}`, ...s.eventLog.slice(0, 19)],
          }));
        }
        break;
      }
      case 'clear_objects':
      case 'clear_obstacles': {
        set((s) => ({
          interactiveObjects: [],
          triggerReplanCounter: s.triggerReplanCounter + 1,
          eventLog: ['[PEER HAZARD] Cleared all placed dynamic test objects', ...s.eventLog.slice(0, 19)],
        }));
        break;
      }
      case 'block_aisle':
      case 'aisle_blocked': {
        const barrier = msg.payload?.barrier;
        const aisleId = msg.payload?.aisleId;
        if (barrier) {
          set((s) => {
            const exists = s.activeBarriers.some((b) => b.aisleId === barrier.aisleId);
            return {
              activeBarriers: exists
                ? s.activeBarriers.map((b) => (b.aisleId === barrier.aisleId ? barrier : b))
                : [...s.activeBarriers, barrier],
              triggerReplanCounter: s.triggerReplanCounter + 1,
              eventLog: [`[PEER BARRIER] Barricaded ${barrier.name || barrier.aisleId}`, ...s.eventLog.slice(0, 19)],
            };
          });
        } else if (aisleId) {
          const exists = state.activeBarriers.some((b) => b.aisleId === aisleId);
          if (!exists) {
            state.blockAisle(aisleId);
          }
        }
        break;
      }
      case 'remove_barrier':
      case 'barrier_removed': {
        const barrierId = msg.payload?.barrierId || msg.payload?.id;
        const aisleId = msg.payload?.aisleId;
        set((s) => ({
          activeBarriers: s.activeBarriers.filter((b) => b.id !== barrierId && b.aisleId !== aisleId),
          triggerReplanCounter: s.triggerReplanCounter + 1,
          eventLog: ['[PEER BARRIER] Removed barricade', ...s.eventLog.slice(0, 19)],
        }));
        break;
      }
      case 'clear_barriers': {
        set((s) => ({
          activeBarriers: [],
          triggerReplanCounter: s.triggerReplanCounter + 1,
          eventLog: ['[PEER BARRIER] Cleared all aisle barricades', ...s.eventLog.slice(0, 19)],
        }));
        break;
      }
      case 'set_difficulty':
      case 'scenario_updated': {
        const level = msg.payload?.difficulty;
        if (level && ['normal', 'hard', 'extreme'].includes(level)) {
          set((s) => ({
            difficulty: level,
            eventLog: [`[PEER SCENARIO] Difficulty changed to ${String(level || 'normal').toUpperCase()}`, ...s.eventLog.slice(0, 19)],
          }));
        }
        break;
      }
      case 'trigger_challenge':
      case 'challenge_triggered': {
        const chId = msg.payload?.challengeId;
        const chName = msg.payload?.challengeName || chId;
        if (msg.payload?.interactiveObjects) {
          set({
            interactiveObjects: msg.payload.interactiveObjects,
            activeBarriers: msg.payload.activeBarriers || state.activeBarriers,
            difficulty: msg.payload.difficulty || state.difficulty,
            triggerReplanCounter: state.triggerReplanCounter + 1,
            eventLog: [`[CHALLENGE] ${chName} synchronized across session`, ...state.eventLog.slice(0, 19)],
          });
        } else if (state.userRole === 'operator') {
          state.executeChallengeLocally(chId);
        } else {
          state.addLog(`[CHALLENGE] Scenario triggered: ${chName}`);
        }
        break;
      }
      case 'set_clock_state':
      case 'simulation_clock_update': {
        const run = msg.payload?.isRunning ?? true;
        set((s) => ({
          isRunning: run,
          eventLog: [`[CLOCK] Simulation ${run ? 'Resumed' : 'Paused'} by peer`, ...s.eventLog.slice(0, 19)],
        }));
        break;
      }
      case 'start_mission':
      case 'mission_status_changed': {
        const nav = msg.payload?.navState;
        if (nav) {
          set((s) => ({
            navState: nav,
            robotStatus: {
              ...s.robotStatus,
              isEmergencyStopped: msg.payload?.isEmergencyStopped ?? s.robotStatus.isEmergencyStopped,
            },
            eventLog: [`[MISSION] Mission status: ${nav}`, ...s.eventLog.slice(0, 19)],
          }));
        }
        break;
      }
      case 'emergency_stop': {
        set((s) => ({
          robotStatus: {
            ...s.robotStatus,
            isEmergencyStopped: true,
          },
          navState: 'STOPPED',
          eventLog: ['[SAFETY] EMERGENCY STOP ENGAGED BY OPERATOR!', ...s.eventLog.slice(0, 19)],
        }));
        break;
      }
      case 'session_snapshot':
      case 'simulation_snapshot': {
        const snap = msg.payload;
        if (snap) {
          set((s) => ({
            difficulty: snap.difficulty || s.difficulty,
            isRunning: snap.is_running ?? snap.isRunning ?? s.isRunning,
            robotPose: snap.robot_pose || snap.robotPose || s.robotPose,
            navState: snap.nav_state || snap.navState || s.navState,
            plannedPath: snap.planned_path || snap.plannedPath || s.plannedPath,
            currentWaypointIndex: snap.current_waypoint_index ?? snap.currentWaypointIndex ?? s.currentWaypointIndex,
            sensorData: snap.sensor_data || snap.sensorData || s.sensorData,
            missionMetrics: snap.mission_metrics || snap.missionMetrics || s.missionMetrics,
            diagnostics: snap.diagnostics || s.diagnostics,
            interactiveObjects: snap.interactive_objects || snap.interactiveObjects || s.interactiveObjects,
            activeBarriers: snap.active_barriers || snap.activeBarriers || s.activeBarriers,
          }));
        }
        break;
      }
      case 'permission_denied': {
        state.addLog(`[PERMISSION DENIED] ${msg.payload?.reason || 'Action not authorized.'}`);
        break;
      }
      default:
        break;
    }
  },

  eventLog: [
    '[SYSTEM] ROBOTRISK AI simulation core initialized.',
    '[SYSTEM] Autonomous Lab navigation engine online.',
  ],
  addLog: (msg) =>
    set((state) => ({
      eventLog: [msg, ...state.eventLog.slice(0, 19)],
    })),
};
});

// Attach store to window for DevTools access and diagnostic scripts
if (typeof window !== 'undefined') {
  (window as any).useSimulationStore = useSimulationStore;
}

