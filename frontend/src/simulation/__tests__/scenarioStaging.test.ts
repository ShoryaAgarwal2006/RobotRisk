import { describe, it, expect, beforeEach } from 'vitest';
import {
  verifyRollbackState,
  findDuplicateIds,
  SimulationSnapshot,
} from '../../state/snapshotUtils';
import { useSimulationStore, waitForPhysicalPoseReset } from '../../state/useSimulationStore';

describe('Scenario Staging, Patrol Geometry & Exhaustive Rollback Verification', () => {
  beforeEach(() => {
    // Reset store state
    useSimulationStore.setState({
      isRunning: false,
      currentTime: 10.0,
      timeScale: 1.0,
      robotPose: {
        position: [-14.5, 0.22, -10.5],
        rotation: 0,
        linearVelocity: 0,
        angularVelocity: 0,
      },
      needsResetPose: false,
      targetResetPos: [-14.5, 0.22, -10.5],
      targetResetRot: 0,
      poseResetEpoch: 1,
      lastAcknowledgedPoseEpoch: 1,
      interactiveObjects: [],
      activeBarriers: [],
      selectedDestinationId: 'bay-4',
      difficulty: 'normal',
      navigationPreference: 'default',
      navState: 'IDLE',
      missionMetrics: {
        missionStatus: 'idle',
        missionTime: 0,
        distanceTravelled: 0,
        obstaclesDetected: 0,
        replanCount: 0,
        timeStopped: 0,
        collisions: 0,
        nearMisses: 0,
      },
      actualTrajectory: [[-14.5, 0.22, -10.5]],
      diagnostics: {
        currentWaypoint: null,
        currentWaypointIndex: 0,
        totalWaypoints: 0,
        lastMovedTime: 0,
        timeStopped: 0,
        obstaclePosition: null,
        obstacleName: null,
        routeValidity: 'valid',
        replanReason: 'System Ready',
        routeDiffers: false,
        failureExplanation: null,
      },
      activeScenarioId: null,
      activeScenarioMetadata: null,
    });
  });

  const createBaselineSnapshot = (): SimulationSnapshot => ({
    isRunning: true,
    currentTime: 10.0,
    timeScale: 1.0,
    robotPose: {
      position: [-14.5, 0.22, -10.5],
      rotation: 0,
      linearVelocity: 1.2,
      angularVelocity: 0.1,
    },
    needsResetPose: false,
    targetResetPos: [-14.5, 0.22, -10.5],
    targetResetRot: 0,
    poseResetEpoch: 1,
    lastAcknowledgedPoseEpoch: 1,
    interactiveObjects: [
      {
        id: 'actor-f1',
        type: 'forklift',
        position: [0.0, 0.1, 2.0],
        color: '#eab308',
        size: 1.0,
        rotation: 0.0,
        name: 'Forklift 1',
        patrolStart: [0.0, -10.0],
        patrolEnd: [0.0, 10.0],
        patrolSpeed: 1.5,
        patrolDirection: 1,
        velocity: [0.0, 0.0, 1.5],
      },
    ],
    activeBarriers: [
      {
        id: 'barrier-b1',
        aisleId: 'aisle-2',
        name: 'Barrier B1',
        position: [0.0, 0.55, 0.0],
        width: 2.4,
        depth: 0.4,
        height: 1.1,
        rotation: 0.0,
      },
    ],
    selectedDestinationId: 'bay-4',
    difficulty: 'normal',
    navigationPreference: 'default',
    navState: 'MOVING',
    missionMetrics: {
      missionStatus: 'running',
      missionTime: 10.0,
      distanceTravelled: 5.0,
      obstaclesDetected: 1,
      replanCount: 1,
      timeStopped: 0.0,
      collisions: 0,
      nearMisses: 0,
    },
    actualTrajectory: [[-14.5, 0.22, -10.5], [-12.0, 0.22, -10.5]],
    diagnostics: {
      currentWaypoint: [0.0, 2.0],
      currentWaypointIndex: 1,
      totalWaypoints: 8,
      lastMovedTime: 9.8,
      timeStopped: 0,
      obstaclePosition: [0.0, 5.0],
      obstacleName: 'Forklift 1',
      routeValidity: 'valid',
      replanReason: 'Clear',
      routeDiffers: false,
      failureExplanation: null,
    },
    activeScenarioId: 'baseline-scenario',
    activeScenarioMetadata: { scenario_id: 'baseline-scenario' },
    isEmergencyStopped: false,
  });

  const createValidRestoredState = (snapshot: SimulationSnapshot, rollbackEpoch: number) => ({
    isRunning: false, // Strict safety policy: must remain paused
    currentTime: snapshot.currentTime,
    timeScale: snapshot.timeScale,
    robotPose: {
      position: [...snapshot.robotPose.position] as [number, number, number],
      rotation: snapshot.robotPose.rotation,
      linearVelocity: 0, // Strict recovery normalization: zeroed
      angularVelocity: 0,
    },
    needsResetPose: false,
    targetResetPos: [...snapshot.robotPose.position] as [number, number, number],
    targetResetRot: snapshot.robotPose.rotation,
    poseResetEpoch: rollbackEpoch,
    lastAcknowledgedPoseEpoch: rollbackEpoch,
    interactiveObjects: snapshot.interactiveObjects.map((obj) => ({
      ...obj,
      velocity: [0, 0, 0] as [number, number, number],
    })),
    activeBarriers: snapshot.activeBarriers.map((b) => ({ ...b })),
    selectedDestinationId: snapshot.selectedDestinationId,
    difficulty: snapshot.difficulty,
    navigationPreference: snapshot.navigationPreference,
    navState: snapshot.navState,
    missionMetrics: { ...snapshot.missionMetrics },
    actualTrajectory: snapshot.actualTrajectory.map((p) => [...p] as [number, number, number]),
    diagnostics: { ...snapshot.diagnostics },
    activeScenarioId: snapshot.activeScenarioId,
    activeScenarioMetadata: snapshot.activeScenarioMetadata,
    isEmergencyStopped: snapshot.isEmergencyStopped,
  });

  it('detects duplicate IDs in barriers or objects', () => {
    const listWithDupes = [
      { id: 'item-1', name: 'Item 1' },
      { id: 'item-2', name: 'Item 2' },
      { id: 'item-1', name: 'Duplicate Item' },
    ];
    const dupes = findDuplicateIds(listWithDupes);
    expect(dupes).toEqual(['item-1']);
  });

  it('passes exhaustive rollback verification when all fields are correctly restored', () => {
    const snapshot = createBaselineSnapshot();
    const rollbackEpoch = 2;
    const restored = createValidRestoredState(snapshot, rollbackEpoch);

    const result = verifyRollbackState(restored, snapshot, rollbackEpoch);
    expect(result.passed).toBe(true);
    expect(result.mismatches).toHaveLength(0);
  });

  it('fails verification if safety pause policy is violated (isRunning is true)', () => {
    const snapshot = createBaselineSnapshot();
    const rollbackEpoch = 2;
    const restored = createValidRestoredState(snapshot, rollbackEpoch);
    restored.isRunning = true; // Violation

    const result = verifyRollbackState(restored, snapshot, rollbackEpoch);
    expect(result.passed).toBe(false);
    expect(result.mismatches).toContain('Safety policy violated: isRunning is not false');
  });

  it('fails verification if linear or angular velocity is not zeroed', () => {
    const snapshot = createBaselineSnapshot();
    const rollbackEpoch = 2;
    const restored = createValidRestoredState(snapshot, rollbackEpoch);
    restored.robotPose.linearVelocity = 0.5; // Violation

    const result = verifyRollbackState(restored, snapshot, rollbackEpoch);
    expect(result.passed).toBe(false);
    expect(result.mismatches.some((m) => m.includes('linearVelocity not zeroed'))).toBe(true);
  });

  it('fails verification if robot position X/Y/Z error exceeds 0.05m tolerance', () => {
    const snapshot = createBaselineSnapshot();
    const rollbackEpoch = 2;
    const restored = createValidRestoredState(snapshot, rollbackEpoch);
    restored.robotPose.position[0] += 0.06; // 6cm error

    const result = verifyRollbackState(restored, snapshot, rollbackEpoch);
    expect(result.passed).toBe(false);
    expect(result.mismatches.some((m) => m.includes('Physical robot X error'))).toBe(true);
  });

  it('fails verification if robot yaw error exceeds 0.05rad tolerance', () => {
    const snapshot = createBaselineSnapshot();
    const rollbackEpoch = 2;
    const restored = createValidRestoredState(snapshot, rollbackEpoch);
    restored.robotPose.rotation += 0.08; // 0.08 rad error

    const result = verifyRollbackState(restored, snapshot, rollbackEpoch);
    expect(result.passed).toBe(false);
    expect(result.mismatches.some((m) => m.includes('Physical robot yaw error'))).toBe(true);
  });

  it('fails verification if any barrier property does not match', () => {
    const snapshot = createBaselineSnapshot();
    const rollbackEpoch = 2;
    const restored = createValidRestoredState(snapshot, rollbackEpoch);
    restored.activeBarriers[0].width = 3.5; // Changed width

    const result = verifyRollbackState(restored, snapshot, rollbackEpoch);
    expect(result.passed).toBe(false);
    expect(result.mismatches.some((m) => m.includes('width mismatch'))).toBe(true);
  });

  it('fails verification if an actor is missing or has mismatched patrol configuration', () => {
    const snapshot = createBaselineSnapshot();
    const rollbackEpoch = 2;
    const restored = createValidRestoredState(snapshot, rollbackEpoch);
    restored.interactiveObjects[0].patrolSpeed = 99.0;

    const result = verifyRollbackState(restored, snapshot, rollbackEpoch);
    expect(result.passed).toBe(false);
    expect(result.mismatches.some((m) => m.includes('patrolSpeed mismatch'))).toBe(true);
  });

  it('fails verification if diagnostics or metrics mismatch', () => {
    const snapshot = createBaselineSnapshot();
    const rollbackEpoch = 2;
    const restored = createValidRestoredState(snapshot, rollbackEpoch);
    restored.diagnostics.obstacleName = 'Wrong Obstacle';

    const result = verifyRollbackState(restored, snapshot, rollbackEpoch);
    expect(result.passed).toBe(false);
    expect(result.mismatches.some((m) => m.includes('diagnostics.obstacleName'))).toBe(true);
  });

  it('waitForPhysicalPoseReset successfully awaits acknowledgement handshake', async () => {
    const targetPos: [number, number, number] = [0.0, 0.22, 5.0];
    const targetYaw = 1.57;
    const targetEpoch = 5;

    // Simulate store requesting reset
    useSimulationStore.setState({
      needsResetPose: true,
      poseResetEpoch: targetEpoch,
    });

    // Simulate RobotController acknowledging reset after 40ms
    setTimeout(() => {
      useSimulationStore.getState().acknowledgeResetPose(targetPos, targetYaw, targetEpoch);
    }, 40);

    await expect(
      waitForPhysicalPoseReset(targetEpoch, targetPos, targetYaw, 500)
    ).resolves.toBeUndefined();
  });

  it('waitForPhysicalPoseReset rejects if handshake times out', async () => {
    const targetPos: [number, number, number] = [0.0, 0.22, 5.0];
    const targetYaw = 1.57;
    const targetEpoch = 10;

    useSimulationStore.setState({
      needsResetPose: true,
      poseResetEpoch: targetEpoch,
    });

    // RobotController never acknowledges
    await expect(
      waitForPhysicalPoseReset(targetEpoch, targetPos, targetYaw, 100)
    ).rejects.toThrow(/Physical pose reset timed out/);
  });
});
