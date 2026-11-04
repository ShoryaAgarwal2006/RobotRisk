import { describe, it, expect, beforeEach } from 'vitest';
import { useSimulationStore } from '../useSimulationStore';

describe('useSimulationStore', () => {
  beforeEach(() => {
    // Reset to defaults
    useSimulationStore.setState({
      mode: 'manual',
      isRunning: true,
      timeScale: 1.0,
      currentTime: 0,
      cameraView: 'follow',
      backendStatus: 'checking',
      backendInfo: null,
      interactiveObjects: [],
      eventLog: [],
      robotPose: {
        position: [-14.5, 0.22, -10.5],
        rotation: 0,
        linearVelocity: 0,
        angularVelocity: 0,
      },
      robotStatus: {
        battery: 100,
        isEmergencyStopped: false,
        collisionCount: 0,
        lastCollisionForce: 0,
      },
      needsResetPose: false,
    });
  });

  it('initializes with default values and follow camera', () => {
    const state = useSimulationStore.getState();
    expect(state.mode).toBe('manual');
    expect(state.isRunning).toBe(true);
    expect(state.timeScale).toBe(1.0);
    expect(state.currentTime).toBe(0);
    expect(state.cameraView).toBe('follow');
    expect(state.robotPose.position).toEqual([-14.5, 0.22, -10.5]);
    expect(state.robotStatus.isEmergencyStopped).toBe(false);
  });

  it('updates robot pose accurately', () => {
    const { updateRobotPose } = useSimulationStore.getState();
    updateRobotPose([2.5, 0.22, -4.1], 1.57, 2.0, 0.5);

    const state = useSimulationStore.getState();
    expect(state.robotPose.position).toEqual([2.5, 0.22, -4.1]);
    expect(state.robotPose.rotation).toBeCloseTo(1.57, 2);
    expect(state.robotPose.linearVelocity).toBe(2.0);
    expect(state.robotPose.angularVelocity).toBe(0.5);
  });

  it('preserves robot pose and state across mode switches', () => {
    const { updateRobotPose, setMode } = useSimulationStore.getState();
    updateRobotPose([5.0, 0.22, 10.0], 3.14, 1.2, 0.0);

    // Switch to autonomous mode
    setMode('autonomous');
    let state = useSimulationStore.getState();
    expect(state.mode).toBe('autonomous');
    expect(state.robotPose.position).toEqual([5.0, 0.22, 10.0]);
    expect(state.robotPose.rotation).toBeCloseTo(3.14, 2);

    // Switch to AI Command Center
    setMode('ai_command');
    state = useSimulationStore.getState();
    expect(state.mode).toBe('ai_command');
    expect(state.robotPose.position).toEqual([5.0, 0.22, 10.0]);

    // Switch back to manual
    setMode('manual');
    state = useSimulationStore.getState();
    expect(state.mode).toBe('manual');
    expect(state.robotPose.position).toEqual([5.0, 0.22, 10.0]);
  });

  it('handles emergency stop toggle and state', () => {
    const { toggleEmergencyStop, setEmergencyStop } = useSimulationStore.getState();

    expect(useSimulationStore.getState().robotStatus.isEmergencyStopped).toBe(false);

    toggleEmergencyStop();
    expect(useSimulationStore.getState().robotStatus.isEmergencyStopped).toBe(true);

    toggleEmergencyStop();
    expect(useSimulationStore.getState().robotStatus.isEmergencyStopped).toBe(false);

    setEmergencyStop(true);
    expect(useSimulationStore.getState().robotStatus.isEmergencyStopped).toBe(true);
  });

  it('drains battery dynamically during motion', () => {
    const { updateRobotPose, tick } = useSimulationStore.getState();

    // Robot moving at 2 m/s
    updateRobotPose([0, 0, 0], 0, 2.0, 0);

    // Simulate 10 seconds of motion
    tick(10.0);
    expect(useSimulationStore.getState().robotStatus.battery).toBeLessThan(100);
    expect(useSimulationStore.getState().robotStatus.battery).toBeGreaterThan(95);
  });

  it('resets robot pose and clears emergency stop', () => {
    const { updateRobotPose, setEmergencyStop, resetRobotPose, acknowledgeResetPose } =
      useSimulationStore.getState();

    updateRobotPose([12, 0.22, -8], 2.2, 3.0, 1.0);
    setEmergencyStop(true);

    resetRobotPose([0, 0.22, 0], 0);

    const state = useSimulationStore.getState();
    expect(state.needsResetPose).toBe(true);
    expect(state.robotPose.position).toEqual([0, 0.22, 0]);
    expect(state.robotPose.linearVelocity).toBe(0);
    expect(state.robotStatus.isEmergencyStopped).toBe(false);

    acknowledgeResetPose();
    expect(useSimulationStore.getState().needsResetPose).toBe(false);
  });

  it('records physical collisions and logs impact forces', () => {
    const { recordCollision } = useSimulationStore.getState();

    expect(useSimulationStore.getState().robotStatus.collisionCount).toBe(0);

    recordCollision(125.5, 'Perimeter Barrier');
    const state = useSimulationStore.getState();
    expect(state.robotStatus.collisionCount).toBe(1);
    expect(state.robotStatus.lastCollisionForce).toBe(125.5);
    expect(state.eventLog[0]).toContain('Perimeter Barrier');
  });

  it('triggers camera reset and updates trigger counter', () => {
    const { triggerResetCamera } = useSimulationStore.getState();

    expect(useSimulationStore.getState().cameraResetTrigger).toBe(0);

    triggerResetCamera();
    expect(useSimulationStore.getState().cameraResetTrigger).toBe(1);
    expect(useSimulationStore.getState().eventLog[0]).toContain('[CAMERA] Reset view angle');
  });
});
