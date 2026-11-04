import { describe, it, expect, beforeEach } from 'vitest';
import { useSimulationStore } from '../../state/useSimulationStore';
import { GridMap } from '../../navigation/GridMap';
import { performSensorScan } from '../../navigation/sensorUtils';
import {
  evaluateSceneTTC,
  ObstacleVelocityTracker,
  NearMissDetector,
} from '../../navigation/ttcUtils';
import { flightRecorderService } from '../../services/flightRecorder';
import { RobotPose, InteractiveObject } from '../../types/simulation';

describe('Phase 5.5A: Physical Forklift Actor Architecture & Safety Intelligence', () => {
  beforeEach(() => {
    // Reset store state
    useSimulationStore.setState({
      mode: 'autonomous',
      isRunning: true,
      timeScale: 1.0,
      currentTime: 0.0,
      robotPose: {
        position: [-14.5, 0.22, -10.5],
        rotation: 0,
        linearVelocity: 1.5,
        angularVelocity: 0,
      },
      interactiveObjects: [],
      activeBarriers: [],
      isRecordingFlightData: true,
      robotStatus: {
        battery: 100,
        isEmergencyStopped: false,
        collisionCount: 0,
        lastCollisionForce: 0,
      },
    });
    flightRecorderService.clearAllSessions();
  });

  describe('1. Forklift Spawning & Data Structure', () => {
    it('spawns a forklift with correct physical dimensions, yellow color and patrol coordinates', () => {
      const store = useSimulationStore.getState();
      store.spawnForklift(
        [-6.5, 0.0, -8.0],
        [-6.5, -8.0],
        [-6.5, 4.0],
        1.6,
        'Heavy Industrial Forklift 101'
      );

      const state = useSimulationStore.getState();
      expect(state.interactiveObjects.length).toBe(1);

      const forklift = state.interactiveObjects[0];
      expect(forklift.type).toBe('forklift');
      expect(forklift.name).toBe('Heavy Industrial Forklift 101');
      expect(forklift.color).toBe('#eab308'); // Safety yellow
      expect(forklift.size).toBe(1.6);
      expect(forklift.patrolStart).toEqual([-6.5, -8.0]);
      expect(forklift.patrolEnd).toEqual([-6.5, 4.0]);
      expect(forklift.patrolSpeed).toBe(1.6);
      expect(forklift.patrolDirection).toBe(1);
      expect(forklift.velocity).toBeDefined();
    });

    it('defaults to safe parameters when optional arguments are omitted', () => {
      const store = useSimulationStore.getState();
      store.spawnForklift([0, 0, 0]);

      const forklift = useSimulationStore.getState().interactiveObjects[0];
      expect(forklift.type).toBe('forklift');
      expect(forklift.patrolSpeed).toBe(1.4);
      expect(forklift.name).toBe('Heavy Industrial Forklift');
      expect(forklift.patrolStart).toEqual([0, -4]);
      expect(forklift.patrolEnd).toEqual([0, 4]);
    });
  });

  describe('2. Kinematic Patrol & Simulation Clock Integration', () => {
    it('advances forklift along patrol vector driven by authoritative delta time', () => {
      const store = useSimulationStore.getState();
      // Moving North-to-South along Z from Z = -5 to Z = +5 at 2.0 m/s
      store.spawnForklift([0, 0, -5], [0, -5], [0, 5], 2.0);

      // Advance clock by 1.0 second (delta = 0.5s x 2)
      store.tick(0.5);
      store.tick(0.5);

      const updated = useSimulationStore.getState().interactiveObjects[0];
      // Expected progress: 2.0 m/s * 1.0s = 2.0m forward -> Z = -3.0
      expect(updated.position[2]).toBeCloseTo(-3.0, 1);
      expect(updated.velocity?.[2]).toBeCloseTo(2.0, 1);
      expect(updated.patrolDirection).toBe(1);
    });

    it('smoothly turns around 180 degrees upon reaching patrol endpoint', () => {
      const store = useSimulationStore.getState();
      // Distance is 2.0m (Z = 0 to Z = 2.0), speed = 2.0 m/s -> reaches end in 1.0s
      store.spawnForklift([0, 0, 0], [0, 0], [0, 2], 2.0);

      // Advance by 1.2 seconds (overshoots endpoint and bounces back)
      store.tick(1.2);

      const updated = useSimulationStore.getState().interactiveObjects[0];
      // Should reverse direction
      expect(updated.patrolDirection).toBe(-1);
      // Velocity vector reverses
      expect(updated.velocity?.[2]).toBeCloseTo(-2.0, 1);
      // Position is retreating back towards Z = 0 (2.0 - 0.4 = 1.6)
      expect(updated.position[2]).toBeLessThanOrEqual(2.0);
    });

    it('freezes movement completely when simulation is paused, and resumes without jumps', () => {
      const store = useSimulationStore.getState();
      store.spawnForklift([0, 0, 0], [0, 0], [0, 10], 2.0);

      // Run 0.5s -> Z reaches 1.0
      store.tick(0.5);
      const posBeforePause = [...useSimulationStore.getState().interactiveObjects[0].position];
      expect(posBeforePause[2]).toBeCloseTo(1.0, 1);

      // PAUSE simulation
      useSimulationStore.setState({ isRunning: false });

      // Multiple ticks while paused
      store.tick(0.5);
      store.tick(0.5);
      store.tick(1.0);

      const posDuringPause = useSimulationStore.getState().interactiveObjects[0].position;
      expect(posDuringPause[2]).toBe(posBeforePause[2]); // Exactly frozen

      // RESUME simulation
      useSimulationStore.setState({ isRunning: true });
      store.tick(0.5); // Should advance another 1.0m from frozen pos to Z = 2.0

      const posAfterResume = useSimulationStore.getState().interactiveObjects[0].position;
      expect(posAfterResume[2]).toBeCloseTo(2.0, 1);
    });
  });

  describe('3. Dynamic Velocity & TTC Intelligence', () => {
    it('ObstacleVelocityTracker extracts exact analytical velocity for forklift', () => {
      const tracker = new ObstacleVelocityTracker();
      const forklift: InteractiveObject = {
        id: 'forklift-test-1',
        type: 'forklift',
        position: [2.0, 0, -4.0],
        color: '#eab308',
        size: 1.6,
        patrolStart: [0.0, -4.0],
        patrolEnd: [10.0, -4.0], // Moving along +X
        patrolSpeed: 2.5,
        patrolDirection: 1,
      };

      const vel = tracker.getVelocity(forklift.id, { x: 2.0, z: -4.0 }, 1.0, forklift);
      expect(vel.x).toBeCloseTo(2.5, 2);
      expect(vel.z).toBeCloseTo(0.0, 2);
    });

    it('computes accurate converging TTC when AMR and forklift are on a collision course', () => {
      // Robot at [0, 0], facing +Z (yaw = 0), speed = 2.0 m/s (v_R = [0, 2])
      const robotPose: RobotPose = {
        position: [0.0, 0.22, 0.0],
        rotation: 0,
        linearVelocity: 2.0,
        angularVelocity: 0,
      };

      // Forklift crossing at Z = 6.0m, moving along X from X = 5.0 to -5.0 at 1.5 m/s
      // Centerline intersection: Robot reaches Z = 6.0m in 6.0 / 2.0 = 3.0s
      // Forklift at X = 4.5m reaches X = 0 in 4.5 / 1.5 = 3.0s! Perfect collision course!
      const forklift: InteractiveObject = {
        id: 'forklift-crossing',
        type: 'forklift',
        name: 'Heavy Industrial Forklift',
        position: [4.5, 0.0, 6.0],
        color: '#eab308',
        size: 1.6,
        patrolStart: [10.0, 6.0],
        patrolEnd: [-10.0, 6.0],
        patrolSpeed: 1.5,
        patrolDirection: 1,
        velocity: [-1.5, 0, 0],
      };

      const analysis = evaluateSceneTTC(
        robotPose,
        [forklift],
        [],
        undefined,
        0.0,
        new NearMissDetector(),
        new ObstacleVelocityTracker()
      );

      expect(analysis.isCollisionCourse).toBe(true);
      expect(analysis.minTtc).not.toBeNull();
      // TTC should be approximately (distance - radii) / closingSpeed ~ 2.5s
      expect(analysis.minTtc!).toBeGreaterThan(1.8);
      expect(analysis.minTtc!).toBeLessThan(3.2);
      expect(analysis.highestRiskObstacle).toBe('Heavy Industrial Forklift');
    });

    it('triggers NEAR_MISS when forklift passes dangerously close below clearance threshold', () => {
      const nearMissDetector = new NearMissDetector({
        clearanceThreshold: 0.45,
        speedThreshold: 0.5,
        exitClearanceThreshold: 0.8,
        cooldownSeconds: 2.0,
      });

      // Robot moving at 1.2 m/s
      const robotPose: RobotPose = {
        position: [0.0, 0.22, 0.0],
        rotation: 0,
        linearVelocity: 1.2,
        angularVelocity: 0,
      };

      // Forklift located just 1.15m away (center-to-center).
      // Robot radius = 0.34m, Forklift radius = 1.6 * 0.65 = 1.04m
      // Physical clearance = 1.45 - (0.34 + 1.04) = 0.07m (< 0.45m threshold!)
      const forklift: InteractiveObject = {
        id: 'forklift-near-miss',
        type: 'forklift',
        name: 'Heavy Industrial Forklift',
        position: [0.0, 0.0, 1.45],
        color: '#eab308',
        size: 1.6,
        velocity: [0, 0, 0],
      };

      const analysis = evaluateSceneTTC(
        robotPose,
        [forklift],
        [],
        undefined,
        1.0,
        nearMissDetector
      );

      expect(analysis.minClearance).toBeLessThan(0.45);
      expect(analysis.newNearMissDetected).toBe(true);
    });
  });

  describe('4. LiDAR Perception & Oriented Bounding Box Detection', () => {
    it('detects forklift rectangular bounding box and identifies it by name', () => {
      const gridMap = new GridMap();
      // Robot at [-14.5, -10.5] facing East (yaw = +PI/2, down North Cross Aisle)
      const robotPos: [number, number, number] = [-14.5, 0.22, -10.5];
      const robotYaw = Math.PI / 2; // Facing +X

      // Forklift at X = -11.5, Z = -10.5 (3m ahead along robot forward path)
      const forklift: InteractiveObject = {
        id: 'forklift-lidar',
        type: 'forklift',
        name: 'Heavy Industrial Forklift',
        position: [-11.5, 0.0, -10.5],
        rotation: 0,
        color: '#eab308',
        size: 1.6,
      };

      const scan = performSensorScan(
        robotPos,
        robotYaw,
        gridMap,
        [forklift],
        [],
        0.0,
        1.5
      );

      // Forward distance must be intercepted by forklift front surface (~2.0 - 2.5m)
      expect(scan.forwardDist).toBeLessThan(3.0);
      expect(scan.forwardDist).toBeGreaterThan(1.5);
      expect(scan.closestObstacleName).toBe('Heavy Industrial Forklift');
      expect(scan.riskLevel).not.toBe('clear');
    });

    it('accurately respects forklift orientation heading in LiDAR raycasts', () => {
      const gridMap = new GridMap();
      const robotPos: [number, number, number] = [0, 0.22, 0];
      const robotYaw = 0; // Facing +Z

      // Forklift 3m ahead at Z = 3.0, oriented perpendicular (yaw = PI/2)
      // Width (1.0m) extends along Z, Length (2.1m) extends along X
      const forklift: InteractiveObject = {
        id: 'forklift-perp',
        type: 'forklift',
        name: 'Heavy Industrial Forklift',
        position: [0, 0, 3.0],
        rotation: Math.PI / 2,
        color: '#eab308',
        size: 1.6,
      };

      const scan = performSensorScan(
        robotPos,
        robotYaw,
        gridMap,
        [forklift],
        []
      );

      expect(scan.forwardDist).toBeLessThan(3.0);
      expect(scan.closestObstacleName).toBe('Heavy Industrial Forklift');
    });
  });

  describe('5. Flight Recorder & Physical Collision Integration', () => {
    it('captures collision incident with exact forklift name and telemetry snapshot', () => {
      const store = useSimulationStore.getState();
      flightRecorderService.startRecording(0.0, true, 'operator', 'FORKLIFT-COLLISION-TEST');

      // Register collision impact with forklift
      store.recordCollision(450.0, 'Heavy Industrial Forklift');

      const session = flightRecorderService.getCurrentSession();
      expect(session).not.toBeNull();
      expect(session!.incidents.length).toBe(1);

      const incident = session!.incidents[0];
      expect(incident.type).toBe('COLLISION');
      expect(incident.description).toContain('Heavy Industrial Forklift');
      expect(incident.description).toContain('450.0 N');
      expect(incident.snapshot.position).toBeDefined();
    });

    it('captures dynamic near-miss encounters in Flight Recorder when updating sensor data', () => {
      const store = useSimulationStore.getState();
      flightRecorderService.startRecording(0.0, true, 'operator', 'FORKLIFT-NEAR-MISS-TEST');

      // Place moving forklift dangerously close to moving AMR
      store.spawnForklift([0, 0, 1.4], [0, 0], [0, 5], 1.2);
      useSimulationStore.setState({
        robotPose: {
          position: [0, 0.22, 0],
          rotation: 0,
          linearVelocity: 1.5,
          angularVelocity: 0,
        },
        currentTime: 1.5,
      });

      // Update sensor scan -> triggers evaluateSceneTTC inside store
      store.updateSensorData({
        forwardDist: 1.2,
        leftDist: 2.0,
        rightDist: 2.0,
        closestObstacle: 'Heavy Industrial Forklift',
        obstaclePosition: [0, 1.4],
        riskLevel: 'critical',
      });

      const session = flightRecorderService.getCurrentSession();
      expect(session).not.toBeNull();
      // Critical TTC or near-miss incident should be registered
      const hasCriticalOrNearMiss = session!.incidents.some(
        (i) => i.type === 'TTC_CRITICAL' || i.type === 'NEAR_MISS'
      );
      expect(hasCriticalOrNearMiss).toBe(true);
    });
  });

  describe('6. Spawning, Removal & Lifecycle Management', () => {
    it('safely removes a forklift by id using deleteInteractiveObject', () => {
      const store = useSimulationStore.getState();
      store.spawnForklift([2, 0, 2]);
      expect(useSimulationStore.getState().interactiveObjects.length).toBe(1);

      const forkliftId = useSimulationStore.getState().interactiveObjects[0].id;
      store.deleteInteractiveObject(forkliftId);

      expect(useSimulationStore.getState().interactiveObjects.length).toBe(0);
    });

    it('clears all interactive objects including forklifts cleanly', () => {
      const store = useSimulationStore.getState();
      store.spawnForklift([1, 0, 1]);
      store.spawnForklift([3, 0, 3]);
      store.spawnWorker([5, 0.75, 5]);
      expect(useSimulationStore.getState().interactiveObjects.length).toBe(3);

      store.clearInteractiveObjects();
      expect(useSimulationStore.getState().interactiveObjects.length).toBe(0);
    });
  });
});
