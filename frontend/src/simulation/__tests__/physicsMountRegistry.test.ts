import { describe, it, expect, beforeEach } from 'vitest';
import { PhysicsMountRegistry } from '../PhysicsMountRegistry';
import { RapierRigidBody } from '@react-three/rapier';
import { Collider } from '@dimforge/rapier3d-compat';

describe('PhysicsMountRegistry Multi-Registration & Race Safety', () => {
  let registry: PhysicsMountRegistry;

  beforeEach(() => {
    registry = new PhysicsMountRegistry();
  });

  const createMockCollider = (handle: number, isValid = true): Collider => {
    return {
      handle,
      isValid: () => isValid,
    } as unknown as Collider;
  };

  const createMockRigidBody = (
    handle: number,
    colliders: Collider[],
    isValid = true
  ): RapierRigidBody => {
    return {
      handle,
      isValid: () => isValid,
      numColliders: () => colliders.length,
      collider: (i: number) => colliders[i],
    } as unknown as RapierRigidBody;
  };

  it('registers and validates a live entity with valid colliders', () => {
    const col1 = createMockCollider(101, true);
    const rb = createMockRigidBody(1, [col1], true);

    registry.register({
      transactionToken: 'tx-1',
      entityId: 'forklift-1',
      rigidBody: rb,
    });

    expect(registry.isEntityValid('tx-1', 'forklift-1', 1)).toBe(true);
  });

  it('rejects entity if rigid body isValid() is false', () => {
    const col1 = createMockCollider(101, true);
    const rb = createMockRigidBody(1, [col1], false); // Invalid body

    registry.register({
      transactionToken: 'tx-1',
      entityId: 'forklift-1',
      rigidBody: rb,
    });

    expect(registry.isEntityValid('tx-1', 'forklift-1', 1)).toBe(false);
  });

  it('rejects entity if attached collider isValid() is false', () => {
    const col1 = createMockCollider(101, false); // Invalid collider
    const rb = createMockRigidBody(1, [col1], true);

    registry.register({
      transactionToken: 'tx-1',
      entityId: 'forklift-1',
      rigidBody: rb,
    });

    expect(registry.isEntityValid('tx-1', 'forklift-1', 1)).toBe(false);
  });

  it('detects collider detachment or replacement', () => {
    const originalCol = createMockCollider(101, true);
    const activeColliders = [originalCol];
    const rb = {
      handle: 1,
      isValid: () => true,
      numColliders: () => activeColliders.length,
      collider: (i: number) => activeColliders[i],
    } as unknown as RapierRigidBody;

    registry.register({
      transactionToken: 'tx-1',
      entityId: 'forklift-1',
      rigidBody: rb,
    });
    expect(registry.isEntityValid('tx-1', 'forklift-1', 1)).toBe(true);

    // Simulate collider being replaced on the live body by a new collider
    activeColliders[0] = createMockCollider(999, true);
    expect(registry.isEntityValid('tx-1', 'forklift-1', 1)).toBe(false);
  });

  it('handles React remount: newer valid registration supersedes older registration', () => {
    const colOld = createMockCollider(101, false); // Old became invalid
    const rbOld = createMockRigidBody(1, [colOld], false);

    const colNew = createMockCollider(201, true); // New remount is valid
    const rbNew = createMockRigidBody(2, [colNew], true);

    // 1. Old registration mounts
    registry.register({
      transactionToken: 'tx-1',
      entityId: 'worker-1',
      rigidBody: rbOld,
    });

    // 2. Component remounts and registers new valid body
    registry.register({
      transactionToken: 'tx-1',
      entityId: 'worker-1',
      rigidBody: rbNew,
    });

    // Evaluates latest registration (rbNew)
    expect(registry.isEntityValid('tx-1', 'worker-1', 1)).toBe(true);
  });

  it('delayed unmount cleanup from old component does NOT evict newer registration', () => {
    const colOld = createMockCollider(101, true);
    const rbOld = createMockRigidBody(1, [colOld], true);

    const colNew = createMockCollider(201, true);
    const rbNew = createMockRigidBody(2, [colNew], true);

    registry.register({
      transactionToken: 'tx-1',
      entityId: 'barrier-1',
      rigidBody: rbOld,
    });

    registry.register({
      transactionToken: 'tx-1',
      entityId: 'barrier-1',
      rigidBody: rbNew,
    });

    // Delayed cleanup from old component fires with bodyHandle 1
    registry.unregister({
      transactionToken: 'tx-1',
      entityId: 'barrier-1',
      bodyHandle: 1,
    });

    // rbNew (handle 2) must still be registered and valid
    expect(registry.isEntityValid('tx-1', 'barrier-1', 1)).toBe(true);
  });

  it('waitForAllMounted resolves when all expected entities mount', async () => {
    const col1 = createMockCollider(101, true);
    const rb1 = createMockRigidBody(1, [col1], true);
    const col2 = createMockCollider(102, true);
    const rb2 = createMockRigidBody(2, [col2], true);

    // Mount entity 1 immediately
    registry.register({
      transactionToken: 'tx-mount',
      entityId: 'e-1',
      rigidBody: rb1,
    });

    // Mount entity 2 asynchronously after 50ms
    setTimeout(() => {
      registry.register({
        transactionToken: 'tx-mount',
        entityId: 'e-2',
        rigidBody: rb2,
      });
    }, 50);

    await expect(
      registry.waitForAllMounted('tx-mount', ['e-1', 'e-2'], 500)
    ).resolves.toBeUndefined();
  });

  it('waitForAllMounted times out if an expected entity fails to mount', async () => {
    const col1 = createMockCollider(101, true);
    const rb1 = createMockRigidBody(1, [col1], true);

    registry.register({
      transactionToken: 'tx-timeout',
      entityId: 'e-1',
      rigidBody: rb1,
    });

    // e-2 never mounts
    await expect(
      registry.waitForAllMounted('tx-timeout', ['e-1', 'e-2'], 100)
    ).rejects.toThrow(/Physics mount timeout.*Missing: e-2/);
  });
});
