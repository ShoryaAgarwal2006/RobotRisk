/**
 * Physics Mount Registry
 * ROBOTRISK AI — PHASE 5.5C
 * 
 * Race-safe Rapier rigid body & collider mounting verification.
 * Tracks live body references, attachment status of originally registered colliders,
 * and handles multi-registration component remount lifecycles.
 */

import { RapierRigidBody } from '@react-three/rapier';
import { Collider } from '@dimforge/rapier3d-compat';

export interface RegisteredColliderRef {
  handle: number;
  collider: Collider;
}

export interface ActiveRegistration {
  entityId: string;
  transactionToken: string;
  bodyHandle: number;
  rigidBody: RapierRigidBody;
  registeredColliders: RegisteredColliderRef[];
  mountSequence: number;
  mountedAt: number;
}

let globalMountSequence = 0;

export class PhysicsMountRegistry {
  // Key: `${transactionToken}::${entityId}` -> Map<bodyHandle, ActiveRegistration>
  private entityHandleMap = new Map<string, Map<number, ActiveRegistration>>();

  private getGroupKey(token: string, entityId: string): string {
    return `${token}::${entityId}`;
  }

  public register(payload: {
    entityId: string;
    transactionToken: string;
    rigidBody: RapierRigidBody;
  }): void {
    const { entityId, transactionToken, rigidBody } = payload;
    if (!rigidBody || !rigidBody.isValid()) return;

    const bodyHandle = rigidBody.handle;
    const numColliders = rigidBody.numColliders ? rigidBody.numColliders() : 0;
    const registeredColliders: RegisteredColliderRef[] = [];

    for (let i = 0; i < numColliders; i++) {
      const col = rigidBody.collider(i);
      if (col && col.isValid()) {
        registeredColliders.push({ handle: col.handle, collider: col });
      }
    }

    const groupKey = this.getGroupKey(transactionToken, entityId);
    let handleMap = this.entityHandleMap.get(groupKey);
    if (!handleMap) {
      handleMap = new Map<number, ActiveRegistration>();
      this.entityHandleMap.set(groupKey, handleMap);
    }

    handleMap.set(bodyHandle, {
      entityId,
      transactionToken,
      bodyHandle,
      rigidBody,
      registeredColliders,
      mountSequence: ++globalMountSequence,
      mountedAt: performance.now(),
    });
  }

  public unregister(payload: {
    entityId: string;
    transactionToken: string;
    bodyHandle: number;
  }): void {
    const { entityId, transactionToken, bodyHandle } = payload;
    const groupKey = this.getGroupKey(transactionToken, entityId);
    const handleMap = this.entityHandleMap.get(groupKey);
    if (handleMap) {
      handleMap.delete(bodyHandle);
      if (handleMap.size === 0) {
        this.entityHandleMap.delete(groupKey);
      }
    }
  }

  /**
   * Deterministically validates whether an entity is currently mounted and physically valid.
   * If multiple registrations exist (e.g. from React remounts), evaluates the latest live registration.
   */
  public isEntityValid(
    expectedToken: string,
    entityId: string,
    minColliders: number
  ): boolean {
    const groupKey = this.getGroupKey(expectedToken, entityId);
    const handleMap = this.entityHandleMap.get(groupKey);
    if (!handleMap || handleMap.size === 0) {
      return false;
    }

    // Sort registrations by sequence descending (newest first)
    const registrations = Array.from(handleMap.values()).sort(
      (a, b) => b.mountSequence - a.mountSequence
    );

    // Evaluate newest registration
    const current = registrations[0];
    if (!current.rigidBody || !current.rigidBody.isValid() || current.rigidBody.handle !== current.bodyHandle) {
      return false;
    }

    const liveCount = current.rigidBody.numColliders ? current.rigidBody.numColliders() : 0;
    if (liveCount < minColliders || current.registeredColliders.length < minColliders) {
      return false;
    }

    // Check all currently attached active colliders on this rigid body
    const activeAttachedHandles = new Set<number>();
    for (let i = 0; i < liveCount; i++) {
      const col = current.rigidBody.collider(i);
      if (col && col.isValid()) {
        activeAttachedHandles.add(col.handle);
      }
    }

    // Verify that every originally registered collider remains live and attached
    for (const orig of current.registeredColliders) {
      if (!orig.collider || !orig.collider.isValid() || orig.collider.handle !== orig.handle) {
        return false;
      }
      if (!activeAttachedHandles.has(orig.handle)) {
        return false; // Collider detached or replaced
      }
    }

    return true;
  }

  public async waitForPhysicsMount(
    expectedToken: string,
    expectedEntities: Array<{ id: string; minColliders: number }>,
    timeoutMs: number = 2000
  ): Promise<void> {
    const start = performance.now();
    return new Promise((resolve, reject) => {
      const scheduleNext =
        typeof requestAnimationFrame !== 'undefined'
          ? requestAnimationFrame
          : (cb: () => void) => setTimeout(cb, 16);

      const poll = () => {
        const missing = expectedEntities.filter(
          (e) => !this.isEntityValid(expectedToken, e.id, e.minColliders)
        );
        if (missing.length === 0) {
          resolve();
          return;
        }
        if (performance.now() - start > timeoutMs) {
          reject(
            new Error(
              `Physics mount timeout after ${timeoutMs}ms for transaction ${expectedToken}. Missing: ` +
              missing.map((m) => m.id).join(', ')
            )
          );
          return;
        }
        scheduleNext(poll);
      };
      poll();
    });
  }

  public async waitForAllMounted(
    expectedToken: string,
    expectedEntityIds: string[],
    timeoutMs: number = 2000
  ): Promise<void> {
    const expectedEntities = expectedEntityIds.map((id) => ({ id, minColliders: 1 }));
    return this.waitForPhysicsMount(expectedToken, expectedEntities, timeoutMs);
  }

  public clear(): void {
    this.entityHandleMap.clear();
  }
}

export const physicsMountRegistry = new PhysicsMountRegistry();
