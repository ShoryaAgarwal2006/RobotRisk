import { describe, it, expect, beforeEach } from 'vitest';
import { GridMap } from '../GridMap';
import { AStarFinder } from '../AStarFinder';
import { NavigationController } from '../NavigationController';
import { SensorScanResult } from '../sensorUtils';
import { useSimulationStore } from '../../state/useSimulationStore';

describe('Milestone 4: Autonomous Navigation & Pathfinding Suite', () => {
  let gridMap: GridMap;
  let aStarFinder: AStarFinder;
  let navController: NavigationController;

  beforeEach(() => {
    gridMap = new GridMap();
    aStarFinder = new AStarFinder(gridMap);
    navController = new NavigationController();
  });

  describe('GridMap & Spatial Representation', () => {
    it('converts world coordinates to grid indices bidirectionally', () => {
      const worldX = 0;
      const worldZ = 0;
      const [gx, gz] = gridMap.worldToGrid(worldX, worldZ);

      expect(gx).toBe(50); // Center of 100 cols
      expect(gz).toBe(40); // Center of 80 rows

      const [backX, backZ] = gridMap.gridToWorld(gx, gz);
      expect(backX).toBeCloseTo(0.2, 1);
      expect(backZ).toBeCloseTo(0.2, 1);
    });

    it('marks static warehouse racks and walls as non-walkable', () => {
      // Point inside Storage Rack Row A: [-3.25, -4.5]
      expect(gridMap.isWorldWalkable(-3.25, -4.5)).toBe(false);

      // Point inside North Wall: [0, -15.8]
      expect(gridMap.isWorldWalkable(0, -15.8)).toBe(false);

      // Point inside South Wall: [0, 15.8]
      expect(gridMap.isWorldWalkable(0, 15.8)).toBe(false);
    });

    it('verifies that open warehouse aisles and cross-passages are walkable', () => {
      // West Arterial Aisle: X = -14.5, Z = 0
      expect(gridMap.isWorldWalkable(-14.5, 0)).toBe(true);

      // Center Aisle 2: X = 0.0, Z = -3.0
      expect(gridMap.isWorldWalkable(0.0, -3.0)).toBe(true);

      // East Arterial: X = 14.0, Z = 0
      expect(gridMap.isWorldWalkable(14.0, 0)).toBe(true);

      // North Cross-Aisle: X = 0, Z = -10.5
      expect(gridMap.isWorldWalkable(0, -10.5)).toBe(true);

      // South Cross-Aisle: X = 0, Z = 10.5
      expect(gridMap.isWorldWalkable(0, 10.5)).toBe(true);
    });

    it('dynamically marks and clears moving obstacles', () => {
      expect(gridMap.isWorldWalkable(0.0, 0.0)).toBe(true);

      // Spawn dynamic obstacle at [0, 0] with 0.8m radius
      gridMap.addDynamicObstacle({ id: 'crate-1', x: 0.0, z: 0.0, radius: 0.8 });
      expect(gridMap.isWorldWalkable(0.0, 0.0)).toBe(false);

      // Clear dynamic obstacles
      gridMap.clearDynamicObstacles();
      expect(gridMap.isWorldWalkable(0.0, 0.0)).toBe(true);
    });

    it('computes line-of-sight raycasts accurately', () => {
      // Clear line along West Arterial: [-14.5, -8] to [-14.5, 8]
      expect(gridMap.hasLineOfSight(-14.5, -8, -14.5, 8)).toBe(true);

      // Blocked line cutting through Storage Rack Row A: [-6.5, -4.5] to [0.0, -4.5]
      expect(gridMap.hasLineOfSight(-6.5, -4.5, 0.0, -4.5)).toBe(false);
    });
  });

  describe('A* Route Generation & Replanning', () => {
    it('generates an optimal route from Charging Station to Bay 4 Delivery', () => {
      const start: [number, number] = [-14.5, -10.5]; // Charging dock
      const goal: [number, number] = [14.0, 10.5];    // Bay 4 delivery

      const path = aStarFinder.findPath(start, goal);

      expect(path).not.toBeNull();
      expect(path!.length).toBeGreaterThan(3);

      // Start and end match expectations
      expect(path![0]).toEqual(start);
      expect(path![path!.length - 1]).toEqual(goal);

      // Verify that EVERY waypoint on the path is traversable
      path!.forEach(([wx, wz]) => {
        expect(gridMap.isWorldWalkable(wx, wz)).toBe(true);
      });
    });

    it('replanns route around blocked corridors when dynamic obstacle is added', () => {
      const start: [number, number] = [0.0, -8.0];
      const goal: [number, number] = [0.0, 8.0];

      // Initial clear path down Center Aisle 2
      const initialPath = aStarFinder.findPath(start, goal);
      expect(initialPath).not.toBeNull();

      // Block Center Aisle 2 with a dynamic cargo barrier at [0.0, 0.0]
      gridMap.addDynamicObstacle({ id: 'blocker', x: 0.0, z: 0.0, radius: 1.5 });

      // Replan
      const replannedPath = aStarFinder.findPath(start, goal);
      expect(replannedPath).not.toBeNull();

      // Ensure the replanned path does NOT pass through [0, 0]
      replannedPath!.forEach(([wx, wz]) => {
        const distToObstacle = Math.hypot(wx - 0.0, wz - 0.0);
        expect(distToObstacle).toBeGreaterThan(1.2);
      });
    });

    it('handles unreachable destinations gracefully', () => {
      const start: [number, number] = [0, 0];
      // Destination located deep outside outer boundary walls
      const unreachableGoal: [number, number] = [45.0, 45.0];

      const path = aStarFinder.findPath(start, unreachableGoal);
      expect(path).toBeNull();
    });
  });

  describe('Autonomous Controller & Pure Pursuit Steering', () => {
    it('steers toward active waypoint and reaches destination', () => {
      const path: Array<[number, number]> = [
        [0.0, 0.0],
        [0.0, 3.0],
        [0.0, 6.0],
      ];
      navController.setPath(path, [0.0, 6.0]);

      const clearScan: SensorScanResult = {
        rays: [],
        forwardDist: 5.0,
        leftDist: 3.0,
        rightDist: 3.0,
        closestObstacleName: null,
        riskLevel: 'clear',
        obstaclePosition: null,
      };

      // Robot at [0, 0], heading North (0 rad, +Z forward)
      const cmd = navController.computeControl([0.0, 0.22, 0.0], 0, clearScan);

      expect(cmd.navState).toBe('MOVING');
      expect(cmd.targetLinearVel).toBeGreaterThan(1.0); // Moving forward
      expect(Math.abs(cmd.targetAngularVel)).toBeLessThan(0.5); // Minor steering

      // Robot arrives at destination [0, 6.0]
      const arrivalCmd = navController.computeControl([0.0, 0.22, 5.9], 0, clearScan);
      expect(arrivalCmd.navState).toBe('COMPLETED');
      expect(arrivalCmd.targetLinearVel).toBe(0);
    });

    it('slows down and triggers avoiding when sensor detects critical hazard', () => {
      const path: Array<[number, number]> = [
        [0.0, 0.0],
        [0.0, 5.0],
      ];
      navController.setPath(path, [0.0, 5.0]);

      const criticalScan: SensorScanResult = {
        rays: [],
        forwardDist: 0.8, // 80cm hazard ahead
        leftDist: 2.0,
        rightDist: 2.0,
        closestObstacleName: 'Dynamic Crate',
        riskLevel: 'critical',
        obstaclePosition: [0.0, 0.8],
      };

      const cmd = navController.computeControl([0.0, 0.22, 0.0], 0, criticalScan);
      expect(cmd.navState).toBe('AVOIDING');
      expect(cmd.targetLinearVel).toBe(0); // Halts immediately
    });
  });

  describe('Shared State & Mode Preservation in Autonomous Lab', () => {
    it('preserves robot pose and state when switching between Manual and Autonomous modes', () => {
      const store = useSimulationStore.getState();

      // Robot drives manually to arbitrary position in warehouse
      store.updateRobotPose([6.5, 0.22, 4.2], 1.57, 2.0, 0.0);
      store.setMode('manual');

      expect(useSimulationStore.getState().robotPose.position).toEqual([6.5, 0.22, 4.2]);

      // Switch to Autonomous Lab
      store.setMode('autonomous');
      expect(useSimulationStore.getState().mode).toBe('autonomous');
      expect(useSimulationStore.getState().robotPose.position).toEqual([6.5, 0.22, 4.2]);
      expect(useSimulationStore.getState().robotPose.rotation).toBeCloseTo(1.57, 2);

      // Switch back to Manual
      store.setMode('manual');
      expect(useSimulationStore.getState().robotPose.position).toEqual([6.5, 0.22, 4.2]);
    });

    it('enforces Emergency Stop during autonomous navigation', () => {
      const store = useSimulationStore.getState();
      store.setMode('autonomous');
      store.startMission('bay-4');

      expect(useSimulationStore.getState().missionMetrics.missionStatus).toBe('running');

      // Operator triggers E-Stop
      store.setEmergencyStop(true);
      expect(useSimulationStore.getState().robotStatus.isEmergencyStopped).toBe(true);
      expect(useSimulationStore.getState().navState).toBe('STOPPED');

      // Disengage E-Stop
      store.setEmergencyStop(false);
      expect(useSimulationStore.getState().robotStatus.isEmergencyStopped).toBe(false);
    });
  });
});
