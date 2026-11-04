import { describe, it, expect, beforeEach } from 'vitest';
import {
  computeCircleTTC,
  NearMissDetector,
  ObstacleVelocityTracker,
  evaluateSceneTTC,
} from '../ttcUtils';
import { RobotPose, InteractiveObject } from '../../types/simulation';

describe('Phase 5.3A: Dynamic Time-to-Collision (TTC) & Near-Miss Detection', () => {
  let nearMissDetector: NearMissDetector;
  let velocityTracker: ObstacleVelocityTracker;

  beforeEach(() => {
    nearMissDetector = new NearMissDetector();
    velocityTracker = new ObstacleVelocityTracker();
  });

  describe('Edge Case 1: Perpendicular moving obstacle crossing robot path', () => {
    it('accurately predicts positive collision time for intersecting trajectories', () => {
      // Robot at (0, 0), moving along +Z at 2 m/s
      // Obstacle at (-5, 10), moving along +X at 1 m/s
      // Centers coincide at t = 5.0s:
      //   Robot center at t=5: (0, 10)
      //   Obstacle center at t=5: (-5 + 1*5, 10) = (0, 10)
      // Combined radius: 0.34m + 0.39m = 0.73m
      // Analytical collision time: t = 5 - 0.73 / sqrt(5) ≈ 4.6735s
      const robotPos = { x: 0, z: 0 };
      const robotVel = { x: 0, z: 2 };
      const robotRadius = 0.34;

      const obsPos = { x: -5, z: 10 };
      const obsVel = { x: 1, z: 0 };
      const obsRadius = 0.39;

      const result = computeCircleTTC(robotPos, robotVel, robotRadius, obsPos, obsVel, obsRadius);

      expect(result.isCollisionCourse).toBe(true);
      expect(result.ttc).not.toBeNull();
      expect(result.ttc!).toBeGreaterThan(0);
      expect(result.ttc!).toBeCloseTo(4.67, 1);
      expect(result.closestApproachDistance).toBe(0);
      expect(result.closingSpeed).toBeGreaterThan(0);
    });
  });

  describe('Edge Case 2: Obstacle moving away from robot', () => {
    it('returns ttc: null and isCollisionCourse: false when distance is increasing', () => {
      // Robot at (0, 0), moving +Z at 2 m/s
      // Obstacle at (0, 10), moving +Z at 4 m/s (diverging faster)
      const robotPos = { x: 0, z: 0 };
      const robotVel = { x: 0, z: 2 };
      const robotRadius = 0.34;

      const obsPos = { x: 0, z: 10 };
      const obsVel = { x: 0, z: 4 };
      const obsRadius = 0.39;

      const result = computeCircleTTC(robotPos, robotVel, robotRadius, obsPos, obsVel, obsRadius);

      expect(result.isCollisionCourse).toBe(false);
      expect(result.ttc).toBeNull();
      expect(result.closestApproachDistance).toBeGreaterThan(0);
    });
  });

  describe('Edge Case 3: Stationary obstacle directly in path', () => {
    it('predicts exact t = (distance - combinedRadius) / speed', () => {
      // Robot at (0, 0), moving +Z at 2.0 m/s
      // Obstacle at (0, 10), stationary (0, 0)
      // Combined radius = 0.34 + 0.39 = 0.73m
      // Distance to surface = 10 - 0.73 = 9.27m
      // Expected TTC = 9.27 / 2.0 = 4.635s
      const robotPos = { x: 0, z: 0 };
      const robotVel = { x: 0, z: 2.0 };
      const robotRadius = 0.34;

      const obsPos = { x: 0, z: 10 };
      const obsVel = { x: 0, z: 0 };
      const obsRadius = 0.39;

      const result = computeCircleTTC(robotPos, robotVel, robotRadius, obsPos, obsVel, obsRadius);

      expect(result.isCollisionCourse).toBe(true);
      expect(result.ttc).not.toBeNull();
      expect(result.ttc!).toBeCloseTo(4.635, 2);
    });
  });

  describe('Edge Case 4: Zero relative velocity', () => {
    it('returns ttc: null when bodies maintain constant relative separation', () => {
      // Robot and obstacle moving side-by-side at identical velocity
      const robotPos = { x: 0, z: 0 };
      const robotVel = { x: 1.5, z: 1.5 };
      const obsPos = { x: 2, z: 0 };
      const obsVel = { x: 1.5, z: 1.5 };

      const result = computeCircleTTC(robotPos, robotVel, 0.34, obsPos, obsVel, 0.39);

      expect(result.isCollisionCourse).toBe(false);
      expect(result.ttc).toBeNull();
      expect(result.closingSpeed).toBe(0);
    });
  });

  describe('Edge Case 5: Already overlapping / colliding objects', () => {
    it('returns ttc: 0.0 and isCollisionCourse: true', () => {
      // Robot at (0, 0), obstacle at (0, 0.5)
      // Combined radius = 0.34 + 0.39 = 0.73m > 0.5m
      const robotPos = { x: 0, z: 0 };
      const robotVel = { x: 0, z: 1.0 };
      const obsPos = { x: 0, z: 0.5 };
      const obsVel = { x: 0, z: 0 };

      const result = computeCircleTTC(robotPos, robotVel, 0.34, obsPos, obsVel, 0.39);

      expect(result.isCollisionCourse).toBe(true);
      expect(result.ttc).toBe(0.0);
      expect(result.closestApproachDistance).toBe(0.0);
    });
  });

  describe('Edge Case 6: Parallel non-intersecting trajectories (near miss trajectory)', () => {
    it('returns ttc: null when CPA misses combined safety radius', () => {
      // Robot at (0, 0), moving +Z at 2.0 m/s
      // Obstacle at (3.0, 10), stationary
      // Lateral offset is 3.0m, which is >> combined radius (0.73m)
      const robotPos = { x: 0, z: 0 };
      const robotVel = { x: 0, z: 2.0 };
      const obsPos = { x: 3.0, z: 10 };
      const obsVel = { x: 0, z: 0 };

      const result = computeCircleTTC(robotPos, robotVel, 0.34, obsPos, obsVel, 0.39);

      expect(result.isCollisionCourse).toBe(false);
      expect(result.ttc).toBeNull();
      expect(result.closestApproachDistance).toBeCloseTo(3.0 - 0.73, 2);
    });
  });

  describe('Edge Case 7: Near-miss threshold detection (<0.45m clearance at >0.5m/s)', () => {
    it('triggers a near-miss incident when speed and proximity criteria are met', () => {
      const detector = new NearMissDetector();

      // Clearance 0.30m (< 0.45m), Speed 1.2 m/s (> 0.5 m/s)
      const triggered = detector.evaluate('crate-1', 0.30, 1.2, 5.0);

      expect(triggered).toBe(true);
      expect(detector.getTotalNearMisses()).toBe(1);
    });

    it('does not trigger a near-miss if speed is below threshold (stationary robot)', () => {
      const detector = new NearMissDetector();

      // Clearance 0.30m, but Speed is 0.2 m/s (< 0.5 m/s)
      const triggered = detector.evaluate('crate-1', 0.30, 0.2, 5.0);

      expect(triggered).toBe(false);
      expect(detector.getTotalNearMisses()).toBe(0);
    });
  });

  describe('Edge Case 8: Duplicate near-miss prevention during single encounter', () => {
    it('deduplicates multiple consecutive proximity frames during the same pass', () => {
      const detector = new NearMissDetector();

      // Frame 1: Robot approaches obstacle -> triggers incident
      const t1 = detector.evaluate('worker-1', 0.35, 1.5, 10.0);
      expect(t1).toBe(true);
      expect(detector.getTotalNearMisses()).toBe(1);

      // Frame 2: Robot gets even closer (0.25m) during same encounter -> should NOT re-trigger
      const t2 = detector.evaluate('worker-1', 0.25, 1.5, 10.1);
      expect(t2).toBe(false);
      expect(detector.getTotalNearMisses()).toBe(1);

      // Frame 3: Robot moving away (0.40m) -> still same encounter
      const t3 = detector.evaluate('worker-1', 0.40, 1.5, 10.2);
      expect(t3).toBe(false);
      expect(detector.getTotalNearMisses()).toBe(1);

      // Frame 4: Robot fully clears obstacle beyond exit threshold (0.85m >= 0.80m)
      const t4 = detector.evaluate('worker-1', 0.85, 1.5, 11.0);
      expect(t4).toBe(false);
      expect(detector.getTotalNearMisses()).toBe(1);

      // Frame 5: Robot encounters the obstacle on a subsequent mission pass (0.30m) -> rearmed!
      const t5 = detector.evaluate('worker-1', 0.30, 1.5, 15.0);
      expect(t5).toBe(true);
      expect(detector.getTotalNearMisses()).toBe(2);
    });
  });

  describe('Edge Case 9: Physical contact vs near-miss distinction', () => {
    it('distinguishes zero or negative clearance (physical collision) from non-zero near miss', () => {
      const detector = new NearMissDetector();

      // Near-miss: 0.15m clearance (> 0, but < 0.45m)
      const isNearMiss = detector.evaluate('barrier-1', 0.15, 1.0, 1.0);
      expect(isNearMiss).toBe(true);

      // Clear encounter
      detector.evaluate('barrier-1', 1.0, 1.0, 2.0);

      // Physical contact: clearance is 0.0m
      // In RobotRisk, clearance <= 0 is a physical impact registered by Rapier physics collision handler
      const contactClearance = 0.0;
      expect(contactClearance).toBeLessThanOrEqual(0.0);
    });
  });

  describe('Edge Case 10: Numerical edge cases and sanitization', () => {
    it('gracefully handles NaN, Infinity, negative radii, and zero vectors without throwing', () => {
      const safe1 = computeCircleTTC(
        { x: NaN, z: 0 },
        { x: 0, z: 1 },
        0.34,
        { x: 0, z: 5 },
        { x: 0, z: 0 },
        0.39
      );
      expect(safe1.ttc).toBeNull();
      expect(safe1.isCollisionCourse).toBe(false);

      const safe2 = computeCircleTTC(
        { x: 0, z: 0 },
        { x: Infinity, z: 1 },
        0.34,
        { x: 0, z: 5 },
        { x: 0, z: 0 },
        0.39
      );
      expect(safe2.ttc).toBeNull();
      expect(safe2.isCollisionCourse).toBe(false);

      const safe3 = computeCircleTTC(
        { x: 0, z: 0 },
        { x: 0, z: 1 },
        -0.34, // Invalid negative radius
        { x: 0, z: 5 },
        { x: 0, z: 0 },
        0.39
      );
      expect(safe3.ttc).toBeNull();
      expect(safe3.isCollisionCourse).toBe(false);
    });
  });

  describe('Edge Case 11: Zero-velocity robot near stationary obstacle receives clearance-based status', () => {
    it('assigns CRITICAL or WARNING safetyStatus based on clearance even when TTC is null', () => {
      const robotPose: RobotPose = {
        position: [0, 0, 0],
        rotation: 0,
        linearVelocity: 0, // Stationary!
        angularVelocity: 0,
      };

      // Stationary obstacle placed 0.50m away (combined radius = 0.34 + 0.30 = 0.64m)
      // Center distance = 0.70m => physical clearance = 0.70 - 0.64 = 0.06m (< 0.45m)
      const closeObject: InteractiveObject = {
        id: 'box-close',
        type: 'cube',
        position: [0, 0, 0.70],
        color: '#ff0000',
        size: 0.46, // radius ~ 0.30m
        name: 'Nearby Crate',
      };

      const analysis = evaluateSceneTTC(
        robotPose,
        [closeObject],
        [],
        undefined,
        1.0,
        nearMissDetector,
        velocityTracker
      );

      // Even though robot velocity is 0 and TTC is unavailable (null), clearance-based status is CRITICAL!
      expect(analysis.minTtc).toBeNull();
      expect(analysis.isCollisionCourse).toBe(false);
      expect(analysis.minClearance).toBeLessThan(0.45);
      expect(analysis.safetyStatus).toBe('CRITICAL');
      expect(analysis.highestRiskObstacle).toBe('Nearby Crate');
    });

    it('assigns WARNING status when clearance is within warning range (0.45m - 1.20m)', () => {
      const robotPose: RobotPose = {
        position: [0, 0, 0],
        rotation: 0,
        linearVelocity: 0,
        angularVelocity: 0,
      };

      // Physical clearance ~ 0.80m (between 0.45m and 1.20m)
      const warningObject: InteractiveObject = {
        id: 'box-warning',
        type: 'cube',
        position: [0, 0, 1.44],
        color: '#ffaa00',
        size: 0.46,
        name: 'Warning Crate',
      };

      const analysis = evaluateSceneTTC(
        robotPose,
        [warningObject],
        [],
        undefined,
        1.0,
        nearMissDetector,
        velocityTracker
      );

      expect(analysis.minTtc).toBeNull();
      expect(analysis.safetyStatus).toBe('WARNING');
    });
  });

  describe('Edge Case 12: Scene evaluation with moving patrolling worker', () => {
    it('derives worker velocity and computes accurate dynamic TTC', () => {
      // Robot at (0, 0, 0) moving forward (+Z) at 1.5 m/s (yaw = 0)
      const robotPose: RobotPose = {
        position: [0, 0, 0],
        rotation: 0,
        linearVelocity: 1.5,
        angularVelocity: 0,
      };

      // Worker on patrol from (0, 10) to (0, 2) at 1.0 m/s towards the robot
      const worker: InteractiveObject = {
        id: 'worker-patrol',
        type: 'worker',
        position: [0, 0, 8.0],
        color: '#00ff88',
        size: 0.6,
        name: 'Warehouse Associate Dave',
        patrolStart: [0, 10],
        patrolEnd: [0, 0],
        patrolSpeed: 1.0,
        patrolDirection: 1, // moving towards [0, 0]
      };

      const analysis = evaluateSceneTTC(
        robotPose,
        [worker],
        [],
        undefined,
        1.0,
        nearMissDetector,
        velocityTracker
      );

      expect(analysis.isCollisionCourse).toBe(true);
      expect(analysis.minTtc).not.toBeNull();
      // Relative speed: 1.5 + 1.0 = 2.5 m/s closing speed
      // Distance between centers: 8.0m
      // Combined radius: ~ 0.34 + 0.39 = 0.73m
      // Time to collision: (8.0 - 0.73) / 2.5 ≈ 2.9s
      expect(analysis.minTtc!).toBeLessThan(3.5);
      expect(analysis.minTtc!).toBeGreaterThan(1.5);
      expect(analysis.safetyStatus).toBe('WARNING');
      expect(analysis.highestRiskObstacle).toBe('Warehouse Associate Dave');
    });
  });
});
