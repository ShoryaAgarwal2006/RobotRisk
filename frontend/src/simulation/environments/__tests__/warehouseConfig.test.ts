import { describe, it, expect } from 'vitest';
import { WAREHOUSE_CONFIG } from '../warehouseConfig';

describe('Warehouse Environment Configuration & Spatial Layout', () => {
  const { width, length, wallHeight, robotSpawn, deliveryDestination, chargingStation, aisles, zones } =
    WAREHOUSE_CONFIG;

  it('defines valid warehouse boundaries', () => {
    expect(width).toBe(40);
    expect(length).toBe(32);
    expect(wallHeight).toBeGreaterThanOrEqual(4.0);
  });

  it('places robot spawn position safely inside warehouse bounds', () => {
    const [sx, sy, sz] = robotSpawn.position;
    const halfW = width / 2;
    const halfL = length / 2;

    expect(sx).toBeGreaterThan(-halfW + 1.0);
    expect(sx).toBeLessThan(halfW - 1.0);
    expect(sz).toBeGreaterThan(-halfL + 1.0);
    expect(sz).toBeLessThan(halfL - 1.0);
    expect(sy).toBeGreaterThanOrEqual(0.1); // Above ground
  });

  it('places delivery destination inside bounds with ample clearance', () => {
    const [dx, , dz] = deliveryDestination.position;
    const halfW = width / 2;
    const halfL = length / 2;

    expect(dx).toBeGreaterThan(-halfW + 1.0);
    expect(dx).toBeLessThan(halfW - 1.0);
    expect(dz).toBeGreaterThan(-halfL + 1.0);
    expect(dz).toBeLessThan(halfL - 1.0);
    expect(deliveryDestination.radius).toBeGreaterThan(1.5);
  });

  it('ensures charging dock and delivery destination are at distinct locations', () => {
    const [cx, , cz] = chargingStation.position;
    const [dx, , dz] = deliveryDestination.position;

    const dist = Math.hypot(dx - cx, dz - cz);
    expect(dist).toBeGreaterThan(15.0); // At opposite ends of the warehouse
  });

  it('ensures all transit corridors and aisles have sufficient AMR clearance (>= 2.5m)', () => {
    const robotWidth = 0.6; // AMR width

    aisles.forEach((aisle) => {
      expect(aisle.width).toBeGreaterThanOrEqual(2.5);
      expect(aisle.width).toBeGreaterThan(robotWidth * 3.0); // At least 3x robot width
    });
  });

  it('validates all designated operational zones', () => {
    expect(zones.length).toBeGreaterThanOrEqual(4);

    const types = zones.map((z) => z.type);
    expect(types).toContain('charging');
    expect(types).toContain('loading');
    expect(types).toContain('delivery');
    expect(types).toContain('storage');

    zones.forEach((z) => {
      expect(z.bounds.maxX).toBeGreaterThan(z.bounds.minX);
      expect(z.bounds.maxZ).toBeGreaterThan(z.bounds.minZ);
    });
  });
});
