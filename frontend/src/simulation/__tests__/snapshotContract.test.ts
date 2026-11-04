import { describe, it, expect } from 'vitest';
import {
  clonePlainSnapshotData,
  UnsupportedSnapshotDataError,
  SimulationSnapshot,
} from '../../state/snapshotUtils';

describe('SimulationSnapshot Plain Data Contract & Deep Independence', () => {
  const createValidSnapshot = (): SimulationSnapshot => ({
    isRunning: true,
    currentTime: 14.5,
    timeScale: 1.0,
    interactiveObjects: [
      {
        id: 'actor-1',
        type: 'forklift',
        position: [0.0, 0.1, 5.0],
        color: '#eab308',
        size: 1.0,
        rotation: 1.57,
        patrolStart: [0.0, -10.0],
        patrolEnd: [0.0, 10.0],
        patrolSpeed: 1.4,
        patrolDirection: 1,
        velocity: [0.0, 0.0, 1.4],
      },
    ],
    activeBarriers: [
      {
        id: 'barrier-1',
        aisleId: 'aisle-1',
        name: 'Aisle 1 Barrier',
        position: [-6.5, 0.55, 0.0],
        width: 2.4,
        depth: 0.4,
        height: 1.1,
        rotation: 0,
      },
    ],
    robotPose: {
      position: [-14.5, 0.22, -10.5],
      rotation: 0,
      linearVelocity: 1.2,
      angularVelocity: 0.1,
    },
    needsResetPose: false,
    targetResetPos: [-14.5, 0.22, -10.5],
    targetResetRot: 0,
    poseResetEpoch: 3,
    lastAcknowledgedPoseEpoch: 3,
    selectedDestinationId: 'bay-4',
    difficulty: 'normal',
    navigationPreference: 'default',
    activeScenarioId: 'scen-01',
    activeScenarioMetadata: {
      scenario_id: 'scen-01',
      title: 'Active Scenario',
    },
    isEmergencyStopped: false,
    navState: 'MOVING',
    missionMetrics: {
      missionStatus: 'running',
      missionTime: 12.3,
      distanceTravelled: 8.5,
      obstaclesDetected: 2,
      replanCount: 1,
      timeStopped: 0.0,
      collisions: 0,
      nearMisses: 1,
    },
    actualTrajectory: [[-14.5, 0.22, -10.5], [-12.0, 0.22, -10.5]],
    diagnostics: {
      currentWaypoint: [0.0, 5.0],
      currentWaypointIndex: 2,
      totalWaypoints: 10,
      lastMovedTime: 14.2,
      timeStopped: 0,
      obstaclePosition: [0.0, 7.0],
      obstacleName: 'Forklift 1',
      routeValidity: 'valid',
      replanReason: 'Clear',
      routeDiffers: false,
      failureExplanation: null,
    },
  });

  it('successfully clones valid plain simulation snapshot data', () => {
    const original = createValidSnapshot();
    const cloned = clonePlainSnapshotData(original);

    expect(cloned).toEqual(original);
    expect(cloned).not.toBe(original);
    expect(cloned.robotPose).not.toBe(original.robotPose);
    expect(cloned.robotPose.position).not.toBe(original.robotPose.position);
    expect(cloned.interactiveObjects).not.toBe(original.interactiveObjects);
    expect(cloned.interactiveObjects[0]).not.toBe(original.interactiveObjects[0]);
    expect(cloned.interactiveObjects[0].position).not.toBe(original.interactiveObjects[0].position);
  });

  it('proves deep independence: mutating original does NOT alter snapshot', () => {
    const original = createValidSnapshot();
    const snapshot = clonePlainSnapshotData(original);

    // Deeply mutate original state fields
    original.robotPose.position[0] = 999.9;
    original.robotPose.rotation = 3.14159;
    original.interactiveObjects[0].position[2] = -999.0;
    original.interactiveObjects[0].velocity = [10.0, 0.0, 10.0];
    original.diagnostics.obstaclePosition = [88.0, 88.0];
    original.actualTrajectory.push([100.0, 0.0, 100.0]);

    // Snapshot must remain completely untouched
    expect(snapshot.robotPose.position[0]).toBe(-14.5);
    expect(snapshot.robotPose.rotation).toBe(0);
    expect(snapshot.interactiveObjects[0].position[2]).toBe(5.0);
    expect(snapshot.interactiveObjects[0].velocity).toEqual([0.0, 0.0, 1.4]);
    expect(snapshot.diagnostics.obstaclePosition).toEqual([0.0, 7.0]);
    expect(snapshot.actualTrajectory.length).toBe(2);
  });

  it('rejects Date instances to enforce plain data contract', () => {
    const invalidObj = {
      timestamp: new Date(),
    };
    expect(() => clonePlainSnapshotData(invalidObj)).toThrow(UnsupportedSnapshotDataError);
    expect(() => clonePlainSnapshotData(invalidObj)).toThrow(/Date/);
  });

  it('rejects Map instances to enforce plain data contract', () => {
    const invalidObj = {
      data: new Map([['key', 'val']]),
    };
    expect(() => clonePlainSnapshotData(invalidObj)).toThrow(UnsupportedSnapshotDataError);
    expect(() => clonePlainSnapshotData(invalidObj)).toThrow(/Map/);
  });

  it('rejects Set instances to enforce plain data contract', () => {
    const invalidObj = {
      items: new Set([1, 2, 3]),
    };
    expect(() => clonePlainSnapshotData(invalidObj)).toThrow(UnsupportedSnapshotDataError);
    expect(() => clonePlainSnapshotData(invalidObj)).toThrow(/Set/);
  });

  it('rejects TypedArray (Float32Array) to enforce plain data contract', () => {
    const invalidObj = {
      buffer: new Float32Array([1.0, 2.0]),
    };
    expect(() => clonePlainSnapshotData(invalidObj)).toThrow(UnsupportedSnapshotDataError);
    expect(() => clonePlainSnapshotData(invalidObj)).toThrow(/TypedArray/);
  });

  it('rejects circular references', () => {
    const circularObj: any = { a: 1 };
    circularObj.self = circularObj;

    expect(() => clonePlainSnapshotData(circularObj)).toThrow(UnsupportedSnapshotDataError);
    expect(() => clonePlainSnapshotData(circularObj)).toThrow(/Circular/);
  });
});
