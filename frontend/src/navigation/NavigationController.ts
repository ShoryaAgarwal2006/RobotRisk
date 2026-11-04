import { SensorScanResult } from './sensorUtils';
import { GridMap } from './GridMap';
import { LocalTrajectoryPlanner, TrajectoryPoint } from './LocalTrajectoryPlanner';
import { InteractiveObject, AisleBarrier } from '../types/simulation';

export type NavState =
  | 'IDLE'
  | 'PLANNING'
  | 'MOVING'
  | 'AVOIDING'
  | 'STOPPED'
  | 'COMPLETED'
  | 'FAILED';

export interface NavCommand {
  targetLinearVel: number;
  targetAngularVel: number;
  navState: NavState;
  needsReplan: boolean;
  distanceToGoal: number;
  currentWaypointIndex: number;
  replanReason?: string;
  stoppingDistance: number;
  availableClearance: number;
  isEmergencyBraking: boolean;
  localTrajectoryPoints?: TrajectoryPoint[];
  bypassDirection?: 'left' | 'right' | 'straight' | 'none';
}

export class NavigationController {
  private path: Array<[number, number]> = [];
  private waypointIndex: number = 0;
  private goal: [number, number] | null = null;
  private arrivalRadius: number = 0.6; // Arrival distance in meters
  private blockedFrames: number = 0;
  private lastReplanTime: number = -999999;
  private replanCooldownMs: number = 800; // 800ms cooldown between autonomous replans
  private localPlanner: LocalTrajectoryPlanner = new LocalTrajectoryPlanner();
  private lastBypassDirection: 'left' | 'right' | 'straight' | 'none' = 'none';

  readonly robotRadius: number = 0.34;
  readonly safetyMarginBuffer: number = 0.35; // 35cm buffer beyond stopping distance

  setPath(path: Array<[number, number]>, goal: [number, number]) {
    this.path = path;
    this.waypointIndex = 0;
    this.goal = goal;
    this.blockedFrames = 0;
    this.lastBypassDirection = 'none';
  }

  clearPath() {
    this.path = [];
    this.waypointIndex = 0;
    this.goal = null;
    this.blockedFrames = 0;
    this.lastBypassDirection = 'none';
  }

  hasPath(): boolean {
    return this.path.length > 0;
  }

  getCurrentWaypoint(): [number, number] | null {
    if (this.waypointIndex < this.path.length) {
      return this.path[this.waypointIndex];
    }
    return null;
  }

  getWaypointIndex(): number {
    return this.waypointIndex;
  }

  getPath(): Array<[number, number]> {
    return this.path;
  }

  computeControl(
    robotPos: [number, number, number],
    robotYaw: number,
    sensorScan: SensorScanResult,
    maxLinearSpeed: number = 3.0,
    maxAngularSpeed: number = 2.5,
    currentTimeSeconds: number = 0,
    currentLinearSpeed: number = 0,
    linearDeceleration: number = 6.0,
    gridMap?: GridMap,
    dynamicObjects: InteractiveObject[] = [],
    activeBarriers: AisleBarrier[] = []
  ): NavCommand {
    if (!this.goal || this.path.length === 0) {
      return {
        targetLinearVel: 0,
        targetAngularVel: 0,
        navState: 'IDLE',
        needsReplan: false,
        distanceToGoal: 0,
        currentWaypointIndex: 0,
        stoppingDistance: 0,
        availableClearance: sensorScan.forwardDist,
        isEmergencyBraking: false,
        bypassDirection: 'none',
      };
    }

    const [rx, , rz] = robotPos;
    const distanceToGoal = Math.hypot(this.goal[0] - rx, this.goal[1] - rz);

    // 1. Goal Arrival Check
    if (distanceToGoal <= this.arrivalRadius) {
      return {
        targetLinearVel: 0,
        targetAngularVel: 0,
        navState: 'COMPLETED',
        needsReplan: false,
        distanceToGoal,
        currentWaypointIndex: this.path.length - 1,
        stoppingDistance: 0,
        availableClearance: sensorScan.forwardDist,
        isEmergencyBraking: false,
        bypassDirection: 'none',
      };
    }

    // 2. Advance to next waypoint when within threshold or if passed
    const currentWp = this.path[this.waypointIndex];
    const distToWp = Math.hypot(currentWp[0] - rx, currentWp[1] - rz);
    const isFinalWaypoint = this.waypointIndex === this.path.length - 1;
    const waypointThreshold = isFinalWaypoint ? this.arrivalRadius : 1.10;

    if (distToWp <= waypointThreshold && !isFinalWaypoint) {
      this.waypointIndex++;
    } else if (this.waypointIndex < this.path.length - 1) {
      // Segment progress projection check: has the AMR passed the current waypoint plane?
      const prevWp = this.waypointIndex > 0 ? this.path[this.waypointIndex - 1] : [rx, rz];
      const segX = currentWp[0] - prevWp[0];
      const segZ = currentWp[1] - prevWp[1];
      const segLenSq = segX * segX + segZ * segZ;
      if (segLenSq > 0.04) {
        const uX = rx - prevWp[0];
        const uZ = rz - prevWp[1];
        const proj = (uX * segX + uZ * segZ) / segLenSq;
        if (proj >= 0.95) {
          this.waypointIndex++;
        }
      }

      // Proximity to subsequent waypoint check
      if (this.waypointIndex < this.path.length - 1) {
        const nextWp = this.path[this.waypointIndex + 1];
        const distToNext = Math.hypot(nextWp[0] - rx, nextWp[1] - rz);
        if (distToNext < distToWp && distToWp < 2.0) {
          this.waypointIndex++;
        }
      }
    }

    const activeWp = this.path[this.waypointIndex];

    // Corner lookahead steering target:
    // When approaching an intermediate waypoint, blend heading target toward subsequent waypoint
    let steerTargetX = activeWp[0];
    let steerTargetZ = activeWp[1];
    if (this.waypointIndex < this.path.length - 1 && distToWp < 1.4) {
      const nextWp = this.path[this.waypointIndex + 1];
      const blend = Math.max(0.2, (distToWp - 0.4) / 1.0);
      steerTargetX = activeWp[0] * blend + nextWp[0] * (1 - blend);
      steerTargetZ = activeWp[1] * blend + nextWp[1] * (1 - blend);
    }

    // 3. PREDICTIVE STOPPING-DISTANCE SAFETY CHECK: d = v² / (2a)
    const vCurrent = Math.max(0, currentLinearSpeed);
    const decelRate = Math.max(1.0, linearDeceleration);

    // Theoretical stopping distance at current velocity
    const stoppingDist = (vCurrent * vCurrent) / (2 * decelRate);

    // Total required safe clearance including AMR radius & reaction buffer
    const requiredSafeClearance =
      stoppingDist + this.robotRadius + this.safetyMarginBuffer;

    const availableClearance = sensorScan.forwardDist;
    const nowMs = currentTimeSeconds * 1000;
    const cooldownElapsed = nowMs - this.lastReplanTime > this.replanCooldownMs;

    let speedLimit = maxLinearSpeed;

    // Check if available forward clearance is encroaching on required stopping distance
    const isClearanceCritical =
      availableClearance < stoppingDist + this.robotRadius + 0.12 ||
      sensorScan.forwardDist < 0.95;

    const isClearanceWarning =
      availableClearance < requiredSafeClearance ||
      sensorScan.forwardDist < 2.8;

    // Check if there is an actual dynamic obstacle or barrier in the forward corridor
    const hasDynamicObstacle =
      sensorScan.closestObstacleName?.includes('Dynamic') ||
      sensorScan.closestObstacleName?.includes('Barrier') ||
      dynamicObjects.some((obj) => {
        const dx = obj.position[0] - rx;
        const dz = obj.position[2] - rz;
        const localZ = dx * Math.sin(robotYaw) + dz * Math.cos(robotYaw);
        const localX = dx * Math.cos(robotYaw) - dz * Math.sin(robotYaw);
        const objR = (obj.size || 0.6) * 0.65;
        return localZ > 0 && localZ < 4.5 && Math.abs(localX) <= (this.robotRadius + objR + 0.35);
      }) ||
      activeBarriers.some((barrier) => {
        const dx = barrier.position[0] - rx;
        const dz = barrier.position[2] - rz;
        const localZ = dx * Math.sin(robotYaw) + dz * Math.cos(robotYaw);
        const localX = dx * Math.cos(robotYaw) - dz * Math.sin(robotYaw);
        return localZ > 0 && localZ < 4.5 && Math.abs(localX) <= (this.robotRadius + barrier.width / 2 + 0.35);
      });

    // Check if an obstacle we are currently bypassing is still alongside or ahead
    const isBypassingActiveObstacle = dynamicObjects.some((obj) => {
      const dx = obj.position[0] - rx;
      const dz = obj.position[2] - rz;
      const localZ = dx * Math.sin(robotYaw) + dz * Math.cos(robotYaw);
      const localX = dx * Math.cos(robotYaw) - dz * Math.sin(robotYaw);
      const objR = (obj.size || 0.6) * 0.65;
      return localZ > -0.8 && localZ < 3.5 && Math.abs(localX) <= (this.robotRadius + objR + 0.85);
    }) || activeBarriers.some((barrier) => {
      const dx = barrier.position[0] - rx;
      const dz = barrier.position[2] - rz;
      const localZ = dx * Math.sin(robotYaw) + dz * Math.cos(robotYaw);
      const localX = dx * Math.cos(robotYaw) - dz * Math.sin(robotYaw);
      return localZ > -0.8 && localZ < 3.5 && Math.abs(localX) <= (this.robotRadius + barrier.width / 2 + 0.85);
    });

    const isAvoidanceActive =
      hasDynamicObstacle ||
      (this.lastBypassDirection !== 'none' && this.lastBypassDirection !== 'straight' && isBypassingActiveObstacle);

    if (!isBypassingActiveObstacle && !hasDynamicObstacle) {
      this.lastBypassDirection = 'none';
    }

    // 4. LAYER B: DYNAMIC LOCAL TRAJECTORY PLANNER
    // When a dynamic obstacle or barrier is detected ahead, evaluate candidate avoidance curves
    if (gridMap && isAvoidanceActive && (isClearanceWarning || isClearanceCritical || this.lastBypassDirection !== 'none')) {
      const localTraj = this.localPlanner.findBestTrajectory(
        robotPos,
        robotYaw,
        currentLinearSpeed,
        [steerTargetX, steerTargetZ],
        this.path,
        gridMap,
        dynamicObjects,
        activeBarriers,
        speedLimit,
        this.lastBypassDirection
      );

      if (localTraj.isFeasible && localTraj.linearVelocity > 0.05) {
        // Feasible local avoidance trajectory selected!
        this.blockedFrames = Math.max(0, this.blockedFrames - 1);
        this.lastBypassDirection = localTraj.bypassDirection;

        return {
          targetLinearVel: localTraj.linearVelocity,
          targetAngularVel: localTraj.angularVelocity,
          navState: 'AVOIDING',
          needsReplan: false,
          distanceToGoal,
          currentWaypointIndex: this.waypointIndex,
          stoppingDistance: stoppingDist,
          availableClearance,
          isEmergencyBraking: false,
          localTrajectoryPoints: localTraj.points,
          bypassDirection: localTraj.bypassDirection,
        };
      }
    }

    // 5. IF NO FEASIBLE LOCAL BYPASS (e.g. corridor completely barricaded or obstacle unavoidable)
    if (hasDynamicObstacle && isClearanceCritical) {
      // DANGEROUSLY CLOSE TO DYNAMIC OBSTACLE: Stop forward motion and rotate in place toward path
      this.blockedFrames++;
      this.lastBypassDirection = 'none';

      // Pivot in place towards the active detour waypoint
      const dx = steerTargetX - rx;
      const dz = steerTargetZ - rz;
      const targetHeading = Math.atan2(dx, dz);
      let angleDiff = targetHeading - robotYaw;
      angleDiff = Math.atan2(Math.sin(angleDiff), Math.cos(angleDiff));
      const steerOmega = Math.max(-maxAngularSpeed, Math.min(maxAngularSpeed, angleDiff * 2.5));

      const needsReplan = this.blockedFrames > 6 && cooldownElapsed;
      if (needsReplan) {
        this.lastReplanTime = nowMs;
        this.blockedFrames = 0;
      }

      return {
        targetLinearVel: 0,
        targetAngularVel: steerOmega,
        navState: 'AVOIDING',
        needsReplan,
        distanceToGoal,
        currentWaypointIndex: this.waypointIndex,
        replanReason: sensorScan.closestObstacleName
          ? `Emergency brake: ${sensorScan.closestObstacleName} detected at ${availableClearance.toFixed(1)}m (stopping dist ${stoppingDist.toFixed(1)}m)`
          : `Emergency brake: Forward clearance ${availableClearance.toFixed(1)}m < stopping distance`,
        stoppingDistance: stoppingDist,
        availableClearance,
        isEmergencyBraking: true,
        bypassDirection: 'none',
      };
    } else if (hasDynamicObstacle && isClearanceWarning) {
      // CONTROLLED PREDICTIVE BRAKING BEFORE DYNAMIC OBSTACLE
      this.blockedFrames++;

      const freeDist = Math.max(0, availableClearance - this.robotRadius - 0.20);
      const safeSpeed = Math.sqrt(2 * decelRate * freeDist);
      const targetSpeed = Math.min(0.40, Math.max(0.12, safeSpeed));

      // Calculate steering towards waypoint so robot can turn or prepare detour
      const dx = steerTargetX - rx;
      const dz = steerTargetZ - rz;
      const targetHeading = Math.atan2(dx, dz);
      let angleDiff = targetHeading - robotYaw;
      angleDiff = Math.atan2(Math.sin(angleDiff), Math.cos(angleDiff));
      const steerOmega = Math.max(-maxAngularSpeed, Math.min(maxAngularSpeed, angleDiff * 2.5));

      const needsReplan = this.blockedFrames > 6 && cooldownElapsed;
      if (needsReplan) {
        this.lastReplanTime = nowMs;
        this.blockedFrames = 0;
      }

      return {
        targetLinearVel: targetSpeed,
        targetAngularVel: steerOmega,
        navState: 'AVOIDING',
        needsReplan,
        distanceToGoal,
        currentWaypointIndex: this.waypointIndex,
        replanReason: `Predictive brake: Detour around ${sensorScan.closestObstacleName || 'dynamic obstacle'} at ${availableClearance.toFixed(1)}m`,
        stoppingDistance: stoppingDist,
        availableClearance,
        isEmergencyBraking: false,
        bypassDirection: 'none',
      };
    } else {
      this.blockedFrames = Math.max(0, this.blockedFrames - 1);
      this.lastBypassDirection = 'none';
    }

    // IMMINENT COLLISION SAFETY GUARD (FOR ANY OBSTACLE):
    if (availableClearance < stoppingDist + this.robotRadius + 0.08 && vCurrent > 0.3) {
      return {
        targetLinearVel: 0,
        targetAngularVel: 0,
        navState: 'AVOIDING',
        needsReplan: false,
        distanceToGoal,
        currentWaypointIndex: this.waypointIndex,
        replanReason: `Safety brake: Obstacle at ${availableClearance.toFixed(1)}m`,
        stoppingDistance: stoppingDist,
        availableClearance,
        isEmergencyBraking: true,
        bypassDirection: 'none',
      };
    }

    // 6. Normal Differential Drive Steering & Waypoint Pursuit
    const dx = steerTargetX - rx;
    const dz = steerTargetZ - rz;
    const targetHeading = Math.atan2(dx, dz); // +Z forward, +X left

    // Shortest angular error: [-PI, PI]
    let angleDiff = targetHeading - robotYaw;
    angleDiff = Math.atan2(Math.sin(angleDiff), Math.cos(angleDiff));

    // Slow down when approaching the final destination
    if (distanceToGoal < 2.5) {
      const approachFactor = Math.max(0.3, distanceToGoal / 2.5);
      speedLimit = Math.min(speedLimit, maxLinearSpeed * approachFactor);
    }

    let targetLinearVel = 0;
    let targetAngularVel = 0;

    const absAngle = Math.abs(angleDiff);

    if (absAngle > 0.65) {
      // Large heading error (> 37°): Turn sharply with low forward creep to prevent wedging
      targetLinearVel = Math.min(0.20, speedLimit);
      targetAngularVel = Math.sign(angleDiff) * maxAngularSpeed;
    } else if (absAngle > 0.20) {
      // Medium heading error: Arc turn with modulated speed
      const steerFactor = Math.cos(angleDiff);
      targetLinearVel = speedLimit * Math.max(0.40, steerFactor);
      targetAngularVel = Math.sign(angleDiff) * (absAngle * 2.8);
      targetAngularVel = Math.max(-maxAngularSpeed, Math.min(maxAngularSpeed, targetAngularVel));
    } else {
      // Small heading error (< 11°): Cruising speed with proportional steering correction
      targetLinearVel = speedLimit;
      targetAngularVel = angleDiff * 2.5;
    }

    return {
      targetLinearVel,
      targetAngularVel,
      navState: 'MOVING',
      needsReplan: false,
      distanceToGoal,
      currentWaypointIndex: this.waypointIndex,
      stoppingDistance: stoppingDist,
      availableClearance,
      isEmergencyBraking: false,
      bypassDirection: 'straight',
    };
  }
}
