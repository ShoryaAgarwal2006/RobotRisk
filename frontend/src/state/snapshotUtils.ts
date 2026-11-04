/**
 * Snapshot & Rollback Verification Utilities
 * ROBOTRISK AI — PHASE 5.5C
 * 
 * Deep independent snapshot cloning, structural equality, and exhaustive field-by-field verification.
 */

import {
  InteractiveObject,
  AisleBarrier,
  NavState,
  MissionMetrics,
  NavigationDiagnostics,
} from '../types/simulation';

export class UnsupportedSnapshotDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedSnapshotDataError';
  }
}

export interface SimulationSnapshot {
  // Clock state (Captured in undisturbed pre-staging state)
  isRunning: boolean;
  currentTime: number;
  timeScale: number;

  // Warehouse entities
  interactiveObjects: InteractiveObject[];
  activeBarriers: AisleBarrier[];

  // Robot state
  robotPose: {
    position: [number, number, number];
    rotation: number;
    linearVelocity: number;
    angularVelocity: number;
  };
  needsResetPose: boolean;
  targetResetPos: [number, number, number];
  targetResetRot: number;
  poseResetEpoch: number;
  lastAcknowledgedPoseEpoch: number;

  // Mission setup
  selectedDestinationId: string | null;
  difficulty: any;
  navigationPreference: 'default' | 'shortest_safe_path' | 'alternative_route';
  activeScenarioId: string | null;
  activeScenarioMetadata: any | null;
  isEmergencyStopped: boolean;

  // Navigation, trajectory & diagnostics
  navState: NavState;
  missionMetrics: MissionMetrics;
  actualTrajectory: Array<[number, number, number]>;
  diagnostics: NavigationDiagnostics;
}

/**
 * Safe, recursive cloning for plain snapshot data.
 * Rejects unsupported types (Date, Map, Set, TypedArray, circular references).
 */
export function clonePlainSnapshotData<T>(val: T, seen = new WeakSet<object>()): T {
  if (val === null || typeof val !== 'object') {
    return val;
  }

  // Detect circular references
  if (seen.has(val as object)) {
    throw new UnsupportedSnapshotDataError('Circular reference detected in snapshot data.');
  }
  seen.add(val as object);

  // Reject unsupported class instances or non-plain data
  if (val instanceof Date) {
    throw new UnsupportedSnapshotDataError('Date instances are not supported in plain simulation snapshots.');
  }
  if (val instanceof Map || val instanceof Set) {
    throw new UnsupportedSnapshotDataError('Map/Set instances are not supported in plain simulation snapshots.');
  }
  if (ArrayBuffer.isView(val)) {
    throw new UnsupportedSnapshotDataError('TypedArrays are not supported in plain simulation snapshots.');
  }

  if (Array.isArray(val)) {
    return val.map((item) => clonePlainSnapshotData(item, seen)) as unknown as T;
  }

  // Reject custom non-plain prototypes
  const proto = Object.getPrototypeOf(val);
  if (proto !== null && proto !== Object.prototype) {
    throw new UnsupportedSnapshotDataError(`Unsupported class or non-plain object type: ${val.constructor?.name}`);
  }

  const copy: Record<string, any> = {};
  for (const key of Object.keys(val)) {
    copy[key] = clonePlainSnapshotData((val as Record<string, any>)[key], seen);
  }
  return copy as T;
}

/**
 * Key insertion-order-independent deep structural equality check.
 * Strictly distinguishes undefined, null, 0, and false.
 */
export function deepStructuralEqual(a: any, b: any): boolean {
  if (a === b) {
    return true;
  }

  // Strict distinction: undefined vs null vs primitive
  if (a === null || b === null || a === undefined || b === undefined) {
    return a === b;
  }

  if (typeof a === 'number' && typeof b === 'number' && isNaN(a) && isNaN(b)) {
    return true;
  }

  if (typeof a !== typeof b) {
    return false;
  }

  const aIsArr = Array.isArray(a);
  const bIsArr = Array.isArray(b);
  if (aIsArr !== bIsArr) {
    return false;
  }
  if (aIsArr && bIsArr) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepStructuralEqual(a[i], b[i])) {
        return false;
      }
    }
    return true;
  }

  if (typeof a === 'object' && typeof b === 'object') {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);

    if (aKeys.length !== bKeys.length) {
      return false;
    }

    const bKeySet = new Set(bKeys);
    for (const key of aKeys) {
      if (!bKeySet.has(key)) {
        return false;
      }
      if (!deepStructuralEqual(a[key], b[key])) {
        return false;
      }
    }
    return true;
  }

  return false;
}

export function strictOptionalFloatEq(
  a: number | undefined | null,
  b: number | undefined | null,
  tol = 0.001
): boolean {
  if (a === undefined && b === undefined) return true;
  if (a === null && b === null) return true;
  if (a === undefined || a === null || b === undefined || b === null) return false;
  return Math.abs(a - b) <= tol;
}

export function strictOptionalPoint2Eq(
  a: [number, number] | undefined | null,
  b: [number, number] | undefined | null,
  tol = 0.001
): boolean {
  if (a === undefined && b === undefined) return true;
  if (a === null && b === null) return true;
  if (a === undefined || a === null || b === undefined || b === null) return false;
  return Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol;
}

export function strictOptionalPoint3Eq(
  a: [number, number, number] | undefined | null,
  b: [number, number, number] | undefined | null,
  tol = 0.001
): boolean {
  if (a === undefined && b === undefined) return true;
  if (a === null && b === null) return true;
  if (a === undefined || a === null || b === undefined || b === null) return false;
  return (
    Math.abs(a[0] - b[0]) <= tol &&
    Math.abs(a[1] - b[1]) <= tol &&
    Math.abs(a[2] - b[2]) <= tol
  );
}

export function strictOptionalStringEq(
  a: string | undefined | null,
  b: string | undefined | null
): boolean {
  if (a === undefined && b === undefined) return true;
  if (a === null && b === null) return true;
  return a === b;
}

export function findDuplicateIds(items: Array<{ id: string }>): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) {
      duplicates.add(item.id);
    }
    seen.add(item.id);
  }
  return Array.from(duplicates);
}

/**
 * Exhaustive field-by-field verification of state restoration against snapshot.
 * Compares actors and barriers strictly by stable ID.
 */
export function verifyRollbackState(
  current: any,
  snapshot: SimulationSnapshot,
  rollbackEpoch: number
): { passed: boolean; mismatches: string[] } {
  const mismatches: string[] = [];
  const floatEq = (a: number, b: number, tol = 0.001) => Math.abs(a - b) <= tol;

  // 1. Duplicate ID Detection (Prevents silent Map collision overwrites)
  const snapBarrierDupes = findDuplicateIds(snapshot.activeBarriers);
  if (snapBarrierDupes.length > 0) mismatches.push(`Snapshot contains duplicate barrier IDs: ${snapBarrierDupes.join(', ')}`);
  const currBarrierDupes = findDuplicateIds(current.activeBarriers);
  if (currBarrierDupes.length > 0) mismatches.push(`Current state contains duplicate barrier IDs: ${currBarrierDupes.join(', ')}`);

  const snapObjectDupes = findDuplicateIds(snapshot.interactiveObjects);
  if (snapObjectDupes.length > 0) mismatches.push(`Snapshot contains duplicate object IDs: ${snapObjectDupes.join(', ')}`);
  const currObjectDupes = findDuplicateIds(current.interactiveObjects);
  if (currObjectDupes.length > 0) mismatches.push(`Current state contains duplicate object IDs: ${currObjectDupes.join(', ')}`);

  // 2. Safety Policy & Reset Handshake Normalizations
  if (current.isRunning !== false) {
    mismatches.push("Safety policy violated: isRunning is not false");
  }
  if (current.robotPose.linearVelocity !== 0) {
    mismatches.push(`linearVelocity not zeroed: ${current.robotPose.linearVelocity}`);
  }
  if (current.robotPose.angularVelocity !== 0) {
    mismatches.push(`angularVelocity not zeroed: ${current.robotPose.angularVelocity}`);
  }
  if (current.needsResetPose !== false) {
    mismatches.push("needsResetPose was not cleared by RobotController physical reset");
  }
  if (current.lastAcknowledgedPoseEpoch !== rollbackEpoch) {
    mismatches.push(`Pose epoch mismatch: ack=${current.lastAcknowledgedPoseEpoch} vs expected=${rollbackEpoch}`);
  }
  if (
    !floatEq(current.targetResetPos[0], snapshot.robotPose.position[0]) ||
    !floatEq(current.targetResetPos[1], snapshot.robotPose.position[1]) ||
    !floatEq(current.targetResetPos[2], snapshot.robotPose.position[2])
  ) {
    mismatches.push("targetResetPos is not consistent with snapshot.robotPose.position");
  }
  if (!floatEq(current.targetResetRot, snapshot.robotPose.rotation)) {
    mismatches.push("targetResetRot is not consistent with snapshot.robotPose.rotation");
  }

  // 3. Physical Rapier Robot Pose in all 3 Axes and Yaw
  const dx = Math.abs(current.robotPose.position[0] - snapshot.robotPose.position[0]);
  const dy = Math.abs(current.robotPose.position[1] - snapshot.robotPose.position[1]);
  const dz = Math.abs(current.robotPose.position[2] - snapshot.robotPose.position[2]);
  const yawError = Math.abs(
    Math.atan2(
      Math.sin(current.robotPose.rotation - snapshot.robotPose.rotation),
      Math.cos(current.robotPose.rotation - snapshot.robotPose.rotation)
    )
  );

  if (dx > 0.05) mismatches.push(`Physical robot X error ${dx.toFixed(4)}m exceeds 0.05m tolerance`);
  if (dy > 0.05) mismatches.push(`Physical robot Y error ${dy.toFixed(4)}m exceeds 0.05m tolerance`);
  if (dz > 0.05) mismatches.push(`Physical robot Z error ${dz.toFixed(4)}m exceeds 0.05m tolerance`);
  if (yawError > 0.05) mismatches.push(`Physical robot yaw error ${yawError.toFixed(4)}rad exceeds 0.05rad tolerance`);

  // 4. Clock State
  if (!floatEq(current.currentTime, snapshot.currentTime)) {
    mismatches.push(`currentTime mismatch: ${current.currentTime} vs ${snapshot.currentTime}`);
  }
  if (!floatEq(current.timeScale, snapshot.timeScale)) {
    mismatches.push(`timeScale mismatch: ${current.timeScale} vs ${snapshot.timeScale}`);
  }

  // 5. Barriers (By Stable ID)
  if (current.activeBarriers.length !== snapshot.activeBarriers.length) {
    mismatches.push(`Barrier count mismatch: ${current.activeBarriers.length} vs ${snapshot.activeBarriers.length}`);
  }
  const currentBarriersById = new Map<string, any>(current.activeBarriers.map((b: any) => [b.id, b]));
  for (const sb of snapshot.activeBarriers) {
    const cb = currentBarriersById.get(sb.id);
    if (!cb) {
      mismatches.push(`Missing restored barrier with stable ID '${sb.id}'`);
      continue;
    }
    if (cb.aisleId !== sb.aisleId) mismatches.push(`Barrier '${sb.id}' aisleId mismatch: ${cb.aisleId} vs ${sb.aisleId}`);
    if (cb.name !== sb.name) mismatches.push(`Barrier '${sb.id}' name mismatch: ${cb.name} vs ${sb.name}`);
    if (!floatEq(cb.width, sb.width)) mismatches.push(`Barrier '${sb.id}' width mismatch: ${cb.width} vs ${sb.width}`);
    if (!floatEq(cb.depth, sb.depth)) mismatches.push(`Barrier '${sb.id}' depth mismatch: ${cb.depth} vs ${sb.depth}`);
    if (!floatEq(cb.height, sb.height)) mismatches.push(`Barrier '${sb.id}' height mismatch: ${cb.height} vs ${sb.height}`);
    if (!floatEq(cb.rotation, sb.rotation)) mismatches.push(`Barrier '${sb.id}' rotation mismatch: ${cb.rotation} vs ${sb.rotation}`);
    if (!strictOptionalPoint3Eq(cb.position, sb.position)) {
      mismatches.push(`Barrier '${sb.id}' position mismatch: [${cb.position}] vs [${sb.position}]`);
    }
  }

  // 6. Actors & Hazards (By Stable ID)
  if (current.interactiveObjects.length !== snapshot.interactiveObjects.length) {
    mismatches.push(`Object count mismatch: ${current.interactiveObjects.length} vs ${snapshot.interactiveObjects.length}`);
  }
  const currentObjectsById = new Map<string, any>(current.interactiveObjects.map((o: any) => [o.id, o]));
  for (const so of snapshot.interactiveObjects) {
    const co = currentObjectsById.get(so.id);
    if (!co) {
      mismatches.push(`Missing restored object with stable ID '${so.id}'`);
      continue;
    }
    if (co.type !== so.type) mismatches.push(`Object '${so.id}' type mismatch: ${co.type} vs ${so.type}`);
    if (co.name !== so.name) mismatches.push(`Object '${so.id}' name mismatch: ${co.name} vs ${so.name}`);
    if (co.color !== so.color) mismatches.push(`Object '${so.id}' color mismatch: ${co.color} vs ${so.color}`);
    if (!floatEq(co.size, so.size)) mismatches.push(`Object '${so.id}' size mismatch: ${co.size} vs ${so.size}`);
    if (!strictOptionalFloatEq(co.rotation, so.rotation)) {
      mismatches.push(`Object '${so.id}' rotation mismatch: ${co.rotation} vs ${so.rotation}`);
    }
    if (!strictOptionalFloatEq(co.patrolSpeed, so.patrolSpeed)) {
      mismatches.push(`Object '${so.id}' patrolSpeed mismatch: ${co.patrolSpeed} vs ${so.patrolSpeed}`);
    }
    if (co.patrolDirection !== so.patrolDirection) {
      mismatches.push(`Object '${so.id}' patrolDirection mismatch: ${co.patrolDirection} vs ${so.patrolDirection}`);
    }
    if (!strictOptionalPoint2Eq(co.patrolStart, so.patrolStart)) {
      mismatches.push(`Object '${so.id}' patrolStart mismatch`);
    }
    if (!strictOptionalPoint2Eq(co.patrolEnd, so.patrolEnd)) {
      mismatches.push(`Object '${so.id}' patrolEnd mismatch`);
    }
    if (!strictOptionalPoint3Eq(co.position, so.position)) {
      mismatches.push(`Object '${so.id}' position mismatch: [${co.position}] vs [${so.position}]`);
    }
    if (co.velocity && (co.velocity[0] !== 0 || co.velocity[1] !== 0 || co.velocity[2] !== 0)) {
      mismatches.push(`Object '${so.id}' velocity not zeroed under recovery policy: [${co.velocity}]`);
    }
  }

  // 7. Mission Configuration & Structural Metadata
  if (current.selectedDestinationId !== snapshot.selectedDestinationId) {
    mismatches.push(`Destination mismatch: ${current.selectedDestinationId} vs ${snapshot.selectedDestinationId}`);
  }
  if (current.difficulty !== snapshot.difficulty) {
    mismatches.push(`Difficulty mismatch: ${current.difficulty} vs ${snapshot.difficulty}`);
  }
  if (current.navigationPreference !== snapshot.navigationPreference) {
    mismatches.push(`Preference mismatch: ${current.navigationPreference} vs ${snapshot.navigationPreference}`);
  }
  if (current.activeScenarioId !== snapshot.activeScenarioId) {
    mismatches.push(`Scenario ID mismatch: ${current.activeScenarioId} vs ${snapshot.activeScenarioId}`);
  }
  if (!deepStructuralEqual(current.activeScenarioMetadata, snapshot.activeScenarioMetadata)) {
    mismatches.push("activeScenarioMetadata structural mismatch");
  }
  if (current.isEmergencyStopped !== snapshot.isEmergencyStopped) {
    mismatches.push(`Emergency stop mismatch: ${current.isEmergencyStopped} vs ${snapshot.isEmergencyStopped}`);
  }
  if (current.navState !== snapshot.navState) {
    mismatches.push(`navState mismatch: ${current.navState} vs ${snapshot.navState}`);
  }

  // 8. Mission Metrics (All 8 Fields)
  const sm = snapshot.missionMetrics;
  const cm = current.missionMetrics;
  if (cm.missionStatus !== sm.missionStatus) mismatches.push(`missionStatus mismatch: ${cm.missionStatus} vs ${sm.missionStatus}`);
  if (!floatEq(cm.missionTime, sm.missionTime)) mismatches.push(`missionTime mismatch: ${cm.missionTime} vs ${sm.missionTime}`);
  if (!floatEq(cm.distanceTravelled, sm.distanceTravelled)) mismatches.push(`distanceTravelled mismatch: ${cm.distanceTravelled} vs ${sm.distanceTravelled}`);
  if (cm.obstaclesDetected !== sm.obstaclesDetected) mismatches.push(`obstaclesDetected mismatch: ${cm.obstaclesDetected} vs ${sm.obstaclesDetected}`);
  if (cm.replanCount !== sm.replanCount) mismatches.push(`replanCount mismatch: ${cm.replanCount} vs ${sm.replanCount}`);
  if (!floatEq(cm.timeStopped, sm.timeStopped)) mismatches.push(`timeStopped mismatch: ${cm.timeStopped} vs ${sm.timeStopped}`);
  if (cm.collisions !== sm.collisions) mismatches.push(`collisions mismatch: ${cm.collisions} vs ${sm.collisions}`);
  if (cm.nearMisses !== sm.nearMisses) mismatches.push(`nearMisses mismatch: ${cm.nearMisses} vs ${sm.nearMisses}`);

  // 9. Actual Trajectory
  if (current.actualTrajectory.length !== snapshot.actualTrajectory.length) {
    mismatches.push(`Trajectory length mismatch: ${current.actualTrajectory.length} vs ${snapshot.actualTrajectory.length}`);
  } else {
    for (let i = 0; i < snapshot.actualTrajectory.length; i++) {
      if (!strictOptionalPoint3Eq(current.actualTrajectory[i], snapshot.actualTrajectory[i])) {
        mismatches.push(`Trajectory point ${i} mismatch`);
        break;
      }
    }
  }

  // 10. Navigation Diagnostics (All 14 Properties)
  const cd = current.diagnostics;
  const sd = snapshot.diagnostics;
  if (!strictOptionalPoint2Eq(cd.currentWaypoint, sd.currentWaypoint)) {
    mismatches.push(`diagnostics.currentWaypoint mismatch: [${cd.currentWaypoint}] vs [${sd.currentWaypoint}]`);
  }
  if (cd.currentWaypointIndex !== sd.currentWaypointIndex) {
    mismatches.push(`diagnostics.currentWaypointIndex mismatch: ${cd.currentWaypointIndex} vs ${sd.currentWaypointIndex}`);
  }
  if (cd.totalWaypoints !== sd.totalWaypoints) {
    mismatches.push(`diagnostics.totalWaypoints mismatch: ${cd.totalWaypoints} vs ${sd.totalWaypoints}`);
  }
  if (!floatEq(cd.lastMovedTime, sd.lastMovedTime)) {
    mismatches.push(`diagnostics.lastMovedTime mismatch: ${cd.lastMovedTime} vs ${sd.lastMovedTime}`);
  }
  if (!floatEq(cd.timeStopped, sd.timeStopped)) {
    mismatches.push(`diagnostics.timeStopped mismatch: ${cd.timeStopped} vs ${sd.timeStopped}`);
  }
  if (!strictOptionalPoint2Eq(cd.obstaclePosition, sd.obstaclePosition)) {
    mismatches.push(`diagnostics.obstaclePosition mismatch: [${cd.obstaclePosition}] vs [${sd.obstaclePosition}]`);
  }
  if (!strictOptionalStringEq(cd.obstacleName, sd.obstacleName)) {
    mismatches.push(`diagnostics.obstacleName mismatch: '${cd.obstacleName}' vs '${sd.obstacleName}'`);
  }
  if (cd.routeValidity !== sd.routeValidity) {
    mismatches.push(`diagnostics.routeValidity mismatch: ${cd.routeValidity} vs ${sd.routeValidity}`);
  }
  if (cd.replanReason !== sd.replanReason) {
    mismatches.push(`diagnostics.replanReason mismatch: '${cd.replanReason}' vs '${sd.replanReason}'`);
  }
  if (cd.routeDiffers !== sd.routeDiffers) {
    mismatches.push(`diagnostics.routeDiffers mismatch: ${cd.routeDiffers} vs ${sd.routeDiffers}`);
  }
  if (!strictOptionalStringEq(cd.failureExplanation, sd.failureExplanation)) {
    mismatches.push(`diagnostics.failureExplanation mismatch: '${cd.failureExplanation}' vs '${sd.failureExplanation}'`);
  }
  if (!strictOptionalFloatEq(cd.stoppingDistance, sd.stoppingDistance)) {
    mismatches.push(`diagnostics.stoppingDistance mismatch: ${cd.stoppingDistance} vs ${sd.stoppingDistance}`);
  }
  if (!strictOptionalFloatEq(cd.availableClearance, sd.availableClearance)) {
    mismatches.push(`diagnostics.availableClearance mismatch: ${cd.availableClearance} vs ${sd.availableClearance}`);
  }
  if (cd.brakingStatus !== sd.brakingStatus) {
    mismatches.push(`diagnostics.brakingStatus mismatch: ${cd.brakingStatus} vs ${sd.brakingStatus}`);
  }

  return {
    passed: mismatches.length === 0,
    mismatches,
  };
}
