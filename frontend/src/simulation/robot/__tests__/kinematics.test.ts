import { describe, it, expect } from 'vitest';

describe('Differential Drive Kinematics', () => {
  const trackWidth = 0.54; // meters
  const wheelRadius = 0.14; // meters

  it('calculates left and right wheel velocities accurately', () => {
    const v = 2.0; // 2 m/s forward
    const omega = 1.0; // 1 rad/s turning left

    const vLeft = v - (trackWidth / 2) * omega;
    const vRight = v + (trackWidth / 2) * omega;

    expect(vLeft).toBeCloseTo(1.73, 2);
    expect(vRight).toBeCloseTo(2.27, 2);

    // Wheel angular speed = v / r
    const rotSpeedLeft = vLeft / wheelRadius;
    const rotSpeedRight = vRight / wheelRadius;
    expect(rotSpeedLeft).toBeCloseTo(12.36, 2);
    expect(rotSpeedRight).toBeCloseTo(16.21, 2);
  });

  it('computes forward world velocity vectors from yaw angle', () => {
    const speed = 3.0; // m/s

    // Case 1: Heading North (yaw = 0 rad, +Z forward)
    let yaw = 0;
    let vx = speed * Math.sin(yaw);
    let vz = speed * Math.cos(yaw);
    expect(vx).toBeCloseTo(0, 4);
    expect(vz).toBeCloseTo(3.0, 4);

    // Case 2: Heading West / Left (yaw = +PI/2, +X forward)
    yaw = Math.PI / 2;
    vx = speed * Math.sin(yaw);
    vz = speed * Math.cos(yaw);
    expect(vx).toBeCloseTo(3.0, 4);
    expect(vz).toBeCloseTo(0, 4);

    // Case 3: Heading South / Backwards (yaw = PI, -Z forward)
    yaw = Math.PI;
    vx = speed * Math.sin(yaw);
    vz = speed * Math.cos(yaw);
    expect(vx).toBeCloseTo(0, 4);
    expect(vz).toBeCloseTo(-3.0, 4);
  });

  it('clamps acceleration and handles emergency braking rate', () => {
    const normalAccel = 6.0;
    const emergencyBrakingRate = normalAccel * 3.0; // 18.0 m/s²
    const dt = 0.1; // 100 ms

    let currentV = 3.0; // Moving fast
    const targetV = 0.0; // Emergency Stop

    // Deceleration step
    currentV = Math.max(targetV, currentV - emergencyBrakingRate * dt);
    expect(currentV).toBeCloseTo(1.2, 2);

    // Next step halts completely
    currentV = Math.max(targetV, currentV - emergencyBrakingRate * dt);
    expect(currentV).toBe(0.0);
  });

  it('converts yaw radians to compass degrees correctly', () => {
    const toDegrees = (rad: number) => {
      let deg = (rad * 180) / Math.PI;
      return ((deg % 360) + 360) % 360;
    };

    expect(toDegrees(0)).toBe(0);
    expect(toDegrees(Math.PI / 2)).toBe(90);
    expect(toDegrees(Math.PI)).toBe(180);
    expect(toDegrees(-Math.PI / 2)).toBe(270);
  });
});
