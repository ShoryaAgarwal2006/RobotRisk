import { describe, it, expect, beforeEach } from 'vitest';
import { GridMap } from '../GridMap';
import { AStarFinder } from '../AStarFinder';
import { NavigationController } from '../NavigationController';
import { performSensorScan, SensorScanResult } from '../sensorUtils';
import { useSimulationStore } from '../../state/useSimulationStore';
import { InteractiveObject, AisleBarrier } from '../../types/simulation';

describe('Repair Suite: Obstacle Placement, Aisle Blocking & Anti-Loop Replanning', () => {
  let gridMap: GridMap;
  let aStarFinder: AStarFinder;
  let navController: NavigationController;

  beforeEach(() => {
    gridMap = new GridMap();
    aStarFinder = new AStarFinder(gridMap);
    navController = new NavigationController();
    useSimulationStore.getState().resetRobotPose();
    useSimulationStore.getState().clearInteractiveObjects();
    useSimulationStore.getState().clearAllBarriers();
  });

  describe('A. Normal Autonomous Navigation (Charging Station -> Bay 4)', () => {
    it('generates a clean, non-colliding route without any obstacles', () => {
      const start: [number, number] = [-14.5, -10.5];
      const goal: [number, number] = [14.0, 10.5];

      const path = aStarFinder.findPath(start, goal);
      expect(path).not.toBeNull();
      expect(path!.length).toBeGreaterThan(2);

      // Verify every waypoint is in walkable space
      path!.forEach(([wx, wz]) => {
        expect(gridMap.isWorldWalkable(wx, wz)).toBe(true);
      });
    });
  });

  describe('B. Interactive Box Placement in Path', () => {
    it('detects a placed box, identifies critical threat, and flags route as blocked', () => {
      const start: [number, number] = [-14.5, -10.5];
      const goal: [number, number] = [14.0, 10.5];
      const initialPath = aStarFinder.findPath(start, goal);
      expect(initialPath).not.toBeNull();

      // Place a dynamic box on an open path waypoint
      const targetWp = initialPath![1];
      const dynamicBox: InteractiveObject = {
        id: 'user-box-1',
        type: 'cube',
        position: [targetWp[0], 0.4, targetWp[1]],
        color: '#ffaa00',
        size: 0.8,
        name: 'User Cargo Box',
      };

      // Add to gridMap
      gridMap.addDynamicObstacle({
        id: dynamicBox.id,
        x: dynamicBox.position[0],
        z: dynamicBox.position[2],
        radius: dynamicBox.size * 0.65,
      });

      // Verify cell is now blocked
      expect(gridMap.isWorldWalkable(targetWp[0], targetWp[1])).toBe(false);

      // Verify path is flagged as blocked
      expect(aStarFinder.isPathBlocked(initialPath!)).toBe(true);

      // Position robot 1.5m in front of the box facing it (Heading +Z)
      const robotTestPos: [number, number, number] = [
        targetWp[0],
        0.22,
        targetWp[1] - 1.5,
      ];
      const scan = performSensorScan(robotTestPos, 0, gridMap, [dynamicBox]);

      expect(scan.rays.some((r) => r.hitType === 'dynamic')).toBe(true);
      expect(scan.closestObstacleName).toContain('User Cargo Box');
      expect(scan.forwardDist).toBeCloseTo(0.98, 1);
    });
  });

  describe('C. Interactive Sphere Placement & Coordinates Consistency', () => {
    it('places sphere at user coordinates and verifies consistent world mapping', () => {
      // Pick an open aisle coordinate: Center Aisle 2 [0.0, -3.0]
      const userCoords: [number, number] = [0.0, -3.0];

      // Coordinate should be walkable before placement
      expect(gridMap.isWorldWalkable(userCoords[0], userCoords[1])).toBe(true);

      const sphere: InteractiveObject = {
        id: 'test-sphere-99',
        type: 'sphere',
        position: [userCoords[0], 0.5, userCoords[1]],
        color: '#ff3366',
        size: 0.6,
        name: 'User Safety Sphere',
      };

      gridMap.addDynamicObstacle({
        id: sphere.id,
        x: sphere.position[0],
        z: sphere.position[2],
        radius: sphere.size * 0.65,
      });

      // Cell should now be marked unwalkable
      expect(gridMap.isWorldWalkable(userCoords[0], userCoords[1])).toBe(false);

      // Robot LiDAR pointed at the sphere from 2m away along +Z
      const robotPos: [number, number, number] = [userCoords[0], 0.22, userCoords[1] - 2.0];
      const scan = performSensorScan(robotPos, 0, gridMap, [sphere]);

      expect(scan.forwardDist).toBeCloseTo(1.61, 1);
      expect(scan.obstaclePosition).not.toBeNull();
      expect(scan.obstaclePosition![0]).toBeCloseTo(userCoords[0], 1);
      expect(scan.obstaclePosition![1]).toBeCloseTo(userCoords[1], 1);
      expect(scan.closestObstacleName).toContain('User Safety Sphere');
    });
  });

  describe('D. Entire Aisle Blocking & Genuine Alternative Route Selection', () => {
    it('forces the robot to choose a genuinely different route when an aisle is blocked', () => {
      const start: [number, number] = [-14.5, -10.5];
      const goal: [number, number] = [14.0, 10.5];

      const baselineRoute = aStarFinder.findPath(start, goal);
      expect(baselineRoute).not.toBeNull();

      // Block Center Crossing at [0.0, 0.0] spanning Aisle 2 (width: 2.8m, depth: 0.6m)
      const centerBarrier: AisleBarrier = {
        id: 'barrier-center',
        aisleId: 'aisle-2',
        name: 'Aisle 2 Center Crossing',
        position: [0.0, 0.75, 0.0],
        width: 2.8,
        depth: 0.6,
        height: 1.5,
        rotation: 0,
      };

      gridMap.addBarrier(centerBarrier);

      // Replan route
      const detourRoute = aStarFinder.findPath(start, goal);
      expect(detourRoute).not.toBeNull();

      // Verify that the new route differs from baseline route
      const differs = aStarFinder.pathsDiffer(baselineRoute, detourRoute);
      expect(differs).toBe(true);

      // Verify all waypoints of detour route are walkable
      detourRoute!.forEach(([wx, wz]) => {
        expect(gridMap.isWorldWalkable(wx, wz)).toBe(true);
      });
    });
  });

  describe('E. All Routes Blocked -> Safe Stop with Clear Explanation', () => {
    it('safely halts and returns null when all paths are impassable', () => {
      const start: [number, number] = [-14.5, -10.5];
      const goal: [number, number] = [14.0, 10.5];

      // Block the entrance directly in front of the goal at Bay 4
      gridMap.addBarrier({
        id: 'barrier-bay4-block',
        aisleId: 'bay-4-access',
        name: 'Bay 4 Perimeter Barrier',
        position: [14.0, 0.75, 10.5],
        width: 4.0,
        depth: 4.0,
        height: 1.5,
        rotation: 0,
      });

      const unreachablePath = aStarFinder.findPath(start, goal);
      expect(unreachablePath).toBeNull();
    });
  });

  describe('F. Obstacle Removal Restores Navigation', () => {
    it('restores route when blocking barrier is removed', () => {
      const start: [number, number] = [-14.5, -10.5];
      const goal: [number, number] = [14.0, 10.5];

      const barrier: AisleBarrier = {
        id: 'temp-barrier',
        aisleId: 'aisle-main-west',
        name: 'West Transit',
        position: [-14.5, 0.75, -5.0],
        width: 3.2,
        depth: 0.6,
        height: 1.5,
        rotation: 0,
      };

      gridMap.addBarrier(barrier);
      expect(gridMap.isWorldWalkable(-14.5, -5.0)).toBe(false);

      // Remove barrier
      gridMap.removeBarrier('temp-barrier');
      expect(gridMap.isWorldWalkable(-14.5, -5.0)).toBe(true);

      const path = aStarFinder.findPath(start, goal);
      expect(path).not.toBeNull();
    });
  });

  describe('G. Physical vs Inflated Grid Boundaries', () => {
    it('distinguishes real physical rack boundaries from navigation inflation buffer', () => {
      // Row A center X = -3.25, half depth 0.7 -> physical X bounds: [-3.95, -2.55]
      // North rack Z: [-7.75, -1.25]
      // Point physically inside rack:
      expect(gridMap.isPhysicalObstacle(-3.25, -4.5)).toBe(true);

      // Point physically in aisle outside rack (e.g. X = -4.3, Z = -4.5)
      // (This point is 35cm away from rack face, so inside inflation buffer, but physically empty floor)
      expect(gridMap.isPhysicalObstacle(-4.3, -4.5)).toBe(false);
      // But inflated navigation grid marks it as non-walkable for robot center
      expect(gridMap.isWorldWalkable(-4.3, -4.5)).toBe(false);
    });
  });

  describe('H. Anti-Loop Replanning & Cooldown', () => {
    it('does not trigger replan on every single frame when stopped in front of obstacle', () => {
      const path: Array<[number, number]> = [
        [0.0, 0.0],
        [0.0, 5.0],
      ];
      navController.setPath(path, [0.0, 5.0]);

      const criticalScan: SensorScanResult = {
        rays: [],
        forwardDist: 0.5,
        leftDist: 2.0,
        rightDist: 2.0,
        closestObstacleName: 'Imminent Barrier',
        riskLevel: 'critical',
        obstaclePosition: [0.0, 0.5],
      };

      // Frame 1: critical risk detected -> stops, blockedFrames = 1
      const cmd1 = navController.computeControl([0, 0.22, 0], 0, criticalScan, 3.0, 2.5, 1.0);
      expect(cmd1.navState).toBe('AVOIDING');
      expect(cmd1.needsReplan).toBe(false);

      // Simulate frames 2 through 6 (blockedFrames increments to 6, still <= 6)
      for (let f = 2; f <= 6; f++) {
        const cmd = navController.computeControl([0, 0.22, 0], 0, criticalScan, 3.0, 2.5, 1.0 + f * 0.016);
        expect(cmd.needsReplan).toBe(false);
      }

      // Frame 7: now blockedFrames = 7 (> 6), triggers replan
      const cmd7 = navController.computeControl([0, 0.22, 0], 0, criticalScan, 3.0, 2.5, 1.12);
      expect(cmd7.needsReplan).toBe(true);

      // Frame 8: immediate subsequent frame, cooldown prevents another replan
      const cmd8 = navController.computeControl([0, 0.22, 0], 0, criticalScan, 3.0, 2.5, 1.14);
      expect(cmd8.needsReplan).toBe(false);
    });
  });
});
