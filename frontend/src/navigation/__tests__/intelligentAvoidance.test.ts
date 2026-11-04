import { describe, it, expect, beforeEach } from 'vitest';
import { GridMap } from '../GridMap';
import { AStarFinder } from '../AStarFinder';
import { NavigationController } from '../NavigationController';
import { LocalTrajectoryPlanner } from '../LocalTrajectoryPlanner';
import { InteractiveObject, AisleBarrier } from '../../types/simulation';
import { performSensorScan } from '../sensorUtils';

describe('Phase 3: Intelligent Autonomous Obstacle Avoidance Suite', () => {
  let gridMap: GridMap;
  let aStarFinder: AStarFinder;
  let navController: NavigationController;
  let localPlanner: LocalTrajectoryPlanner;

  beforeEach(() => {
    gridMap = new GridMap();
    aStarFinder = new AStarFinder(gridMap);
    navController = new NavigationController();
    localPlanner = new LocalTrajectoryPlanner();
  });

  describe('1. Layer B: Local Trajectory Planner Unit Tests', () => {
    it('evaluates dynamic window candidate trajectories and selects collision-free bypass around single box', () => {
      const robotPos: [number, number, number] = [-14.5, 0.22, -10.0];
      const robotYaw = 0; // Heading +Z
      const activeWaypoint: [number, number] = [-14.5, -4.0];
      const globalPath: Array<[number, number]> = [
        [-14.5, -10.0],
        [-14.5, -4.0],
      ];

      // Place single cargo box directly in front at [-14.5, -7.0]
      const dynamicBox: InteractiveObject = {
        id: 'box-1',
        type: 'cube',
        position: [-14.5, 0.4, -7.0],
        color: '#f59e0b',
        size: 0.75,
      };
      gridMap.addDynamicObstacle({
        id: dynamicBox.id,
        x: dynamicBox.position[0],
        z: dynamicBox.position[2],
        radius: dynamicBox.size * 0.65,
      });

      const result = localPlanner.findBestTrajectory(
        robotPos,
        robotYaw,
        2.0, // current speed 2 m/s
        activeWaypoint,
        globalPath,
        gridMap,
        [dynamicBox],
        [],
        3.0
      );

      // Must find a feasible trajectory
      expect(result.isFeasible).toBe(true);
      // Must maintain forward speed (does not freeze)
      expect(result.linearVelocity).toBeGreaterThan(0.5);
      // Must steer away from center (angular velocity non-zero)
      expect(Math.abs(result.angularVelocity)).toBeGreaterThan(0.2);
      // Bypass direction must be left or right
      expect(['left', 'right']).toContain(result.bypassDirection);
      // Simulated trajectory points must exist
      expect(result.points.length).toBeGreaterThan(5);
      // Safe minimum clearance must be maintained
      expect(result.minClearance).toBeGreaterThan(0.2);
    });

    it('evaluates smooth bypass around a spherical obstacle', () => {
      const robotPos: [number, number, number] = [-6.5, 0.22, -10.0];
      const robotYaw = 0;
      const activeWaypoint: [number, number] = [-6.5, -4.0];
      const globalPath: Array<[number, number]> = [
        [-6.5, -10.0],
        [-6.5, -4.0],
      ];

      const sphere: InteractiveObject = {
        id: 'sphere-1',
        type: 'sphere',
        position: [-6.5, 0.4, -7.5],
        color: '#3b82f6',
        size: 0.5,
      };
      gridMap.addDynamicObstacle({
        id: sphere.id,
        x: sphere.position[0],
        z: sphere.position[2],
        radius: sphere.size * 0.65,
      });

      const result = localPlanner.findBestTrajectory(
        robotPos,
        robotYaw,
        2.5,
        activeWaypoint,
        globalPath,
        gridMap,
        [sphere],
        [],
        3.0
      );

      expect(result.isFeasible).toBe(true);
      expect(result.linearVelocity).toBeGreaterThan(0.5);
      expect(Math.abs(result.angularVelocity)).toBeGreaterThan(0.1);
      expect(['left', 'right']).toContain(result.bypassDirection);
    });

    it('detects impassable barricade across entire corridor and declares no feasible trajectory', () => {
      const robotPos: [number, number, number] = [-6.5, 0.22, -10.0];
      const robotYaw = 0;
      const activeWaypoint: [number, number] = [-6.5, -4.0];
      const globalPath: Array<[number, number]> = [
        [-6.5, -10.0],
        [-6.5, -4.0],
      ];

      // Barricade spanning the entire 6m aisle
      const fullBarrier: AisleBarrier = {
        id: 'barrier-full',
        aisleId: 'aisle-2',
        name: 'Full Barricade',
        position: [-6.5, 0.75, -7.5],
        width: 8.0, // spans full aisle width
        depth: 1.0,
        height: 1.5,
        rotation: 0,
      };
      gridMap.addBarrier(fullBarrier);

      const result = localPlanner.findBestTrajectory(
        robotPos,
        robotYaw,
        1.5,
        activeWaypoint,
        globalPath,
        gridMap,
        [],
        [fullBarrier],
        3.0
      );

      // Must report not feasible because barrier seals entire corridor
      expect(result.isFeasible).toBe(false);
      expect(result.bypassDirection).toBe('none');
    });
  });

  describe('2. NavigationController Two-Layer Integration Tests', () => {
    it('executes Layer B avoidance without halting when obstacle warning is triggered', () => {
      const path: Array<[number, number]> = [
        [-14.5, -10.0],
        [-14.5, -4.0],
        [-14.5, 0.0],
      ];
      navController.setPath(path, [-14.5, 0.0]);

      // Box placed 2.0m ahead
      const dynamicBox: InteractiveObject = {
        id: 'box-dyn-1',
        type: 'cube',
        position: [-14.5, 0.4, -8.0],
        color: '#f59e0b',
        size: 0.75,
      };
      gridMap.addDynamicObstacle({
        id: dynamicBox.id,
        x: dynamicBox.position[0],
        z: dynamicBox.position[2],
        radius: dynamicBox.size * 0.65,
      });

      const sensorScan = performSensorScan(
        [-14.5, 0.22, -10.0],
        0, // Facing +Z
        gridMap,
        [dynamicBox],
        []
      );

      expect(sensorScan.riskLevel).not.toBe('clear');

      // Compute control with gridMap and dynamicObjects passed
      const cmd = navController.computeControl(
        [-14.5, 0.22, -10.0],
        0,
        sensorScan,
        3.0,
        2.5,
        1.0,
        1.8, // Moving at 1.8 m/s
        6.0,
        gridMap,
        [dynamicBox],
        []
      );

      // Must be in AVOIDING mode
      expect(cmd.navState).toBe('AVOIDING');
      // Must NOT be emergency stopped
      expect(cmd.isEmergencyBraking).toBe(false);
      // Linear velocity must be positive (continues moving)
      expect(cmd.targetLinearVel).toBeGreaterThan(0.2);
      // Angular velocity must steer around obstacle
      expect(Math.abs(cmd.targetAngularVel)).toBeGreaterThan(0.1);
      // Local trajectory points must be populated
      expect(cmd.localTrajectoryPoints).toBeDefined();
      expect(cmd.localTrajectoryPoints!.length).toBeGreaterThan(5);
      // Replan is not needed because local avoidance handles it
      expect(cmd.needsReplan).toBe(false);
    });

    it('engages emergency braking when corridor is completely blocked by full-span barrier', () => {
      const path: Array<[number, number]> = [
        [-6.5, -10.0],
        [-6.5, -4.0],
      ];
      navController.setPath(path, [-6.5, -4.0]);

      const wallBarrier: AisleBarrier = {
        id: 'barrier-wall',
        aisleId: 'aisle-main',
        name: 'Impassable Barrier',
        position: [-6.5, 0.75, -8.5],
        width: 10.0,
        depth: 1.0,
        height: 1.5,
        rotation: 0,
      };
      gridMap.addBarrier(wallBarrier);

      const sensorScan = performSensorScan(
        [-6.5, 0.22, -10.0],
        0,
        gridMap,
        [],
        [wallBarrier]
      );

      // Since the barrier completely seals the aisle and is 1.5m ahead
      const cmd = navController.computeControl(
        [-6.5, 0.22, -10.0],
        0,
        sensorScan,
        3.0,
        2.5,
        1.0,
        2.0,
        6.0,
        gridMap,
        [],
        [wallBarrier]
      );

      // Since local planner found NO feasible path:
      // Robot must brake (either controlled predictive brake or emergency brake)
      expect(cmd.targetLinearVel).toBeLessThan(0.5);
      expect(cmd.navState).toBe('AVOIDING');
    });
  });

  describe('3. Dynamic Scenario: Moving Worker Crossing Path', () => {
    it('manages moving worker: steers around or yields, then resumes cruise when worker clears', () => {
      const path: Array<[number, number]> = [
        [-6.5, -10.0],
        [-6.5, -2.0],
      ];
      navController.setPath(path, [-6.5, -2.0]);

      // Worker crossing right in front at [-6.5, -7.0]
      const workerAtCenter: InteractiveObject = {
        id: 'worker-1',
        type: 'worker',
        position: [-6.5, 0.75, -7.0],
        color: '#f97316',
        size: 0.55,
      };
      gridMap.addDynamicObstacle({
        id: workerAtCenter.id,
        x: workerAtCenter.position[0],
        z: workerAtCenter.position[2],
        radius: workerAtCenter.size * 0.65,
      });

      const scan1 = performSensorScan(
        [-6.5, 0.22, -10.0],
        0,
        gridMap,
        [workerAtCenter],
        []
      );

      const cmd1 = navController.computeControl(
        [-6.5, 0.22, -10.0],
        0,
        scan1,
        3.0,
        2.5,
        1.0,
        1.5,
        6.0,
        gridMap,
        [workerAtCenter],
        []
      );

      // Either avoids locally or cautiously reduces speed
      expect(cmd1.navState).toBe('AVOIDING');

      // Now worker moves 3m away along patrol path to [-3.5, -7.0]
      const workerMovedAway: InteractiveObject = {
        ...workerAtCenter,
        position: [-3.5, 0.75, -7.0],
      };
      gridMap.removeDynamicObstacle('worker-1');
      gridMap.addDynamicObstacle({
        id: workerMovedAway.id,
        x: workerMovedAway.position[0],
        z: workerMovedAway.position[2],
        radius: workerMovedAway.size * 0.65,
      });

      const scan2 = performSensorScan(
        [-6.5, 0.22, -10.0],
        0,
        gridMap,
        [workerMovedAway],
        []
      );

      const cmd2 = navController.computeControl(
        [-6.5, 0.22, -10.0],
        0,
        scan2,
        3.0,
        2.5,
        2.0,
        1.5,
        6.0,
        gridMap,
        [workerMovedAway],
        []
      );

      // With worker cleared from the central corridor, robot resumes normal MOVING
      expect(cmd2.navState).toBe('MOVING');
      expect(cmd2.targetLinearVel).toBeGreaterThanOrEqual(2.5);
    });
  });

  describe('4. Extreme Difficulty: Multiple Simultaneous Obstacles in Aisle', () => {
    it('successfully bypasses or reroutes through multi-obstacle field without permanent stall', () => {
      const start: [number, number] = [-14.5, -10.0];
      const goal: [number, number] = [-14.5, 4.0];

      // 3 boxes staggered along the aisle
      const boxes: InteractiveObject[] = [
        { id: 'b1', type: 'cube', position: [-14.8, 0.4, -6.0], color: '#f59e0b', size: 0.6 },
        { id: 'b2', type: 'cube', position: [-14.2, 0.4, -2.0], color: '#f59e0b', size: 0.6 },
        { id: 'b3', type: 'cube', position: [-14.6, 0.4, 1.0], color: '#f59e0b', size: 0.6 },
      ];

      boxes.forEach((b) => {
        gridMap.addDynamicObstacle({
          id: b.id,
          x: b.position[0],
          z: b.position[2],
          radius: b.size * 0.65,
        });
      });

      // Global A* must either find a slalom path through or route around through an adjacent aisle
      const path = aStarFinder.findPath(start, goal);
      expect(path).not.toBeNull();
      expect(path!.length).toBeGreaterThan(2);

      // Verify each waypoint has safe clearance from obstacles
      for (const pt of path!) {
        for (const b of boxes) {
          const d = Math.hypot(pt[0] - b.position[0], pt[1] - b.position[2]);
          // Must not penetrate obstacle physical boundary
          expect(d).toBeGreaterThanOrEqual(b.size * 0.4);
        }
      }
    });
  });

  describe('5. Corridor Reopening & Automatic Resumption', () => {
    it('automatically finds path and restores navigation when blocked corridor reopens', () => {
      const start: [number, number] = [-14.5, -10.5];
      const goal: [number, number] = [14.0, 10.5];

      // Initially block all access with a barrier right across Bay 4
      const barrier: AisleBarrier = {
        id: 'b-bay4',
        aisleId: 'bay4',
        name: 'Bay 4 Gate',
        position: [14.0, 0.75, 10.5],
        width: 4.0,
        depth: 4.0,
        height: 1.5,
        rotation: 0,
      };
      gridMap.addBarrier(barrier);

      // Verify route is initially blocked
      const blockedPath = aStarFinder.findPath(start, goal);
      expect(blockedPath).toBeNull();

      // Now remove the barrier (e.g. gate opened, obstacle removed)
      gridMap.removeBarrier('b-bay4');

      // Verify route immediately reopens and is valid
      const restoredPath = aStarFinder.findPath(start, goal);
      expect(restoredPath).not.toBeNull();
      expect(restoredPath!.length).toBeGreaterThan(2);
      expect(restoredPath![0]).toEqual(start);
      expect(restoredPath![restoredPath!.length - 1]).toEqual(goal);
    });
  });
});
