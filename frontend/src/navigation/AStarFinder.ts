import { GridMap } from './GridMap';

interface AStarNode {
  gx: number;
  gz: number;
  g: number;
  h: number;
  f: number;
  parent: AStarNode | null;
}

export class AStarFinder {
  private gridMap: GridMap;

  constructor(gridMap: GridMap) {
    this.gridMap = gridMap;
  }

  // Find optimal path from start [sx, sz] to goal [tx, tz] in world coordinates
  findPath(
    startPos: [number, number],
    goalPos: [number, number]
  ): Array<[number, number]> | null {
    // Validate that start and goal lie within warehouse boundaries
    const bounds = this.gridMap.bounds;
    if (
      startPos[0] < bounds.minX ||
      startPos[0] > bounds.maxX ||
      startPos[1] < bounds.minZ ||
      startPos[1] > bounds.maxZ ||
      goalPos[0] < bounds.minX ||
      goalPos[0] > bounds.maxX ||
      goalPos[1] < bounds.minZ ||
      goalPos[1] > bounds.maxZ
    ) {
      return null;
    }

    let [startGx, startGz] = this.gridMap.worldToGrid(startPos[0], startPos[1]);
    let [targetGx, targetGz] = this.gridMap.worldToGrid(goalPos[0], goalPos[1]);

    // If start is in an unwalkable cell (e.g. within inflated clearance of a dynamic obstacle),
    // but the robot is not physically embedded in a solid wall or rack, find nearest walkable cell to start from.
    if (!this.gridMap.isWalkable(startGx, startGz)) {
      if (!this.gridMap.isPhysicalObstacle(startPos[0], startPos[1])) {
        const neighbor = this.findNearestWalkableNeighbor(startGx, startGz);
        if (neighbor) {
          startGx = neighbor[0];
          startGz = neighbor[1];
        } else {
          return null;
        }
      } else {
        return null;
      }
    }

    // If start is identical to goal, return single point
    if (startGx === targetGx && startGz === targetGz) {
      return [goalPos];
    }

    // If target cell is blocked, return null (destination is blocked)
    if (!this.gridMap.isWalkable(targetGx, targetGz)) {
      return null;
    }

    // Open set and closed set tracking
    // Node key: `${gx},${gz}`
    const openSet: Map<string, AStarNode> = new Map();
    const closedSet: Set<string> = new Set();

    const startNode: AStarNode = {
      gx: startGx,
      gz: startGz,
      g: 0,
      h: this.heuristic(startGx, startGz, targetGx, targetGz),
      f: 0,
      parent: null,
    };
    startNode.f = startNode.g + startNode.h;

    const startKey = `${startGx},${startGz}`;
    openSet.set(startKey, startNode);

    // 8-directional neighbor offsets: [dx, dz, cost]
    const SQRT2 = Math.SQRT2;
    const NEIGHBORS = [
      [1, 0, 1.0],
      [-1, 0, 1.0],
      [0, 1, 1.0],
      [0, -1, 1.0],
      [1, 1, SQRT2],
      [-1, 1, SQRT2],
      [1, -1, SQRT2],
      [-1, -1, SQRT2],
    ];

    while (openSet.size > 0) {
      // Find node with lowest f cost in openSet
      let current: AStarNode | null = null;
      let minF = Infinity;

      for (const node of openSet.values()) {
        if (node.f < minF) {
          minF = node.f;
          current = node;
        }
      }

      if (!current) break;

      const currentKey = `${current.gx},${current.gz}`;

      // Goal check
      if (current.gx === targetGx && current.gz === targetGz) {
        const rawGridPath = this.reconstructPath(current);
        return this.smoothPath(rawGridPath, startPos, goalPos);
      }

      openSet.delete(currentKey);
      closedSet.add(currentKey);

      for (const [dx, dz, cost] of NEIGHBORS) {
        const nx = current.gx + dx;
        const nz = current.gz + dz;
        const neighborKey = `${nx},${nz}`;

        if (closedSet.has(neighborKey)) continue;
        if (!this.gridMap.isWalkable(nx, nz)) continue;

        // Prevent diagonal corner cutting through obstacles
        if (dx !== 0 && dz !== 0) {
          if (
            !this.gridMap.isWalkable(current.gx + dx, current.gz) ||
            !this.gridMap.isWalkable(current.gx, current.gz + dz)
          ) {
            continue;
          }
        }

        const tentativeG = current.g + cost;
        const existingNeighbor = openSet.get(neighborKey);

        if (!existingNeighbor) {
          const h = this.heuristic(nx, nz, targetGx, targetGz);
          const newNode: AStarNode = {
            gx: nx,
            gz: nz,
            g: tentativeG,
            h,
            f: tentativeG + h,
            parent: current,
          };
          openSet.set(neighborKey, newNode);
        } else if (tentativeG < existingNeighbor.g) {
          existingNeighbor.g = tentativeG;
          existingNeighbor.f = tentativeG + existingNeighbor.h;
          existingNeighbor.parent = current;
        }
      }
    }

    return null; // Path blocked or unreachable
  }

  // Octile heuristic distance
  private heuristic(x1: number, z1: number, x2: number, z2: number): number {
    const dx = Math.abs(x1 - x2);
    const dz = Math.abs(z1 - z2);
    const F = Math.SQRT2 - 1;
    return dx < dz ? F * dx + dz : F * dz + dx;
  }

  private reconstructPath(endNode: AStarNode): Array<[number, number]> {
    const path: Array<[number, number]> = [];
    let curr: AStarNode | null = endNode;
    while (curr) {
      path.push(this.gridMap.gridToWorld(curr.gx, curr.gz));
      curr = curr.parent;
    }
    path.reverse();
    return path;
  }

  // Smooth path using string-pulling with corridor clearance
  private smoothPath(
    rawPath: Array<[number, number]>,
    startExact: [number, number],
    goalExact: [number, number]
  ): Array<[number, number]> {
    if (rawPath.length <= 2) {
      return [startExact, goalExact];
    }

    const smoothed: Array<[number, number]> = [startExact];
    let currentIdx = 0;

    while (currentIdx < rawPath.length - 1) {
      let furthestIdx = currentIdx + 1;

      // Look ahead as far as line of sight with corridor padding permits
      for (let nextIdx = rawPath.length - 1; nextIdx > currentIdx + 1; nextIdx--) {
        const [x0, z0] = smoothed[smoothed.length - 1];
        const [x1, z1] = rawPath[nextIdx];

        // Ensure 22cm corridor clearance so corners are not clipped
        if (this.gridMap.hasLineOfSight(x0, z0, x1, z1, 0.22)) {
          furthestIdx = nextIdx;
          break;
        }
      }

      smoothed.push(rawPath[furthestIdx]);
      currentIdx = furthestIdx;
    }

    // Replace last waypoint with exact goal
    if (smoothed.length > 1) {
      smoothed[smoothed.length - 1] = goalExact;
    }

    return smoothed;
  }

  findNearestWalkableNeighbor(gx: number, gz: number, maxRadius: number = 8): [number, number] | null {
    for (let r = 1; r <= maxRadius; r++) {
      let bestNeighbor: [number, number] | null = null;
      let minCost = Infinity;

      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          if (Math.abs(dx) === r || Math.abs(dz) === r) {
            const nx = gx + dx;
            const nz = gz + dz;
            if (this.gridMap.isWalkable(nx, nz)) {
              const cost = dx * dx + dz * dz;
              if (cost < minCost) {
                minCost = cost;
                bestNeighbor = [nx, nz];
              }
            }
          }
        }
      }
      if (bestNeighbor) return bestNeighbor;
    }
    return null;
  }

  // Check if two paths differ meaningfully
  pathsDiffer(
    pathA: Array<[number, number]> | null,
    pathB: Array<[number, number]> | null
  ): boolean {
    if (!pathA || !pathB) return pathA !== pathB;
    if (pathA.length !== pathB.length) return true;

    for (let i = 0; i < pathA.length; i++) {
      const dist = Math.hypot(pathA[i][0] - pathB[i][0], pathA[i][1] - pathB[i][1]);
      if (dist > 0.4) return true;
    }
    return false;
  }

  // Check if an existing path has been intersected by a newly placed obstacle
  isPathBlocked(path: Array<[number, number]>): boolean {
    if (!path || path.length < 2) return false;

    for (let i = 0; i < path.length - 1; i++) {
      const [x0, z0] = path[i];
      const [x1, z1] = path[i + 1];
      if (!this.gridMap.hasLineOfSight(x0, z0, x1, z1, 0.15)) {
        return true;
      }
    }
    return false;
  }
}
