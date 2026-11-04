/**
 * Black Box Flight Recorder & Telemetry System
 * 
 * ROBOTRISK AI — PHASE 5.3B
 * 
 * FEATURES:
 * 1. Bounded in-memory circular ring buffer: Max 10,000 frames per session (~16.6 min @ 10Hz).
 * 2. 10 Hz deterministic sampling tied to authoritative simulation clock (simTime).
 * 3. Event-driven instant incident capture: Collisions, near-misses, emergency braking,
 *    and TTC status changes trigger immediate telemetry snapshots even between 10Hz ticks.
 * 4. Bounded session management: Retains up to 5 historical sessions; oldest evicted on overflow.
 * 5. Simulation pause/resume/reset resilience: Never creates artificial frames during pause.
 * 6. Multiplayer role attribution: Distinguishes authoritative ground truth from remote mirror.
 * 7. Real RFC 4180 CSV and JSON data export with exact timestamps and incident snapshots.
 */

import { RobotPose, NavState, SensorData, InteractiveObject, AisleBarrier } from '../types/simulation';

export type IncidentType =
  | 'COLLISION'
  | 'NEAR_MISS'
  | 'EMERGENCY_BRAKING'
  | 'OBSTACLE_DETECTED'
  | 'TTC_WARNING'
  | 'TTC_CRITICAL'
  | 'ROUTE_BLOCKED'
  | 'ROUTE_RECALCULATED'
  | 'NAVIGATION_FAILED'
  | 'MISSION_COMPLETED';

export interface TelemetryFrame {
  /** Authoritative simulation timestamp in seconds */
  simTime: number;
  /** Wall clock timestamp in milliseconds (Date.now()) */
  wallTime: number;
  /** Robot position [X, Y, Z] in meters */
  position: [number, number, number];
  /** Robot yaw heading in radians */
  rotation: number;
  /** Forward linear velocity in m/s */
  linearVelocity: number;
  /** Rotational angular velocity in rad/s */
  angularVelocity: number;
  /** Autonomous navigation state */
  navState: NavState;
  /** Time-to-Collision in seconds (null if no collision course) */
  ttc: number | null;
  /** Minimum clearance to physical obstacle boundaries in meters */
  minClearance: number;
  /** Safety status */
  safetyStatus: 'SAFE' | 'WARNING' | 'CRITICAL';
  /** Primary obstacle or threat name */
  highestRiskObstacle: string | null;
  /** Whether trajectories are currently on collision course */
  isCollisionCourse: boolean;
  /** Count of active dynamic obstacles in the warehouse */
  activeObstaclesCount: number;
  /** Range readings from LiDAR rays in meters */
  lidar: {
    forward: number;
    left: number;
    right: number;
  };
}

export interface IncidentEvent {
  id: string;
  type: IncidentType;
  simTime: number;
  wallTime: number;
  description: string;
  snapshot: TelemetryFrame;
  details?: Record<string, any>;
}

export interface FlightRecordingSession {
  recordingId: string;
  sessionId: string;
  startTimeSim: number;
  endTimeSim: number;
  startTimeWall: number;
  endTimeWall: number;
  isAuthoritative: boolean;
  userRole: 'operator' | 'controller' | 'local';
  frames: TelemetryFrame[];
  totalFramesSampled: number;
  hasBufferWrapped: boolean;
  incidents: IncidentEvent[];
  isCompleted: boolean;
  scenarioId?: string;
  scenarioTitle?: string;
  generatorEngine?: string;
  scenarioSeed?: number;
}

export const MAX_FRAMES_PER_SESSION = 10000;
export const MAX_RETAINED_SESSIONS = 5;
export const SAMPLE_INTERVAL_SIM_SECONDS = 0.10; // 10 Hz = 100ms

export class FlightRecorderService {
  private isRecording: boolean = false;
  private currentSession: FlightRecordingSession | null = null;
  private pastSessions: FlightRecordingSession[] = [];
  private lastSampleSimTime: number = -1;

  // State transition tracking for event deduplication
  private lastSafetyStatus: 'SAFE' | 'WARNING' | 'CRITICAL' = 'SAFE';
  private lastBrakingStatus: string = 'cruising';
  private lastRouteValidity: string = 'valid';
  private lastNavState: NavState = 'IDLE';
  private lastReplanCount: number = 0;
  private lastDetectedObstacleName: string | null = null;

  public getIsRecording(): boolean {
    return this.isRecording;
  }

  public getCurrentSession(): FlightRecordingSession | null {
    return this.currentSession;
  }

  public getPastSessions(): FlightRecordingSession[] {
    return this.pastSessions;
  }

  public getAllSessions(): FlightRecordingSession[] {
    return this.currentSession
      ? [this.currentSession, ...this.pastSessions]
      : [...this.pastSessions];
  }

  /**
   * Start recording a new flight recording session.
   */
  public startRecording(
    simTime: number,
    isAuthoritative: boolean = true,
    userRole: 'operator' | 'controller' | 'local' = 'local',
    multiplayerSessionId: string = 'LOCAL-SOLO',
    scenarioMetadata?: {
      scenarioId?: string;
      scenarioTitle?: string;
      generatorEngine?: string;
      scenarioSeed?: number;
    }
  ): FlightRecordingSession {
    // If a session is already running, complete and archive it first
    if (this.currentSession && !this.currentSession.isCompleted) {
      this.stopRecording(simTime);
    }

    const nowWall = Date.now();
    const recordingId = `REC-${nowWall.toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

    this.currentSession = {
      recordingId,
      sessionId: multiplayerSessionId,
      startTimeSim: simTime,
      endTimeSim: simTime,
      startTimeWall: nowWall,
      endTimeWall: nowWall,
      isAuthoritative,
      userRole,
      frames: [],
      totalFramesSampled: 0,
      hasBufferWrapped: false,
      incidents: [],
      isCompleted: false,
      scenarioId: scenarioMetadata?.scenarioId,
      scenarioTitle: scenarioMetadata?.scenarioTitle,
      generatorEngine: scenarioMetadata?.generatorEngine,
      scenarioSeed: scenarioMetadata?.scenarioSeed,
    };

    this.isRecording = true;
    this.lastSampleSimTime = -1;
    this.lastSafetyStatus = 'SAFE';
    this.lastBrakingStatus = 'cruising';
    this.lastRouteValidity = 'valid';
    this.lastNavState = 'IDLE';

    return this.currentSession;
  }

  /**
   * Safely discard an uncompleted recording session (e.g. on failed scenario mission launch).
   * Leaves all completed historical recordings in pastSessions completely intact.
   */
  public discardCurrentSession(): void {
    if (this.currentSession && !this.currentSession.isCompleted) {
      this.currentSession = null;
      this.isRecording = false;
      this.lastSampleSimTime = -1;
    }
  }

  /**
   * Stop the active flight recording session.
   */
  public stopRecording(simTime: number): FlightRecordingSession | null {
    if (!this.currentSession) {
      this.isRecording = false;
      return null;
    }

    this.currentSession.endTimeSim = simTime;
    this.currentSession.endTimeWall = Date.now();
    this.currentSession.isCompleted = true;
    this.isRecording = false;

    // Retain in bounded history (max 5 sessions)
    this.pastSessions.unshift(this.currentSession);
    if (this.pastSessions.length > MAX_RETAINED_SESSIONS) {
      this.pastSessions = this.pastSessions.slice(0, MAX_RETAINED_SESSIONS);
    }

    const finished = this.currentSession;
    this.currentSession = null;
    return finished;
  }

  /**
   * Reset / clear all recorded sessions from memory.
   */
  public clearAllSessions(): void {
    this.currentSession = null;
    this.pastSessions = [];
    this.isRecording = false;
    this.lastSampleSimTime = -1;
  }

  /**
   * Helper to build a comprehensive TelemetryFrame snapshot.
   */
  public createSnapshot(
    simTime: number,
    robotPose: RobotPose,
    navState: NavState,
    sensorData: SensorData,
    interactiveObjects: InteractiveObject[] = [],
    activeBarriers: AisleBarrier[] = []
  ): TelemetryFrame {
    return {
      simTime,
      wallTime: Date.now(),
      position: [
        Number(robotPose.position[0].toFixed(3)),
        Number(robotPose.position[1].toFixed(3)),
        Number(robotPose.position[2].toFixed(3)),
      ],
      rotation: Number(robotPose.rotation.toFixed(4)),
      linearVelocity: Number((robotPose.linearVelocity || 0).toFixed(3)),
      angularVelocity: Number((robotPose.angularVelocity || 0).toFixed(3)),
      navState,
      ttc: sensorData.ttc !== null && sensorData.ttc !== undefined ? Number(sensorData.ttc.toFixed(2)) : null,
      minClearance: Number((sensorData.minClearance ?? 999.0).toFixed(3)),
      safetyStatus: sensorData.safetyStatus || 'SAFE',
      highestRiskObstacle: sensorData.highestRiskObstacle || sensorData.closestObstacle || null,
      isCollisionCourse: Boolean(sensorData.isCollisionCourse),
      activeObstaclesCount: interactiveObjects.length + activeBarriers.length,
      lidar: {
        forward: Number(sensorData.forwardDist.toFixed(2)),
        left: Number(sensorData.leftDist.toFixed(2)),
        right: Number(sensorData.rightDist.toFixed(2)),
      },
    };
  }

  /**
   * Samples a telemetry frame at 10 Hz against the simulation clock.
   * Only captures when the simulation time has advanced by >= 0.10s.
   * If simulation is paused (simTime not advancing), no artificial frames are recorded.
   */
  public sampleFrame(
    simTime: number,
    robotPose: RobotPose,
    navState: NavState,
    sensorData: SensorData,
    interactiveObjects: InteractiveObject[] = [],
    activeBarriers: AisleBarrier[] = [],
    diagnostics?: { brakingStatus?: string; routeValidity?: string; replanCount?: number }
  ): boolean {
    if (!this.isRecording || !this.currentSession) {
      return false;
    }

    // Rate limit: 10 Hz = 0.10s between frames in simulation time
    // If simulation is paused (simTime not advancing) or called between 100ms intervals, do not sample
    const timeSinceLast = simTime - this.lastSampleSimTime;
    if (this.lastSampleSimTime >= 0 && timeSinceLast < SAMPLE_INTERVAL_SIM_SECONDS - 0.005) {
      return false;
    }

    // Check state-transition critical incidents at this sample point
    this.evaluateStateTransitions(simTime, robotPose, navState, sensorData, interactiveObjects, activeBarriers, diagnostics);

    this.lastSampleSimTime = simTime;
    const snapshot = this.createSnapshot(simTime, robotPose, navState, sensorData, interactiveObjects, activeBarriers);

    this.pushFrame(snapshot);
    this.currentSession.endTimeSim = simTime;
    this.currentSession.endTimeWall = Date.now();

    return true;
  }

  /**
   * Internal circular ring buffer pusher with 10,000-frame bound.
   */
  private pushFrame(frame: TelemetryFrame): void {
    if (!this.currentSession) return;

    this.currentSession.totalFramesSampled++;

    if (this.currentSession.frames.length < MAX_FRAMES_PER_SESSION) {
      this.currentSession.frames.push(frame);
    } else {
      // Buffer full -> circular FIFO overwrite
      this.currentSession.hasBufferWrapped = true;
      this.currentSession.frames.shift();
      this.currentSession.frames.push(frame);
    }
  }

  /**
   * Immediately records a critical incident event with an exact-time telemetry snapshot.
   * Executed immediately even between 10 Hz periodic sampling boundaries.
   */
  public recordIncident(
    type: IncidentType,
    description: string,
    simTime: number,
    robotPose: RobotPose,
    navState: NavState,
    sensorData: SensorData,
    interactiveObjects: InteractiveObject[] = [],
    activeBarriers: AisleBarrier[] = [],
    details?: Record<string, any>,
    skipPushFrame: boolean = false
  ): IncidentEvent | null {
    if (!this.isRecording || !this.currentSession) {
      return null;
    }

    const snapshot = this.createSnapshot(simTime, robotPose, navState, sensorData, interactiveObjects, activeBarriers);
    const incident: IncidentEvent = {
      id: `INC-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 5)}`,
      type,
      simTime,
      wallTime: Date.now(),
      description,
      snapshot,
      details,
    };

    // Bounded incident storage (max 500 incidents per session)
    if (this.currentSession.incidents.length < 500) {
      this.currentSession.incidents.push(incident);
    } else {
      this.currentSession.incidents.shift();
      this.currentSession.incidents.push(incident);
    }

    // For out-of-band events occurring between samples, push snapshot frame to capture exact moment
    if (!skipPushFrame) {
      this.pushFrame(snapshot);
    }

    return incident;
  }

  /**
   * Monitors state changes to fire event-driven incidents with zero latency.
   */
  private evaluateStateTransitions(
    simTime: number,
    robotPose: RobotPose,
    navState: NavState,
    sensorData: SensorData,
    interactiveObjects: InteractiveObject[],
    activeBarriers: AisleBarrier[],
    diagnostics?: { brakingStatus?: string; routeValidity?: string; replanCount?: number }
  ): void {
    const currentSafety = sensorData.safetyStatus || 'SAFE';
    const threatName = sensorData.highestRiskObstacle || sensorData.closestObstacle || 'Obstacle';

    // 1. TTC Critical Transition
    if (currentSafety === 'CRITICAL' && this.lastSafetyStatus !== 'CRITICAL') {
      this.recordIncident(
        'TTC_CRITICAL',
        `Critical Safety Threshold Exceeded! TTC: ${sensorData.ttc !== null && sensorData.ttc !== undefined ? sensorData.ttc.toFixed(1) + 's' : 'N/A'}, Clearance: ${(sensorData.minClearance ?? 0).toFixed(2)}m with ${threatName}`,
        simTime,
        robotPose,
        navState,
        sensorData,
        interactiveObjects,
        activeBarriers,
        undefined,
        true
      );
    } else if (currentSafety === 'WARNING' && this.lastSafetyStatus === 'SAFE') {
      this.recordIncident(
        'TTC_WARNING',
        `Warning Proximity Triggered. Threat: ${threatName}, TTC: ${sensorData.ttc !== null && sensorData.ttc !== undefined ? sensorData.ttc.toFixed(1) + 's' : 'N/A'}`,
        simTime,
        robotPose,
        navState,
        sensorData,
        interactiveObjects,
        activeBarriers,
        undefined,
        true
      );
    }
    this.lastSafetyStatus = currentSafety;

    // 2. Emergency Braking Transition
    const brakingStatus = diagnostics?.brakingStatus || 'cruising';
    if (brakingStatus === 'emergency_braking' && this.lastBrakingStatus !== 'emergency_braking') {
      this.recordIncident(
        'EMERGENCY_BRAKING',
        `Emergency Braking Activated! Deceleration engaged to avert collision with ${threatName}`,
        simTime,
        robotPose,
        navState,
        sensorData,
        interactiveObjects,
        activeBarriers,
        undefined,
        true
      );
    }
    this.lastBrakingStatus = brakingStatus;

    // 3. Route Blocked Transition
    const routeVal = diagnostics?.routeValidity || 'valid';
    if (routeVal === 'blocked' && this.lastRouteValidity !== 'blocked') {
      this.recordIncident(
        'ROUTE_BLOCKED',
        `Planned Corridor Blocked by ${threatName}. Replan necessitated.`,
        simTime,
        robotPose,
        navState,
        sensorData,
        interactiveObjects,
        activeBarriers,
        undefined,
        true
      );
    }
    this.lastRouteValidity = routeVal;

    // 4. Navigation State Transitions
    if (navState !== this.lastNavState) {
      if (navState === 'FAILED') {
        this.recordIncident(
          'NAVIGATION_FAILED',
          'Autonomous Navigation Failed: Destination unreachable.',
          simTime,
          robotPose,
          navState,
          sensorData,
          interactiveObjects,
          activeBarriers,
          undefined,
          true
        );
      } else if (navState === 'COMPLETED') {
        this.recordIncident(
          'MISSION_COMPLETED',
          'Autonomous Mission Successfully Completed. Goal reached safely.',
          simTime,
          robotPose,
          navState,
          sensorData,
          interactiveObjects,
          activeBarriers,
          undefined,
          true
        );
      }
      this.lastNavState = navState;
    }

    // 5. Replanning count increment
    const curReplan = diagnostics?.replanCount ?? 0;
    if (curReplan > this.lastReplanCount) {
      this.recordIncident(
        'ROUTE_RECALCULATED',
        `Dynamic Replan #${curReplan} triggered due to obstacle in path.`,
        simTime,
        robotPose,
        navState,
        sensorData,
        interactiveObjects,
        activeBarriers,
        undefined,
        true
      );
      this.lastReplanCount = curReplan;
    }

    // 6. Obstacle detection transition (only after baseline established)
    if (this.lastDetectedObstacleName === null) {
      this.lastDetectedObstacleName = sensorData.closestObstacle || '';
    } else if (
      sensorData.closestObstacle &&
      sensorData.closestObstacle !== this.lastDetectedObstacleName &&
      sensorData.forwardDist < 4.0
    ) {
      this.recordIncident(
        'OBSTACLE_DETECTED',
        `New threat detected in path: ${sensorData.closestObstacle} at ${sensorData.forwardDist.toFixed(1)}m`,
        simTime,
        robotPose,
        navState,
        sensorData,
        interactiveObjects,
        activeBarriers,
        undefined,
        true
      );
      this.lastDetectedObstacleName = sensorData.closestObstacle;
    }
  }

  /**
   * Export a recording session to JSON format.
   */
  public exportSessionAsJSON(session: FlightRecordingSession): string {
    const exportData = {
      format: 'RobotRisk-FlightRecorder-v1',
      exportedAtISO: new Date().toISOString(),
      metadata: {
        recordingId: session.recordingId,
        sessionId: session.sessionId,
        isAuthoritative: session.isAuthoritative,
        userRole: session.userRole,
        startTimeSim: session.startTimeSim,
        endTimeSim: session.endTimeSim,
        durationSimSeconds: Number((session.endTimeSim - session.startTimeSim).toFixed(2)),
        startTimeWallISO: new Date(session.startTimeWall).toISOString(),
        endTimeWallISO: new Date(session.endTimeWall).toISOString(),
        totalFramesSampled: session.totalFramesSampled,
        retainedFramesCount: session.frames.length,
        hasBufferWrapped: session.hasBufferWrapped,
        maxBufferCapacity: MAX_FRAMES_PER_SESSION,
        totalIncidentsCount: session.incidents.length,
        scenarioId: session.scenarioId || null,
        scenarioTitle: session.scenarioTitle || null,
        generatorEngine: session.generatorEngine || null,
        scenarioSeed: session.scenarioSeed !== undefined ? session.scenarioSeed : null,
      },
      incidentSummary: {
        collisions: session.incidents.filter((i) => i.type === 'COLLISION').length,
        nearMisses: session.incidents.filter((i) => i.type === 'NEAR_MISS').length,
        emergencyBraking: session.incidents.filter((i) => i.type === 'EMERGENCY_BRAKING').length,
        ttcCritical: session.incidents.filter((i) => i.type === 'TTC_CRITICAL').length,
        ttcWarning: session.incidents.filter((i) => i.type === 'TTC_WARNING').length,
        routeBlocked: session.incidents.filter((i) => i.type === 'ROUTE_BLOCKED').length,
        recalculated: session.incidents.filter((i) => i.type === 'ROUTE_RECALCULATED').length,
        failures: session.incidents.filter((i) => i.type === 'NAVIGATION_FAILED').length,
        completions: session.incidents.filter((i) => i.type === 'MISSION_COMPLETED').length,
      },
      incidents: session.incidents,
      telemetryFrames: session.frames,
    };

    return JSON.stringify(exportData, null, 2);
  }

  /**
   * Export a recording session to RFC 4180 compliant CSV format.
   */
  public exportSessionAsCSV(session: FlightRecordingSession): string {
    const headers = [
      'sim_time_sec',
      'wall_time_iso',
      'pos_x',
      'pos_y',
      'pos_z',
      'rotation_rad',
      'linear_velocity_mps',
      'angular_velocity_rads',
      'nav_state',
      'ttc_sec',
      'min_clearance_m',
      'safety_status',
      'highest_risk_threat',
      'is_collision_course',
      'active_obstacles_count',
      'lidar_fwd_m',
      'lidar_left_m',
      'lidar_right_m',
    ];

    const rows = session.frames.map((f) => [
      f.simTime.toFixed(3),
      new Date(f.wallTime).toISOString(),
      f.position[0].toFixed(3),
      f.position[1].toFixed(3),
      f.position[2].toFixed(3),
      f.rotation.toFixed(4),
      f.linearVelocity.toFixed(3),
      f.angularVelocity.toFixed(3),
      f.navState,
      f.ttc !== null ? f.ttc.toFixed(2) : 'NONE',
      f.minClearance.toFixed(3),
      f.safetyStatus,
      `"${(f.highestRiskObstacle || 'NONE').replace(/"/g, '""')}"`,
      f.isCollisionCourse ? 'TRUE' : 'FALSE',
      f.activeObstaclesCount,
      f.lidar.forward.toFixed(2),
      f.lidar.left.toFixed(2),
      f.lidar.right.toFixed(2),
    ]);

    return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  }

  /**
   * Generates a descriptive filename for the export.
   */
  public generateExportFilename(session: FlightRecordingSession, extension: 'json' | 'csv'): string {
    const d = new Date(session.startTimeWall);
    const dateStr = d.toISOString().replace(/[-:]/g, '').replace('T', '_').split('.')[0];
    const roleStr = session.isAuthoritative ? 'auth' : 'mirror';
    return `robotrisk_flight_log_${session.recordingId}_${roleStr}_${dateStr}.${extension}`;
  }
}

// Global Singleton Flight Recorder Instance
export const flightRecorderService = new FlightRecorderService();
