import { GridMap } from './GridMap';
import { InteractiveObject, AisleBarrier } from '../types/simulation';

export interface TrajectoryPoint {
  x: number;
  z: number;
  yaw: number;
}

export interface EvaluatedTrajectory {
  linearVelocity: number;
  angularVelocity: number;
  isFeasible: boolean;
  score: number;
  minClearance: number;
  points: TrajectoryPoint[];
  bypassDirection: 'left' | 'right' | 'straight' | 'none';
}

export interface LocalPlannerConfig {
  maxLinearSpeed: number;
  maxAngularSpeed: number;
  linearAcceleration: number;
  linearDeceleration: number;
  robotRadius: number;
  safetyMargin: number;
  lookaheadDistance: number;
  lookaheadSteps: number;
  maxAvoidanceAngle: number;
}

export const DEFAULT_LOCAL_PLANNER_CONFIG: LocalPlannerConfig = {
  maxLinearSpeed: 3.5,
  maxAngularSpeed: 2.8,
  linearAcceleration: 6.0,
  linearDeceleration: 6.0,
  robotRadius: 0.34,
  safetyMargin: 0.15,
  lookaheadDistance: 3.6, // 3.6m spatial lookahead horizon
  lookaheadSteps: 24,     // 24 discrete steps (0.15m per step)
  maxAvoidanceAngle: 1.05, // ~60 degrees max lateral bypass heading deflection
};

export class LocalTrajectoryPlanner {
  private config: LocalPlannerConfig;

  constructor(config: Partial<LocalPlannerConfig> = {}) {
    this.config = { ...DEFAULT_LOCAL_PLANNER_CONFIG, ...config };
  }

  /**
   * Evaluates dynamic window candidate trajectories to find the optimal collision-free local path.
   * Accounts for robot footprint, dynamic obstacles, moving workers, barriers, and warehouse racks.
   */
  findBestTrajectory(
    robotPos: [number, number, number],
    robotYaw: number,
    _currentLinearSpeed: number,
    activeWaypoint: [number, number],
    globalPath: Array<[number, number]>,
    gridMap: GridMap,
    dynamicObjects: InteractiveObject[] = [],
    activeBarriers: AisleBarrier[] = [],
    speedCap: number = 3.5,
    preferredDirection: 'left' | 'right' | 'straight' | 'none' = 'none'
  ): EvaluatedTrajectory {
    const rx = robotPos[0];
    const rz = robotPos[2];

    const maxV = Math.min(speedCap, this.config.maxLinearSpeed);
    const maxOmega = this.config.maxAngularSpeed;

    // Angular velocity samples spanning straight, mild arc, and sharp avoidance turns
    const omegaSamples: number[] = [
      0.0,
      0.40, -0.40,
      0.80, -0.80,
      1.30, -1.30,
      1.80, -1.80,
      2.30, -2.30,
      maxOmega, -maxOmega,
    ];

    // Velocity samples: Full cruise, moderate speed, cautious creep
    const vFactors = [1.0, 0.75, 0.50, 0.30, 0.18];

    let bestTrajectory: EvaluatedTrajectory = {
      linearVelocity: 0,
      angularVelocity: 0,
      isFeasible: false,
      score: -Infinity,
      minClearance: 0,
      points: [],
      bypassDirection: 'none',
    };

    // Evaluate each candidate velocity pair (v, omega)
    for (const vFactor of vFactors) {
      const vCand = maxV * vFactor;

      for (const omegaCand of omegaSamples) {
        let candidate = this.simulateAndScoreTrajectory(
          rx,
          rz,
          robotYaw,
          vCand,
          omegaCand,
          activeWaypoint,
          globalPath,
          gridMap,
          dynamicObjects,
          activeBarriers
        );

        // Directional hysteresis: reward persisting with previous bypass direction and penalize flipping
        if (candidate.isFeasible && preferredDirection !== 'none' && preferredDirection !== 'straight') {
          if (candidate.bypassDirection === preferredDirection) {
            candidate = { ...candidate, score: candidate.score + 1.8 };
          } else if (candidate.bypassDirection !== 'straight') {
            candidate = { ...candidate, score: candidate.score - 2.5 };
          }
        }

        if (candidate.isFeasible && candidate.score > bestTrajectory.score) {
          bestTrajectory = candidate;
        }
      }
    }

    return bestTrajectory;
  }

  private simulateAndScoreTrajectory(
    startX: number,
    startZ: number,
    startYaw: number,
    v: number,
    omega: number,
    activeWp: [number, number],
    globalPath: Array<[number, number]>,
    gridMap: GridMap,
    dynamicObjects: InteractiveObject[],
    activeBarriers: AisleBarrier[]
  ): EvaluatedTrajectory {
    const ds = this.config.lookaheadDistance / this.config.lookaheadSteps; // ~0.15m per step
    const dt = ds / Math.max(0.1, v);
    const points: TrajectoryPoint[] = [];

    let curX = startX;
    let curZ = startZ;
    let curYaw = startYaw;

    let minClearance = Infinity;
    let isCollisionFree = true;

    const rTotal = this.config.robotRadius + this.config.safetyMargin;

    // Forward simulate candidate trajectory: turn up to maxAvoidanceAngle then cruise along bypass vector
    for (let step = 1; step <= this.config.lookaheadSteps; step++) {
      const dYaw = omega * dt;
      let turnDiff = (curYaw + dYaw) - startYaw;
      turnDiff = Math.atan2(Math.sin(turnDiff), Math.cos(turnDiff));

      if (Math.abs(turnDiff) <= this.config.maxAvoidanceAngle) {
        curYaw += dYaw;
      }

      curX += Math.sin(curYaw) * ds;
      curZ += Math.cos(curYaw) * ds;

      points.push({ x: curX, z: curZ, yaw: curYaw });

      // 1. Check against Static Warehouse Boundaries & Physical Obstacles
      if (
        curX < gridMap.bounds.minX + 0.8 ||
        curX > gridMap.bounds.maxX - 0.8 ||
        curZ < gridMap.bounds.minZ + 0.8 ||
        curZ > gridMap.bounds.maxZ - 0.8 ||
        gridMap.isPhysicalObstacle(curX, curZ)
      ) {
        isCollisionFree = false;
        break;
      }

      // Check clearance to static physical obstacles (racks, backstops, walls)
      for (const box of gridMap.getPhysicalObstacles()) {
        const clampedX = Math.max(box.minX, Math.min(box.maxX, curX));
        const clampedZ = Math.max(box.minZ, Math.min(box.maxZ, curZ));
        const d = Math.hypot(curX - clampedX, curZ - clampedZ);
        if (d < rTotal) {
          isCollisionFree = false;
          break;
        }
        if (d < minClearance) minClearance = d;
      }
      if (!isCollisionFree) break;

      // 2. Check against Dynamic Objects (Boxes, Spheres, Moving Workers)
      for (const obj of dynamicObjects) {
        const d = Math.hypot(curX - obj.position[0], curZ - obj.position[2]);
        const objRadius = (obj.size || 0.6) * 0.65;
        const requiredD = rTotal + objRadius;

        if (d < requiredD) {
          isCollisionFree = false;
          break;
        }
        const freeD = d - objRadius;
        if (freeD < minClearance) minClearance = freeD;
      }
      if (!isCollisionFree) break;

      // 3. Check against Active Aisle Barriers
      for (const barrier of activeBarriers) {
        const dx = curX - barrier.position[0];
        const dz = curZ - barrier.position[2];
        const cos = Math.cos(-barrier.rotation);
        const sin = Math.sin(-barrier.rotation);
        const localX = cos * dx - sin * dz;
        const localZ = sin * dx + cos * dz;

        const halfW = barrier.width / 2 + rTotal;
        const halfD = barrier.depth / 2 + rTotal;

        if (Math.abs(localX) <= halfW && Math.abs(localZ) <= halfD) {
          isCollisionFree = false;
          break;
        }
        const distToBarrier = Math.max(
          0,
          Math.hypot(
            Math.max(0, Math.abs(localX) - barrier.width / 2),
            Math.max(0, Math.abs(localZ) - barrier.depth / 2)
          )
        );
        if (distToBarrier < minClearance) minClearance = distToBarrier;
      }
      if (!isCollisionFree) break;
    }

    if (!isCollisionFree || points.length === 0) {
      // console.log(`Not collision free for v=${v} omega=${omega} (collided at step ${points.length})`);
      return {
        linearVelocity: v,
        angularVelocity: omega,
        isFeasible: false,
        score: -Infinity,
        minClearance: 0,
        points,
        bypassDirection: 'none',
      };
    }

    // --- Dynamic Window Scoring Function ---
    const lastPt = points[points.length - 1];

    // 1. Goal Progress: Did this trajectory move closer to the waypoint?
    const startDistToWp = Math.hypot(activeWp[0] - startX, activeWp[1] - startZ);
    const endDistToWp = Math.hypot(activeWp[0] - lastPt.x, activeWp[1] - lastPt.z);
    const progress = (startDistToWp - endDistToWp) / this.config.lookaheadDistance;

    // 2. Heading Alignment with Goal Direction at end of trajectory
    const targetHeading = Math.atan2(activeWp[0] - lastPt.x, activeWp[1] - lastPt.z);
    let angleDiff = targetHeading - lastPt.yaw;
    angleDiff = Math.atan2(Math.sin(angleDiff), Math.cos(angleDiff));
    const headingScore = Math.cos(angleDiff);

    // 3. Obstacle Clearance Bonus (reward trajectories staying safely away from obstacles)
    const clearanceScore = Math.min(2.0, minClearance) / 2.0;

    // 4. Forward Velocity Reward (prefer maintaining momentum)
    const velocityScore = v / this.config.maxLinearSpeed;

    // 5. Path Adherence Penalty (penalize straying excessively from the global path)
    const pathDist = this.distanceToPath(lastPt.x, lastPt.z, globalPath);
    const pathPenalty = Math.min(1.0, pathDist / 3.0);

    // Trajectory must achieve forward progress towards the waypoint and face generally forward
    const isFeasible = progress > 0.05 && headingScore > 0;

    // Composite Weighted Objective Function
    const totalScore =
      progress * 3.0 +
      headingScore * 2.0 +
      clearanceScore * 3.5 +
      velocityScore * 1.5 -
      pathPenalty * 1.2;

    const bypassDir =
      Math.abs(omega) < 0.2
        ? 'straight'
        : omega > 0
        ? 'left'
        : 'right';

    return {
      linearVelocity: v,
      angularVelocity: omega,
      isFeasible,
      score: isFeasible ? totalScore : -Infinity,
      minClearance,
      points,
      bypassDirection: isFeasible ? bypassDir : 'none',
    };
  }

  private distanceToPath(x: number, z: number, path: Array<[number, number]>): number {
    if (path.length === 0) return 0;
    let minDist = Infinity;
    for (let i = 0; i < path.length; i++) {
      const d = Math.hypot(x - path[i][0], z - path[i][1]);
      if (d < minDist) minDist = d;
    }
    return minDist;
  }
}
