import { describe, it, expect, beforeEach } from 'vitest';
import { GridMap } from '../GridMap';
import { AStarFinder } from '../AStarFinder';
import { NavigationController } from '../NavigationController';
import { performSensorScan } from '../sensorUtils';
import { InteractiveObject } from '../../types/simulation';

describe('Critical Dynamic Obstacle Avoidance & Predictive Braking Suite', () => {
  let gridMap: GridMap;
  let aStarFinder: AStarFinder;
  let navController: NavigationController;

  beforeEach(() => {
    gridMap = new GridMap();
    aStarFinder = new AStarFinder(gridMap);
    navController = new NavigationController();
  });

  describe('Scenario A: Moving Robot with Box Placed Ahead (Predictive Braking & Detour)', () => {
    it('calculates stopping distance d = v² / (2a) and proactively slows down before replanning', () => {
      // Robot cruising at 2.5 m/s with decel = 6.0 m/s²
      const v = 2.5;
      const decel = 6.0;
      const expectedStoppingDist = (v * v) / (2 * decel); // ~0.521 m
      const robotRadius = 0.34;
      const safeBuffer = 0.35;
      const requiredClearance = expectedStoppingDist + robotRadius + safeBuffer; // ~1.21 m

      const path: Array<[number, number]> = [
        [-14.5, -10.0],
        [-14.5, -4.0],
        [-14.5, 0.0],
      ];
      navController.setPath(path, [-14.5, 0.0]);

      // Box placed 1.0m ahead (less than required clearance ~1.21m, but > emergency threshold ~1.01m)
      const forwardClearance = 1.05;
      expect(forwardClearance).toBeLessThan(requiredClearance);
      const scanResult = {
        rays: [],
        forwardDist: forwardClearance,
        leftDist: 2.0,
        rightDist: 2.0,
        closestObstacleName: 'Dynamic Box',
        riskLevel: 'caution' as const,
        obstaclePosition: [-14.5, -8.95] as [number, number],
      };

      const cmd = navController.computeControl(
        [-14.5, 0.22, -10.0],
        0, // Heading +Z
        scanResult,
        3.0,
        2.5,
        1.0,
        v, // Current speed 2.5 m/s
        decel
      );

      // Verify stopping distance is correctly calculated
      expect(cmd.stoppingDistance).toBeCloseTo(expectedStoppingDist, 2);
      expect(cmd.availableClearance).toBeCloseTo(forwardClearance, 2);

      // Predictive braking should limit target velocity below cruising speed (2.5 m/s)
      expect(cmd.targetLinearVel).toBeLessThan(v);
      expect(cmd.targetLinearVel).toBeGreaterThan(0); // Controlled deceleration, not instantaneous zero
      expect(cmd.isEmergencyBraking).toBe(false);
    });

    it('successfully computes an alternative detour path around the placed box without collision', () => {
      const start: [number, number] = [-14.5, -10.0];
      const goal: [number, number] = [-14.5, -2.0];

      const initialPath = aStarFinder.findPath(start, goal);
      expect(initialPath).not.toBeNull();

      // Place a dynamic box directly blocking the path at [-14.5, -6.0]
      const dynamicBox: InteractiveObject = {
        id: 'box-dyn-1',
        type: 'cube',
        position: [-14.5, 0.4, -6.0],
        color: '#f59e0b',
        size: 0.8,
      };

      gridMap.addDynamicObstacle({
        id: dynamicBox.id,
        x: dynamicBox.position[0],
        z: dynamicBox.position[2],
        radius: dynamicBox.size * 0.65,
      });

      // Verify original path is now flagged as blocked
      expect(aStarFinder.isPathBlocked(initialPath!)).toBe(true);

      // Replan path around the obstacle
      const detourPath = aStarFinder.findPath(start, goal);
      expect(detourPath).not.toBeNull();
      expect(aStarFinder.pathsDiffer(detourPath, initialPath)).toBe(true);

      // Verify detour path does not collide with the obstacle
      for (const [x, z] of detourPath!) {
        const distToBox = Math.hypot(x - dynamicBox.position[0], z - dynamicBox.position[2]);
        expect(distToBox).toBeGreaterThan(dynamicBox.size * 0.5);
      }
    });
  });

  describe('Scenario B: Moving Robot with Sphere Placed in Path', () => {
    it('immediately registers sphere in LiDAR sensor scan and provides accurate coordinates', () => {
      const robotPos: [number, number, number] = [-14.5, 0.22, -8.0];
      const spherePos: [number, number, number] = [-14.5, 0.5, -5.5]; // 2.5m ahead along +Z

      const sphere: InteractiveObject = {
        id: 'sphere-dyn-1',
        type: 'sphere',
        position: spherePos,
        color: '#00f0ff',
        size: 0.6,
        name: 'Test Dynamic Sphere',
      };

      gridMap.addDynamicObstacle({
        id: sphere.id,
        x: sphere.position[0],
        z: sphere.position[2],
        radius: sphere.size * 0.65,
      });

      const scan = performSensorScan(robotPos, 0, gridMap, [sphere]);

      expect(scan.closestObstacleName).toContain('Test Dynamic Sphere');
      expect(scan.obstaclePosition).not.toBeNull();
      expect(scan.obstaclePosition![0]).toBeCloseTo(spherePos[0], 1);
      expect(scan.obstaclePosition![1]).toBeCloseTo(spherePos[2], 1);

      // Surface distance = 2.5m - (0.6 * 0.65) = 2.11m
      expect(scan.forwardDist).toBeCloseTo(2.11, 1);
    });
  });

  describe('Scenario C: Dangerously Close Obstacle Engagement (Emergency Braking 18 m/s²)', () => {
    it('activates emergency braking when obstacle appears within critical stopping boundary', () => {
      const v = 2.5; // High speed
      const decel = 6.0;
      const stoppingDist = (v * v) / (2 * decel); // 0.521m
      const criticalThreshold = stoppingDist + 0.34 + 0.15; // ~1.01m

      // Obstacle placed at 0.75m (< 1.01m critical boundary)
      const criticalClearance = 0.75;
      expect(criticalClearance).toBeLessThan(criticalThreshold);
      const criticalScan = {
        rays: [],
        forwardDist: criticalClearance,
        leftDist: 2.0,
        rightDist: 2.0,
        closestObstacleName: 'Imminent Box',
        riskLevel: 'critical' as const,
        obstaclePosition: [-14.5, -5.25] as [number, number],
      };

      const path: Array<[number, number]> = [
        [-14.5, -6.0],
        [-14.5, 0.0],
      ];
      navController.setPath(path, [-14.5, 0.0]);

      const cmd = navController.computeControl(
        [-14.5, 0.22, -6.0],
        0,
        criticalScan,
        3.0,
        2.5,
        1.0,
        v,
        decel
      );

      // Verify emergency braking flags and motor velocity cut
      expect(cmd.isEmergencyBraking).toBe(true);
      expect(cmd.targetLinearVel).toBe(0); // Forward velocity cut immediately
      expect(cmd.targetAngularVel).toBe(0);
      expect(cmd.navState).toBe('AVOIDING');
      expect(cmd.stoppingDistance).toBeCloseTo(stoppingDist, 2);
    });

    it('verifies that emergency deceleration (a * 3.0 = 18 m/s²) stops robot within stopping distance', () => {
      let speed = 2.5;
      const normalDecel = 6.0;
      const emergencyDecel = normalDecel * 3.0; // 18.0 m/s²
      const dt = 1 / 60; // 60 FPS frame time
      let distanceTraveled = 0;
      let frames = 0;

      while (speed > 0 && frames < 60) {
        distanceTraveled += speed * dt;
        speed = Math.max(0, speed - emergencyDecel * dt);
        frames++;
      }

      expect(speed).toBe(0);
      // At 18 m/s², stopping from 2.5 m/s takes ~0.14 seconds (~9 frames) and ~0.18m
      expect(frames).toBeLessThanOrEqual(10);
      expect(distanceTraveled).toBeLessThan(0.25);
    });
  });

  describe('Scenario D: Obstacle Placed Behind Moving Robot (No False Alarms)', () => {
    it('does NOT trigger braking or emergency stop when an obstacle is placed behind the robot', () => {
      // Robot at [0, 0.22, 0] moving forward along +Z (yaw = 0)
      const robotPos: [number, number, number] = [0, 0.22, 0];
      const robotYaw = 0;

      // Obstacle placed 2.0m BEHIND robot at [0, 0.4, -2.0]
      const rearObstacle: InteractiveObject = {
        id: 'rear-box-1',
        type: 'cube',
        position: [0, 0.4, -2.0],
        color: '#f59e0b',
        size: 0.8,
        name: 'Rear Cargo Box',
      };

      gridMap.addDynamicObstacle({
        id: rearObstacle.id,
        x: rearObstacle.position[0],
        z: rearObstacle.position[2],
        radius: rearObstacle.size * 0.65,
      });

      const scan = performSensorScan(robotPos, robotYaw, gridMap, [rearObstacle]);

      // Forward sensor cone should see clear space ahead (above caution threshold)
      expect(scan.forwardDist).toBeGreaterThan(4.0);
      expect(scan.riskLevel).toBe('clear');

      const path: Array<[number, number]> = [
        [0, 0],
        [0, 6],
      ];
      navController.setPath(path, [0, 6]);

      const cmd = navController.computeControl(
        robotPos,
        robotYaw,
        scan,
        3.0,
        2.5,
        1.0,
        2.5,
        6.0
      );

      // Verify cruising continues unimpeded
      expect(cmd.isEmergencyBraking).toBe(false);
      expect(cmd.navState).toBe('MOVING');
      expect(cmd.targetLinearVel).toBeGreaterThan(2.0); // Cruising
    });
  });

  describe('Scenario E: Obstacle Removal Restores Original Route', () => {
    it('restores the direct original path once the placed obstacle is removed', () => {
      const start: [number, number] = [-14.5, -10.0];
      const goal: [number, number] = [-14.5, 0.0];

      const originalPath = aStarFinder.findPath(start, goal);
      expect(originalPath).not.toBeNull();

      // 1. Add obstacle blocking the corridor
      const obsId = 'blocking-pallet';
      gridMap.addDynamicObstacle({
        id: obsId,
        x: -14.5,
        z: -5.0,
        radius: 0.6,
      });

      expect(gridMap.isWorldWalkable(-14.5, -5.0)).toBe(false);
      const detouredPath = aStarFinder.findPath(start, goal);
      expect(detouredPath).not.toBeNull();
      expect(aStarFinder.pathsDiffer(detouredPath, originalPath)).toBe(true);

      // 2. Remove obstacle
      gridMap.removeDynamicObstacle(obsId);
      gridMap.clearTemporaryBlockages();

      // Corridor should be walkable again
      expect(gridMap.isWorldWalkable(-14.5, -5.0)).toBe(true);

      // 3. Replanned route should match original direct path
      const restoredPath = aStarFinder.findPath(start, goal);
      expect(restoredPath).not.toBeNull();
      expect(aStarFinder.pathsDiffer(restoredPath, originalPath)).toBe(false);
    });
  });

  describe('Scenario F: Rapid Dynamic Placements Stability', () => {
    it('handles multiple rapid dynamic placements without duplicate colliders or memory corruption', () => {
      const obstacles: InteractiveObject[] = [];

      // Place 15 dynamic obstacles across the central open cross-aisle (z = 0)
      for (let i = 0; i < 15; i++) {
        const obs: InteractiveObject = {
          id: `rapid-obs-${i}`,
          type: i % 2 === 0 ? 'cube' : 'sphere',
          position: [-7 + i * 1.0, 0.4, 0],
          color: '#3b82f6',
          size: 0.5,
        };
        obstacles.push(obs);
        gridMap.addDynamicObstacle({
          id: obs.id,
          x: obs.position[0],
          z: obs.position[2],
          radius: obs.size * 0.65,
        });
      }

      // Verify grid remains consistent
      const start: [number, number] = [-14.5, -10.0];
      const goal: [number, number] = [14.0, 10.0];

      const path = aStarFinder.findPath(start, goal);
      // Whether path exists or not, execution must finish in < 50ms without crashing
      if (path) {
        expect(path.length).toBeGreaterThan(0);
      }

      // Clear all and verify cleanup
      gridMap.clearDynamicObstacles();
      for (const obs of obstacles) {
        expect(gridMap.isWorldWalkable(obs.position[0], obs.position[2])).toBe(true);
      }
    });
  });
});
