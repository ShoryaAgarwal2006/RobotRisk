import { AisleBarrier } from '../types/simulation';

export interface GridBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface ObstacleBox {
  id?: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  name?: string;
}

export interface DynamicObstacle {
  id: string;
  x: number;
  z: number;
  radius: number;
  name?: string;
}

export class GridMap {
  readonly resolution: number; // meters per grid cell (e.g. 0.4)
  readonly bounds: GridBounds;
  readonly cols: number;
  readonly rows: number;

  // Grids: 0 = walkable, >0 = blocked
  private staticGrid: Uint8Array;
  private dynamicGrid: Uint8Array;
  private barrierGrid: Uint8Array;
  private temporaryBlockagesGrid: Uint8Array;

  // Collections of obstacles
  private physicalObstacles: ObstacleBox[] = [];
  private dynamicObstacles: Map<string, DynamicObstacle> = new Map();
  private barriers: Map<string, AisleBarrier> = new Map();
  private temporaryBlockages: Map<string, { x: number; z: number; radius: number }> = new Map();

  readonly robotRadius: number = 0.34;
  readonly safetyClearance: number = 0.20; // 20cm safety margin

  constructor(
    bounds: GridBounds = { minX: -20, maxX: 20, minZ: -16, maxZ: 16 },
    resolution: number = 0.4
  ) {
    this.bounds = bounds;
    this.resolution = resolution;
    this.cols = Math.ceil((bounds.maxX - bounds.minX) / resolution);
    this.rows = Math.ceil((bounds.maxZ - bounds.minZ) / resolution);

    this.staticGrid = new Uint8Array(this.cols * this.rows);
    this.dynamicGrid = new Uint8Array(this.cols * this.rows);
    this.barrierGrid = new Uint8Array(this.cols * this.rows);
    this.temporaryBlockagesGrid = new Uint8Array(this.cols * this.rows);

    this.initializeStaticWarehouseObstacles();
  }

  // Convert world coordinate (x, z) to grid indices (gx, gz)
  worldToGrid(x: number, z: number): [number, number] {
    const gx = Math.floor((x - this.bounds.minX) / this.resolution);
    const gz = Math.floor((z - this.bounds.minZ) / this.resolution);
    return [
      Math.max(0, Math.min(this.cols - 1, gx)),
      Math.max(0, Math.min(this.rows - 1, gz)),
    ];
  }

  // Convert grid indices (gx, gz) to world center coordinate (x, z)
  gridToWorld(gx: number, gz: number): [number, number] {
    const x = this.bounds.minX + (gx + 0.5) * this.resolution;
    const z = this.bounds.minZ + (gz + 0.5) * this.resolution;
    return [x, z];
  }

  isValidGrid(gx: number, gz: number): boolean {
    return gx >= 0 && gx < this.cols && gz >= 0 && gz < this.rows;
  }

  isWalkable(gx: number, gz: number): boolean {
    if (!this.isValidGrid(gx, gz)) return false;
    const idx = gz * this.cols + gx;
    return (
      this.staticGrid[idx] === 0 &&
      this.dynamicGrid[idx] === 0 &&
      this.barrierGrid[idx] === 0 &&
      this.temporaryBlockagesGrid[idx] === 0
    );
  }

  isWorldWalkable(x: number, z: number): boolean {
    const [gx, gz] = this.worldToGrid(x, z);
    return this.isWalkable(gx, gz);
  }

  // Checks if a world position is inside any physical uninflated obstacle box
  isPhysicalObstacle(x: number, z: number): boolean {
    for (const box of this.physicalObstacles) {
      if (x >= box.minX && x <= box.maxX && z >= box.minZ && z <= box.maxZ) {
        return true;
      }
    }

    // Check active aisle barriers
    for (const barrier of this.barriers.values()) {
      const halfW = barrier.width / 2;
      const halfD = barrier.depth / 2;
      // Approximate axis-aligned bounding box or rotated check
      const cos = Math.cos(-barrier.rotation);
      const sin = Math.sin(-barrier.rotation);
      const dx = x - barrier.position[0];
      const dz = z - barrier.position[2];
      const localX = cos * dx - sin * dz;
      const localZ = sin * dx + cos * dz;
      if (Math.abs(localX) <= halfW && Math.abs(localZ) <= halfD) {
        return true;
      }
    }

    return false;
  }

  getPhysicalObstacles(): ObstacleBox[] {
    return this.physicalObstacles;
  }

  // Mark a rectangular obstacle region with inflation (robot radius + clearance)
  markObstacleBox(box: ObstacleBox, customInflation?: number) {
    this.physicalObstacles.push(box);

    const inflation =
      customInflation !== undefined
        ? customInflation
        : this.robotRadius + this.safetyClearance;

    const minX = box.minX - inflation;
    const maxX = box.maxX + inflation;
    const minZ = box.minZ - inflation;
    const maxZ = box.maxZ + inflation;

    const [startGx, startGz] = this.worldToGrid(minX, minZ);
    const [endGx, endGz] = this.worldToGrid(maxX, maxZ);

    for (let gz = startGz; gz <= endGz; gz++) {
      for (let gx = startGx; gx <= endGx; gx++) {
        if (this.isValidGrid(gx, gz)) {
          this.staticGrid[gz * this.cols + gx] = 1;
        }
      }
    }
  }

  // Initialize all known static warehouse obstacles
  private initializeStaticWarehouseObstacles() {
    this.physicalObstacles = [];

    // 1. Perimeter Walls & Outer Margin
    this.markObstacleBox({ minX: -20, maxX: 20, minZ: -16.5, maxZ: -15.2, name: 'North Wall' }, 0.1);
    this.markObstacleBox({ minX: -20, maxX: 20, minZ: 15.2, maxZ: 16.5, name: 'South Wall' }, 0.1);
    this.markObstacleBox({ minX: -20.5, maxX: -19.2, minZ: -16, maxZ: 16, name: 'West Wall' }, 0.1);
    this.markObstacleBox({ minX: 19.2, maxX: 20.5, minZ: -16, maxZ: 16, name: 'East Wall' }, 0.1);

    // 2. Storage Racks (4 Double-Bay Rows)
    const rackRows = [
      { x: -9.75, name: 'Row D' },
      { x: -3.25, name: 'Row A' },
      { x: 3.25, name: 'Row B' },
      { x: 9.75, name: 'Row C' },
    ];

    rackRows.forEach((row) => {
      // North Section: center Z = -4.5, Z in [-7.75, -1.25]
      this.markObstacleBox({
        minX: row.x - 0.7,
        maxX: row.x + 0.7,
        minZ: -7.75,
        maxZ: -1.25,
        name: `${row.name} North Rack`,
      });

      // South Section: center Z = 4.5, Z in [1.25, 7.75]
      this.markObstacleBox({
        minX: row.x - 0.7,
        maxX: row.x + 0.7,
        minZ: 1.25,
        maxZ: 7.75,
        name: `${row.name} South Rack`,
      });
    });

    // 3. Charging Dock Backstop at [-15.5, -11.5]
    this.markObstacleBox({
      minX: -16.2,
      maxX: -14.8,
      minZ: -12.4,
      maxZ: -11.6,
      name: 'Charging Dock Backstop',
    });

    // 4. Staging Pallet Stacks (West wall staging and North perimeter)
    this.markObstacleBox({ minX: -18.0, maxX: -16.4, minZ: 1.2, maxZ: 6.8, name: 'West Staging Pallets' });
    this.markObstacleBox({ minX: 16.4, maxX: 18.0, minZ: -5.8, maxZ: -2.2, name: 'East Staging Pallets' });
    this.markObstacleBox({ minX: -3.9, maxX: -2.6, minZ: -14.2, maxZ: -12.8, name: 'North Pallet Bay A' });
    this.markObstacleBox({ minX: 2.6, maxX: 3.9, minZ: -14.2, maxZ: -12.8, name: 'North Pallet Bay B' });
  }

  // Dynamic Obstacle Management
  addDynamicObstacle(obstacle: DynamicObstacle) {
    this.dynamicObstacles.set(obstacle.id, obstacle);
    this.rebuildDynamicGrid();
  }

  removeDynamicObstacle(id: string) {
    if (this.dynamicObstacles.delete(id)) {
      this.rebuildDynamicGrid();
    }
  }

  clearDynamicObstacles() {
    this.dynamicObstacles.clear();
    this.dynamicGrid.fill(0);
  }

  private rebuildDynamicGrid() {
    this.dynamicGrid.fill(0);
    const inflation = this.robotRadius + this.safetyClearance;

    this.dynamicObstacles.forEach((obs) => {
      const radius = obs.radius + inflation;
      const [startGx, startGz] = this.worldToGrid(obs.x - radius, obs.z - radius);
      const [endGx, endGz] = this.worldToGrid(obs.x + radius, obs.z + radius);

      for (let gz = startGz; gz <= endGz; gz++) {
        for (let gx = startGx; gx <= endGx; gx++) {
          if (this.isValidGrid(gx, gz)) {
            const [wx, wz] = this.gridToWorld(gx, gz);
            const distSq = (wx - obs.x) ** 2 + (wz - obs.z) ** 2;
            if (distSq <= radius * radius) {
              this.dynamicGrid[gz * this.cols + gx] = 2;
            }
          }
        }
      }
    });
  }

  // Aisle Barrier Management
  addBarrier(barrier: AisleBarrier) {
    this.barriers.set(barrier.id, barrier);
    this.rebuildBarrierGrid();
  }

  removeBarrier(barrierId: string) {
    if (this.barriers.delete(barrierId)) {
      this.rebuildBarrierGrid();
    }
  }

  clearBarriers() {
    this.barriers.clear();
    this.barrierGrid.fill(0);
  }

  getBarriers(): AisleBarrier[] {
    return Array.from(this.barriers.values());
  }

  private rebuildBarrierGrid() {
    this.barrierGrid.fill(0);
    const inflation = this.robotRadius + this.safetyClearance;

    this.barriers.forEach((barrier) => {
      // Barrier box in world coords with inflation
      const halfW = barrier.width / 2 + inflation;
      const halfD = barrier.depth / 2 + inflation;

      // Handle orientation (horizontal or vertical)
      const isRotated = Math.abs(Math.sin(barrier.rotation)) > 0.5;
      const spanX = isRotated ? halfD : halfW;
      const spanZ = isRotated ? halfW : halfD;

      const minX = barrier.position[0] - spanX;
      const maxX = barrier.position[0] + spanX;
      const minZ = barrier.position[2] - spanZ;
      const maxZ = barrier.position[2] + spanZ;

      const [startGx, startGz] = this.worldToGrid(minX, minZ);
      const [endGx, endGz] = this.worldToGrid(maxX, maxZ);

      for (let gz = startGz; gz <= endGz; gz++) {
        for (let gx = startGx; gx <= endGx; gx++) {
          if (this.isValidGrid(gx, gz)) {
            this.barrierGrid[gz * this.cols + gx] = 3;
          }
        }
      }
    });
  }

  // Temporary Blockages (for intelligent stuck detection & rerouting)
  addTemporaryBlockage(id: string, x: number, z: number, radius: number = 0.8) {
    this.temporaryBlockages.set(id, { x, z, radius });
    this.rebuildTemporaryBlockages();
  }

  clearTemporaryBlockages() {
    this.temporaryBlockages.clear();
    this.temporaryBlockagesGrid.fill(0);
  }

  private rebuildTemporaryBlockages() {
    this.temporaryBlockagesGrid.fill(0);
    const inflation = this.robotRadius + this.safetyClearance;

    this.temporaryBlockages.forEach((b) => {
      const radius = b.radius + inflation;
      const [startGx, startGz] = this.worldToGrid(b.x - radius, b.z - radius);
      const [endGx, endGz] = this.worldToGrid(b.x + radius, b.z + radius);

      for (let gz = startGz; gz <= endGz; gz++) {
        for (let gx = startGx; gx <= endGx; gx++) {
          if (this.isValidGrid(gx, gz)) {
            const [wx, wz] = this.gridToWorld(gx, gz);
            const distSq = (wx - b.x) ** 2 + (wz - b.z) ** 2;
            if (distSq <= radius * radius) {
              this.temporaryBlockagesGrid[gz * this.cols + gx] = 4;
            }
          }
        }
      }
    });
  }

  // Check if line of sight is clear, including corridor padding
  hasLineOfSight(
    x0: number,
    z0: number,
    x1: number,
    z1: number,
    corridorPadding: number = 0.22
  ): boolean {
    const dist = Math.hypot(x1 - x0, z1 - z0);
    const steps = Math.ceil(dist / (this.resolution * 0.4));
    if (steps <= 1) return this.isWorldWalkable(x1, z1);

    const perpX = dist > 0.001 ? (-(z1 - z0) / dist) * corridorPadding : 0;
    const perpZ = dist > 0.001 ? ((x1 - x0) / dist) * corridorPadding : 0;

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = x0 + (x1 - x0) * t;
      const z = z0 + (z1 - z0) * t;

      // Check center line
      if (!this.isWorldWalkable(x, z)) return false;

      // Check side margins for corridor clearance around rack corners
      if (corridorPadding > 0) {
        if (!this.isWorldWalkable(x + perpX, z + perpZ)) return false;
        if (!this.isWorldWalkable(x - perpX, z - perpZ)) return false;
      }
    }
    return true;
  }
}
