/**
 * Dynamic Time-to-Collision (TTC) & Near-Miss Detection Engine
 * 
 * ROBOTRISK AI — PHASE 5.3A
 * 
 * NOTE ON TRAJECTORY PREDICTION:
 * This module computes forward Time-to-Collision (TTC) based on constant-velocity
 * linear trajectory projection:
 *    p_R(t) = p_R(0) + v_R * t
 *    p_O(t) = p_O(0) + v_O * t
 * 
 * This is a forward first-order kinematic estimate recalculated on each simulation frame,
 * NOT a certified safety guarantee. Real-world obstacles (such as warehouse workers)
 * may accelerate, turn, or reverse their trajectories. The system handles dynamic obstacles
 * by deriving instantaneous velocities from simulation timesteps and updating TTC
 * dynamically on every simulation frame.
 * 
 * COORDINATE SYSTEM CONVENTIONS (Three.js / RobotRisk World):
 * - Ground Plane: (X, Z) in meters.
 * - Robot Yaw: 0 radians corresponds to facing +Z. +PI/2 radians corresponds to facing +X.
 * - Robot Velocity Vector: v_R = (v * sin(yaw), v * cos(yaw)).
 * 
 * RAPPIER COLLIDER GEOMETRY:
 * - Robot Physical Radius: R_robot = 0.34m (matches CylinderCollider args=[0.12, 0.34]).
 * - Obstacle Physical Radius: R_obs = (size || 0.6) * 0.65 for dynamic objects.
 * - Physical Clearance: d_physical = ||p_R - p_O|| - (R_robot + R_obs).
 * - Safety Clearance: Physical clearance minus configurable safety buffer.
 */

import { InteractiveObject, AisleBarrier, RobotPose } from '../types/simulation';
import { GridMap } from './GridMap';

export interface Vector2D {
  x: number;
  z: number;
}

export interface TTCResult {
  /** Earliest positive collision time in seconds, or null if no collision course */
  ttc: number | null;
  /** Whether the trajectories will intersect within combined safety boundary */
  isCollisionCourse: boolean;
  /** Distance between physical boundaries at closest point of approach (meters) */
  closestApproachDistance: number;
  /** Time until closest point of approach occurs (seconds) */
  timeToClosestApproach: number;
  /** Closing speed along line of sight (>0 closing, <0 diverging, m/s) */
  closingSpeed: number;
}

export interface NearMissConfig {
  /** Clearance threshold (meters) below which a near-miss is considered (default: 0.45m) */
  clearanceThreshold: number;
  /** Robot speed threshold (m/s) above which near-miss detection is active (default: 0.50m/s) */
  speedThreshold: number;
  /** Clearance threshold (meters) required to exit and re-arm an encounter (default: 0.80m) */
  exitClearanceThreshold: number;
  /** Minimum time (seconds) before the same obstacle can re-trigger a near miss (default: 2.0s) */
  cooldownSeconds: number;
}

export const DEFAULT_NEAR_MISS_CONFIG: NearMissConfig = {
  clearanceThreshold: 0.45,
  speedThreshold: 0.5,
  exitClearanceThreshold: 0.8,
  cooldownSeconds: 2.0,
};

export interface SafetyTtcConfig {
  /**
   * Critical TTC threshold (seconds).
   * Derived from AMR maximum speed (3.5 m/s) and deceleration (6.0 m/s^2),
   * plus reaction/actuation latency (~0.15s) and deliberative margin (~0.8s).
   * NOTE: Engineered simulation threshold, not an official ISO/ANSI certified standard.
   */
  criticalTtcThreshold: number; // default: 1.5s
  /**
   * Warning TTC threshold (seconds).
   * Impending collision risk providing sufficient horizon for smooth avoidance.
   */
  warningTtcThreshold: number;  // default: 3.5s
  /**
   * Critical boundary clearance (meters).
   * Active even if robot or obstacle is stationary (zero velocity).
   */
  criticalClearance: number;    // default: 0.45m
  /**
   * Warning boundary clearance (meters).
   */
  warningClearance: number;     // default: 1.20m
}

export const DEFAULT_SAFETY_TTC_CONFIG: SafetyTtcConfig = {
  criticalTtcThreshold: 1.5,
  warningTtcThreshold: 3.5,
  criticalClearance: 0.45,
  warningClearance: 1.2,
};

/**
 * Computes the dynamic Time-to-Collision (TTC) between two circular bodies
 * moving with constant 2D velocities.
 * 
 * Solves: ||(p_R - p_O) + (v_R - v_O) * t|| = (r_R + r_O)
 * Equivalent quadratic: A*t^2 + B*t + C = 0
 * 
 * @param robotPos 2D position (X, Z) of robot center
 * @param robotVel 2D velocity (Vx, Vz) of robot
 * @param robotRadius Physical collision radius of robot (default: 0.34m)
 * @param obstaclePos 2D position (X, Z) of obstacle center
 * @param obstacleVel 2D velocity (Vx, Vz) of obstacle
 * @param obstacleRadius Physical collision radius of obstacle
 */
export function computeCircleTTC(
  robotPos: Vector2D,
  robotVel: Vector2D,
  robotRadius: number,
  obstaclePos: Vector2D,
  obstacleVel: Vector2D,
  obstacleRadius: number
): TTCResult {
  // 1. Numerical Sanity Check
  if (
    !Number.isFinite(robotPos.x) || !Number.isFinite(robotPos.z) ||
    !Number.isFinite(robotVel.x) || !Number.isFinite(robotVel.z) ||
    !Number.isFinite(obstaclePos.x) || !Number.isFinite(obstaclePos.z) ||
    !Number.isFinite(obstacleVel.x) || !Number.isFinite(obstacleVel.z) ||
    !Number.isFinite(robotRadius) || !Number.isFinite(obstacleRadius) ||
    robotRadius <= 0 || obstacleRadius <= 0
  ) {
    return {
      ttc: null,
      isCollisionCourse: false,
      closestApproachDistance: Infinity,
      timeToClosestApproach: 0,
      closingSpeed: 0,
    };
  }

  // 2. Relative vectors: Robot relative to Obstacle
  const rx = robotPos.x - obstaclePos.x;
  const rz = robotPos.z - obstaclePos.z;
  const currentCenterDist = Math.hypot(rx, rz);
  const combinedRadius = robotRadius + obstacleRadius;

  // 3. Already Overlapping or In Contact
  if (currentCenterDist <= combinedRadius) {
    const closingSpeed = currentCenterDist > 0.001
      ? -((rx * (robotVel.x - obstacleVel.x) + rz * (robotVel.z - obstacleVel.z)) / currentCenterDist)
      : 0;

    return {
      ttc: 0.0,
      isCollisionCourse: true,
      closestApproachDistance: 0.0,
      timeToClosestApproach: 0.0,
      closingSpeed,
    };
  }

  // 4. Relative velocity of Robot relative to Obstacle
  const vx = robotVel.x - obstacleVel.x;
  const vz = robotVel.z - obstacleVel.z;
  const relSpeedSq = vx * vx + vz * vz;

  // 5. Zero Relative Velocity (e.g. parallel movement at same speed or both stationary)
  if (relSpeedSq < 1e-8) {
    return {
      ttc: null,
      isCollisionCourse: false,
      closestApproachDistance: Math.max(0, currentCenterDist - combinedRadius),
      timeToClosestApproach: 0.0,
      closingSpeed: 0.0,
    };
  }

  // 6. Quadratic Coefficients: A*t^2 + B*t + C = 0
  // ||r + v*t||^2 = R^2  =>  (v.v)*t^2 + 2*(r.v)*t + (r.r - R^2) = 0
  const A = relSpeedSq;
  const B = 2 * (rx * vx + rz * vz);
  const C = (rx * rx + rz * rz) - combinedRadius * combinedRadius;

  // Closing speed along line-of-sight vector
  const closingSpeed = -(rx * vx + rz * vz) / currentCenterDist;

  // Closest Point of Approach (Vertex of parabola: t_cpa = -B / (2A))
  const tCpa = Math.max(0, -B / (2 * A));
  const cpaPosSq = (rx + vx * tCpa) ** 2 + (rz + vz * tCpa) ** 2;
  const cpaDistBoundary = Math.max(0, Math.sqrt(Math.max(0, cpaPosSq)) - combinedRadius);

  // 7. Check if diverging (moving away from each other)
  // If B >= 0, the distance is currently increasing; collision cannot occur in the future
  if (B >= 0) {
    return {
      ttc: null,
      isCollisionCourse: false,
      closestApproachDistance: Math.max(0, currentCenterDist - combinedRadius),
      timeToClosestApproach: 0.0,
      closingSpeed,
    };
  }

  // 8. Discriminant
  const discriminant = B * B - 4 * A * C;

  if (discriminant < 0) {
    // Closest approach misses combined safety radius
    return {
      ttc: null,
      isCollisionCourse: false,
      closestApproachDistance: cpaDistBoundary,
      timeToClosestApproach: tCpa,
      closingSpeed,
    };
  }

  // 9. Earliest positive collision time
  const sqrtDisc = Math.sqrt(discriminant);
  const t1 = (-B - sqrtDisc) / (2 * A);

  if (t1 > 0 && Number.isFinite(t1)) {
    return {
      ttc: t1,
      isCollisionCourse: true,
      closestApproachDistance: 0.0,
      timeToClosestApproach: t1,
      closingSpeed,
    };
  }

  return {
    ttc: null,
    isCollisionCourse: false,
    closestApproachDistance: cpaDistBoundary,
    timeToClosestApproach: tCpa,
    closingSpeed,
  };
}

/**
 * Encounter tracker tracking near-miss incidents with hysteresis deduplication.
 */
interface ActiveEncounter {
  obstacleId: string;
  firstDetectedTime: number;
  lastSeenTime: number;
  minClearanceRecorded: number;
  hasTriggeredIncident: boolean;
}

export class NearMissDetector {
  private encounters: Map<string, ActiveEncounter> = new Map();
  private config: NearMissConfig;
  private totalNearMisses: number = 0;

  constructor(config: Partial<NearMissConfig> = {}) {
    this.config = { ...DEFAULT_NEAR_MISS_CONFIG, ...config };
  }

  public reset(): void {
    this.encounters.clear();
    this.totalNearMisses = 0;
  }

  public getTotalNearMisses(): number {
    return this.totalNearMisses;
  }

  /**
   * Evaluates an obstacle proximity reading. Returns true if a NEW near-miss incident
   * is registered on this frame.
   * 
   * @param obstacleId Unique identifier of the obstacle
   * @param physicalClearance Clearance in meters to physical obstacle boundary
   * @param robotSpeed Current robot speed in m/s
   * @param currentTime Current simulation time in seconds
   */
  public evaluate(
    obstacleId: string,
    physicalClearance: number,
    robotSpeed: number,
    currentTime: number
  ): boolean {
    const { clearanceThreshold, speedThreshold, exitClearanceThreshold, cooldownSeconds } = this.config;

    let encounter = this.encounters.get(obstacleId);

    // If clearance opens back up beyond exit threshold, clear the active encounter so it can rearm
    if (physicalClearance >= exitClearanceThreshold) {
      if (encounter) {
        this.encounters.delete(obstacleId);
      }
      return false;
    }

    // Check if near-miss conditions are met
    const meetsCriteria = physicalClearance < clearanceThreshold && robotSpeed >= speedThreshold;

    if (!meetsCriteria) {
      // Still in vicinity but not meeting criteria (e.g. speed dropped below threshold)
      if (encounter) {
        encounter.lastSeenTime = currentTime;
      }
      return false;
    }

    // Encounter meets criteria!
    if (!encounter) {
      // Brand new encounter -> trigger incident!
      encounter = {
        obstacleId,
        firstDetectedTime: currentTime,
        lastSeenTime: currentTime,
        minClearanceRecorded: physicalClearance,
        hasTriggeredIncident: true,
      };
      this.encounters.set(obstacleId, encounter);
      this.totalNearMisses++;
      return true;
    }

    // Already in active encounter
    encounter.lastSeenTime = currentTime;
    encounter.minClearanceRecorded = Math.min(encounter.minClearanceRecorded, physicalClearance);

    // If already triggered, DO NOT trigger again while staying in proximity
    if (encounter.hasTriggeredIncident) {
      // If encounter has exceeded cooldown and clearance was previously rearmed:
      if (currentTime - encounter.firstDetectedTime > cooldownSeconds) {
        // Cooldown refresh
        encounter.firstDetectedTime = currentTime;
      }
      return false;
    }

    // Trigger incident if not yet triggered
    encounter.hasTriggeredIncident = true;
    this.totalNearMisses++;
    return true;
  }
}

/**
 * Tracks previous obstacle positions across simulation frames to derive velocities.
 */
export class ObstacleVelocityTracker {
  private prevPositions: Map<string, { x: number; z: number; time: number }> = new Map();

  public getVelocity(
    id: string,
    currentPos: Vector2D,
    currentTime: number,
    obj?: InteractiveObject
  ): Vector2D {
    // 1. If actor (worker or forklift) has explicit tracked velocity or patrol configuration, use exact kinematic velocity
    if (obj?.velocity && (Math.abs(obj.velocity[0]) > 0.001 || Math.abs(obj.velocity[2]) > 0.001)) {
      return { x: obj.velocity[0], z: obj.velocity[2] };
    }

    if (obj && (obj.type === 'worker' || obj.type === 'forklift') && obj.patrolStart && obj.patrolEnd) {
      const [sx, sz] = obj.patrolStart;
      const [ex, ez] = obj.patrolEnd;
      const dx = ex - sx;
      const dz = ez - sz;
      const len = Math.hypot(dx, dz);
      if (len > 0.05) {
        const defaultSpeed = obj.type === 'forklift' ? 1.4 : 1.1;
        const speed = obj.patrolSpeed || defaultSpeed;
        const dir = obj.patrolDirection || 1;
        return {
          x: (dx / len) * speed * dir,
          z: (dz / len) * speed * dir,
        };
      }
    }

    // 2. Otherwise derive velocity from consecutive frame positions
    const prev = this.prevPositions.get(id);
    this.prevPositions.set(id, { x: currentPos.x, z: currentPos.z, time: currentTime });

    if (!prev) {
      return { x: 0, z: 0 };
    }

    const dt = currentTime - prev.time;
    if (dt <= 0.001 || dt > 1.0) {
      return { x: 0, z: 0 };
    }

    const vx = (currentPos.x - prev.x) / dt;
    const vz = (currentPos.z - prev.z) / dt;

    // Filter numerical jitter
    if (Math.abs(vx) < 0.01 && Math.abs(vz) < 0.01) {
      return { x: 0, z: 0 };
    }

    return { x: vx, z: vz };
  }

  public clear(): void {
    this.prevPositions.clear();
  }
}

export interface SceneTTCAnalysis {
  minTtc: number | null;
  isCollisionCourse: boolean;
  highestRiskObstacle: string | null;
  highestRiskObstacleId: string | null;
  minClearance: number;
  safetyStatus: 'SAFE' | 'WARNING' | 'CRITICAL';
  closestApproachDistance: number;
  timeToClosestApproach: number;
  newNearMissDetected: boolean;
}

/**
 * Singleton trackers for runtime simulation session
 */
export const defaultNearMissDetector = new NearMissDetector();
export const defaultVelocityTracker = new ObstacleVelocityTracker();

/**
 * Evaluates the full scene against the robot to compute dynamic TTC, identify the
 * highest-risk threat, and detect near-miss encounters.
 */
export function evaluateSceneTTC(
  robotPose: RobotPose,
  dynamicObjects: InteractiveObject[] = [],
  activeBarriers: AisleBarrier[] = [],
  _gridMap?: GridMap,
  currentTime: number = 0,
  nearMissDetector: NearMissDetector = defaultNearMissDetector,
  velocityTracker: ObstacleVelocityTracker = defaultVelocityTracker,
  safetyConfig: SafetyTtcConfig = DEFAULT_SAFETY_TTC_CONFIG
): SceneTTCAnalysis {
  const robotRadius = 0.34; // Physical Rapier collider radius
  const rx = robotPose.position[0];
  const rz = robotPose.position[2];
  const yaw = robotPose.rotation;
  const speed = Math.max(0, robotPose.linearVelocity || 0);

  // Robot 2D Velocity Vector (+Z forward when yaw=0, +X forward when yaw=PI/2)
  const robotPos: Vector2D = { x: rx, z: rz };
  const robotVel: Vector2D = {
    x: speed * Math.sin(yaw),
    z: speed * Math.cos(yaw),
  };

  let minTtc: number | null = null;
  let isCollisionCourse = false;
  let highestRiskObstacle: string | null = null;
  let highestRiskObstacleId: string | null = null;
  let minClearance = 999.0;
  let minCpaDistance = 999.0;
  let timeToCpa = 0.0;
  let newNearMissDetected = false;

  // 1. Evaluate Dynamic Interactive Objects (Workers, Crates, Spheres)
  for (const obj of dynamicObjects) {
    const obsPos: Vector2D = { x: obj.position[0], z: obj.position[2] };
    const obsVel = velocityTracker.getVelocity(obj.id, obsPos, currentTime, obj);
    const obsRadius = (obj.size || 0.6) * 0.65;

    // Physical clearance right now
    const centerDist = Math.hypot(obsPos.x - rx, obsPos.z - rz);
    const clearance = Math.max(0, centerDist - (robotRadius + obsRadius));

    if (clearance < minClearance) {
      minClearance = clearance;
    }

    // Check near-miss incident
    const nearMissOccurred = nearMissDetector.evaluate(obj.id, clearance, speed, currentTime);
    if (nearMissOccurred) {
      newNearMissDetected = true;
    }

    // Dynamic TTC calculation
    const ttcRes = computeCircleTTC(robotPos, robotVel, robotRadius, obsPos, obsVel, obsRadius);

    if (ttcRes.isCollisionCourse && ttcRes.ttc !== null) {
      if (minTtc === null || ttcRes.ttc < minTtc) {
        minTtc = ttcRes.ttc;
        isCollisionCourse = true;
        highestRiskObstacle = obj.name || `Dynamic ${String(obj.type || 'obstacle').toUpperCase()}`;
        highestRiskObstacleId = obj.id;
        timeToCpa = ttcRes.timeToClosestApproach;
        minCpaDistance = 0.0;
      }
    } else if (!isCollisionCourse && ttcRes.closestApproachDistance < minCpaDistance) {
      minCpaDistance = ttcRes.closestApproachDistance;
      timeToCpa = ttcRes.timeToClosestApproach;
      if (minTtc === null && clearance < 3.5) {
        highestRiskObstacle = obj.name || `Dynamic ${String(obj.type || 'obstacle').toUpperCase()}`;
        highestRiskObstacleId = obj.id;
      }
    }
  }

  // 2. Evaluate Active Aisle Barriers (Static Obstacles)
  for (const barrier of activeBarriers) {
    const barPos: Vector2D = { x: barrier.position[0], z: barrier.position[2] };
    const barVel: Vector2D = { x: 0, z: 0 }; // Stationary
    // Circular approximation covering barrier width
    const barRadius = barrier.width / 2;

    const centerDist = Math.hypot(barPos.x - rx, barPos.z - rz);
    const clearance = Math.max(0, centerDist - (robotRadius + barRadius));

    if (clearance < minClearance) {
      minClearance = clearance;
    }

    const nearMissOccurred = nearMissDetector.evaluate(barrier.id, clearance, speed, currentTime);
    if (nearMissOccurred) {
      newNearMissDetected = true;
    }

    const ttcRes = computeCircleTTC(robotPos, robotVel, robotRadius, barPos, barVel, barRadius);

    if (ttcRes.isCollisionCourse && ttcRes.ttc !== null) {
      if (minTtc === null || ttcRes.ttc < minTtc) {
        minTtc = ttcRes.ttc;
        isCollisionCourse = true;
        highestRiskObstacle = `Barrier (${barrier.name || barrier.aisleId})`;
        highestRiskObstacleId = barrier.id;
        timeToCpa = ttcRes.timeToClosestApproach;
        minCpaDistance = 0.0;
      }
    } else if (!isCollisionCourse && ttcRes.closestApproachDistance < minCpaDistance) {
      minCpaDistance = ttcRes.closestApproachDistance;
      timeToCpa = ttcRes.timeToClosestApproach;
      if (minTtc === null && clearance < 3.5) {
        highestRiskObstacle = `Barrier (${barrier.name || barrier.aisleId})`;
        highestRiskObstacleId = barrier.id;
      }
    }
  }

  // 3. Fallback: If no dynamic threat, identify closest threat if clearance is close
  if (!highestRiskObstacle && minClearance < 4.0) {
    highestRiskObstacle = 'Warehouse Wall / Storage Rack';
  }

  // 4. Robust Safety Status Determination:
  // Evaluates BOTH TTC (predictive dynamic risk) AND physical clearance.
  // This guarantees that a zero-velocity robot parked close to an obstacle
  // still receives CRITICAL or WARNING status based on clearance!
  let safetyStatus: 'SAFE' | 'WARNING' | 'CRITICAL' = 'SAFE';

  if (minClearance <= safetyConfig.criticalClearance) {
    safetyStatus = 'CRITICAL';
  } else if (isCollisionCourse && minTtc !== null && minTtc <= safetyConfig.criticalTtcThreshold) {
    safetyStatus = 'CRITICAL';
  } else if (minClearance <= safetyConfig.warningClearance) {
    safetyStatus = 'WARNING';
  } else if (isCollisionCourse && minTtc !== null && minTtc <= safetyConfig.warningTtcThreshold) {
    safetyStatus = 'WARNING';
  } else if (!isCollisionCourse && minCpaDistance <= safetyConfig.criticalClearance && timeToCpa < 2.0 && speed > 0.4) {
    safetyStatus = 'WARNING';
  } else {
    safetyStatus = 'SAFE';
  }

  return {
    minTtc,
    isCollisionCourse,
    highestRiskObstacle,
    highestRiskObstacleId,
    minClearance: Number.isFinite(minClearance) ? minClearance : 999.0,
    safetyStatus,
    closestApproachDistance: Number.isFinite(minCpaDistance) ? minCpaDistance : 999.0,
    timeToClosestApproach: timeToCpa,
    newNearMissDetected,
  };
}
