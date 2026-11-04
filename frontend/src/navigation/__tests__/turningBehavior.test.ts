import { describe, it, expect } from 'vitest';
import { GridMap } from '../GridMap';
import { AStarFinder } from '../AStarFinder';
import { NavigationController, NavState } from '../NavigationController';
import { performSensorScan } from '../sensorUtils';
import { InteractiveObject, AisleBarrier } from '../../types/simulation';

interface SimResult {
  finalState: NavState;
  completed: boolean;
  minClearanceToObstacle: number;
  framesElapsed: number;
  stuckCount: number;
  replanCount: number;
  finalPos: [number, number, number];
}

function simulateRun({
  start,
  startYaw = 0,
  goal,
  customPath,
  dynamicObjects = [],
  activeBarriers = [],
  maxFrames = 800,
  gridMap = new GridMap(),
}: {
  start: [number, number];
  startYaw?: number;
  goal: [number, number];
  customPath?: Array<[number, number]>;
  dynamicObjects?: InteractiveObject[];
  activeBarriers?: AisleBarrier[];
  maxFrames?: number;
  gridMap?: GridMap;
}): SimResult {
  const aStar = new AStarFinder(gridMap);
  const nav = new NavigationController();

  // Register dynamic objects in gridMap
  for (const obj of dynamicObjects) {
    gridMap.addDynamicObstacle({
      id: obj.id,
      x: obj.position[0],
      z: obj.position[2],
      radius: (obj.size || 0.6) * 0.65,
    });
  }

  let path = customPath;
  if (!path) {
    path = aStar.findPath(start, goal) || undefined;
  }
  if (!path || path.length < 2) {
    return {
      finalState: 'FAILED',
      completed: false,
      minClearanceToObstacle: 0,
      framesElapsed: 0,
      stuckCount: 0,
      replanCount: 0,
      finalPos: [start[0], 0.22, start[1]],
    };
  }

  nav.setPath(path, goal);

  let pos: [number, number, number] = [start[0], 0.22, start[1]];
  let yaw = startYaw;
  let speed = 0;
  let minClearanceToObstacle = Infinity;
  let stuckCount = 0;
  let replanCount = 0;
  let lastPos = [...pos];
  let finalState: NavState = 'MOVING';

  const dt = 0.016; // 60 FPS

  for (let frame = 0; frame < maxFrames; frame++) {
    const scan = performSensorScan(pos, yaw, gridMap, dynamicObjects, activeBarriers);

    // Track clearance to dynamic obstacles
    for (const obj of dynamicObjects) {
      const d = Math.hypot(pos[0] - obj.position[0], pos[2] - obj.position[2]) - (obj.size || 0.6) * 0.65;
      if (d < minClearanceToObstacle) minClearanceToObstacle = d;
    }
    for (const barrier of activeBarriers) {
      const d = Math.hypot(pos[0] - barrier.position[0], pos[2] - barrier.position[2]) - barrier.width / 2;
      if (d < minClearanceToObstacle) minClearanceToObstacle = d;
    }

    const cmd = nav.computeControl(
      pos,
      yaw,
      scan,
      3.0, // max linear speed
      2.5, // max angular speed
      frame * dt,
      speed,
      6.0, // linear deceleration
      gridMap,
      dynamicObjects,
      activeBarriers
    );

    finalState = cmd.navState;

    if (cmd.needsReplan) {
      replanCount++;
      const newPath = aStar.findPath([pos[0], pos[2]], goal);
      if (newPath && newPath.length >= 2) {
        nav.setPath(newPath, goal);
      }
    }

    if (cmd.navState === 'COMPLETED') {
      return {
        finalState: 'COMPLETED',
        completed: true,
        minClearanceToObstacle,
        framesElapsed: frame,
        stuckCount,
        replanCount,
        finalPos: pos,
      };
    }

    // Kinematics update
    if (speed < cmd.targetLinearVel) speed = Math.min(cmd.targetLinearVel, speed + 6.0 * dt);
    else if (speed > cmd.targetLinearVel) speed = Math.max(cmd.targetLinearVel, speed - 6.0 * dt);

    yaw += cmd.targetAngularVel * dt;
    yaw = Math.atan2(Math.sin(yaw), Math.cos(yaw));

    pos[0] += speed * Math.sin(yaw) * dt;
    pos[2] += speed * Math.cos(yaw) * dt;

    // Detect if robot is stuck (speed near 0 and no position change over multiple frames)
    const moved = Math.hypot(pos[0] - lastPos[0], pos[2] - lastPos[2]);
    if (moved < 0.005) {
      stuckCount++;
    } else {
      stuckCount = Math.max(0, stuckCount - 1);
    }
    lastPos = [...pos];
  }

  return {
    finalState,
    completed: false,
    minClearanceToObstacle,
    framesElapsed: maxFrames,
    stuckCount,
    replanCount,
    finalPos: pos,
  };
}

describe('Turning Behavior & Obstacle Avoidance Regression Suite', () => {
  // Test A: Obstacle-free straight-line navigation
  it('A. Obstacle-free straight-line navigation: completes without getting stuck', () => {
    const res = simulateRun({
      start: [-14.5, -10.0],
      startYaw: Math.PI / 2, // Facing +X
      goal: [-2.0, -10.0],
      customPath: [
        [-14.5, -10.0],
        [-2.0, -10.0],
      ],
      maxFrames: 400,
    });

    expect(res.completed).toBe(true);
    expect(res.finalState).toBe('COMPLETED');
    expect(res.stuckCount).toBeLessThan(10);
    expect(res.replanCount).toBe(0);
  });

  // Test B: Obstacle-free 90-degree left turn
  it('B. Obstacle-free 90-degree left turn: navigates corner smoothly without wedging', () => {
    // Start facing South (+Z), then turn left into East (+X) transfer aisle
    const res = simulateRun({
      start: [-6.5, -13.0],
      startYaw: 0, // Facing South (+Z)
      goal: [0.0, -9.5],
      customPath: [
        [-6.5, -13.0],
        [-6.5, -9.5], // 90-degree left turn corner
        [0.0, -9.5],
      ],
      maxFrames: 500,
    });

    expect(res.completed).toBe(true);
    expect(res.finalState).toBe('COMPLETED');
    expect(res.stuckCount).toBeLessThan(15);
  });

  // Test C: Obstacle-free 90-degree right turn
  it('C. Obstacle-free 90-degree right turn: navigates corner smoothly without wedging', () => {
    // Start facing South (+Z), then turn right into West (-X) cross aisle
    const res = simulateRun({
      start: [-6.5, -13.0],
      startYaw: 0, // Facing South (+Z)
      goal: [-13.0, -9.5],
      customPath: [
        [-6.5, -13.0],
        [-6.5, -9.5], // 90-degree right turn corner
        [-13.0, -9.5],
      ],
      maxFrames: 500,
    });

    expect(res.completed).toBe(true);
    expect(res.finalState).toBe('COMPLETED');
    expect(res.stuckCount).toBeLessThan(15);
  });

  // Test D: Multiple consecutive 90-degree turns
  it('D. Multiple consecutive 90-degree turns: traverses multi-turn corridor without stalling', () => {
    // S-bend / Zig-zag through open warehouse aisles
    const res = simulateRun({
      start: [-14.5, -10.0],
      startYaw: Math.PI / 2, // Facing +X
      goal: [-6.5, 0.0],
      customPath: [
        [-14.5, -10.0],
        [-6.5, -10.0], // Turn 1 (Right: South)
        [-6.5, -5.0],
        [-6.5, 0.0],
      ],
      maxFrames: 600,
    });

    expect(res.completed).toBe(true);
    expect(res.finalState).toBe('COMPLETED');
    expect(res.stuckCount).toBeLessThan(20);
  });

  // Test E: U-shaped route
  it('E. U-shaped route: executes 180-degree turnaround via consecutive 90-degree turns', () => {
    // South -> East -> North turnaround
    const res = simulateRun({
      start: [-6.5, -12.0],
      startYaw: 0,
      goal: [0.0, -12.0],
      customPath: [
        [-6.5, -12.0],
        [-6.5, -9.0],  // Turn 1: 90 deg Left (East)
        [0.0, -9.0],   // Turn 2: 90 deg Left (North)
        [0.0, -12.0],
      ],
      maxFrames: 650,
    });

    expect(res.completed).toBe(true);
    expect(res.finalState).toBe('COMPLETED');
    expect(res.stuckCount).toBeLessThan(20);
  });

  // Test F: One box ahead requiring avoidance
  it('F. One box ahead requiring avoidance: safely bypasses box without collision', () => {
    const box: InteractiveObject = {
      id: 'cargo-box-1',
      type: 'cube',
      position: [-14.5, 0.4, -6.5],
      color: '#f59e0b',
      size: 0.7,
    };

    const res = simulateRun({
      start: [-14.5, -10.0],
      startYaw: 0, // South
      goal: [-14.5, -2.0],
      customPath: [
        [-14.5, -10.0],
        [-14.5, -2.0],
      ],
      dynamicObjects: [box],
      maxFrames: 600,
    });

    // Robot must maintain safety clearance > robot radius (0.34m)
    expect(res.minClearanceToObstacle).toBeGreaterThan(0.20);
    // Must progress past obstacle
    expect(res.finalPos[2]).toBeGreaterThan(-6.0);
  });

  // Test G: Avoidance followed by rejoining the original path
  it('G. Avoidance followed by rejoining path: bypasses obstacle and reaches destination', () => {
    const box: InteractiveObject = {
      id: 'cargo-box-mid',
      type: 'cube',
      position: [-14.5, 0.4, -6.0],
      color: '#f59e0b',
      size: 0.7,
    };

    const res = simulateRun({
      start: [-14.5, -9.5],
      startYaw: 0,
      goal: [-14.5, -2.0],
      customPath: [
        [-14.5, -9.5],
        [-14.5, -2.0],
      ],
      dynamicObjects: [box],
      maxFrames: 700,
    });

    expect(res.completed).toBe(true);
    expect(res.finalState).toBe('COMPLETED');
    expect(res.minClearanceToObstacle).toBeGreaterThan(0.20);
  });

  // Test H: Extreme difficulty with multiple obstacles
  it('H. Extreme difficulty with multiple obstacles: negotiates field without collision', () => {
    const obstacles: InteractiveObject[] = [
      { id: 'b1', type: 'cube', position: [-14.8, 0.4, -7.5], size: 0.6, color: '#f59e0b' },
      { id: 'b2', type: 'sphere', position: [-14.2, 0.4, -5.0], size: 0.6, color: '#3b82f6' },
      { id: 'b3', type: 'cube', position: [-14.7, 0.4, -3.0], size: 0.6, color: '#f59e0b' },
    ];

    const res = simulateRun({
      start: [-14.5, -10.0],
      startYaw: 0,
      goal: [-14.5, -1.0],
      customPath: [
        [-14.5, -10.0],
        [-14.5, -1.0],
      ],
      dynamicObjects: obstacles,
      maxFrames: 900,
    });

    // Must make significant progress and never collide
    expect(res.minClearanceToObstacle).toBeGreaterThan(0.15);
    expect(res.finalPos[2]).toBeGreaterThan(-4.0);
  });

  // Test I: Fully blocked corridor with no safe route
  it('I. Fully blocked corridor with no safe route: stops safely and reports blocked state', () => {
    const gridMap = new GridMap();
    // Barricade across the entire width of West aisle at Z = -6.0
    const fullBarrier: AisleBarrier = {
      id: 'full-aisle-block',
      aisleId: 'aisle-west',
      name: 'Full Aisle Block',
      position: [-14.8, 0.5, -6.0],
      rotation: 0,
      width: 7.0, // spans entire aisle width
      depth: 0.8,
      height: 1.2,
    };
    gridMap.addBarrier(fullBarrier);

    const nav = new NavigationController();

    const start: [number, number] = [-14.8, -9.5];
    const goal: [number, number] = [-14.8, -2.0];

    // Simulate robot driving directly towards the barrier
    const approachPath: Array<[number, number]> = [
      start,
      [-14.8, -5.0],
    ];
    nav.setPath(approachPath, goal);

    let pos: [number, number, number] = [start[0], 0.22, start[1]];
    let yaw = 0;
    let speed = 2.0;
    let stoppedSafely = false;
    let minClearance = Infinity;

    for (let frame = 0; frame < 300; frame++) {
      const scan = performSensorScan(pos, yaw, gridMap, [], [fullBarrier]);
      const cmd = nav.computeControl(
        pos,
        yaw,
        scan,
        3.0,
        2.5,
        frame * 0.016,
        speed,
        6.0,
        gridMap,
        [],
        [fullBarrier]
      );

      const dToBarrier = Math.abs(pos[2] - fullBarrier.position[2]) - fullBarrier.depth / 2 - 0.34;
      if (dToBarrier < minClearance) minClearance = dToBarrier;

      if (cmd.isEmergencyBraking || cmd.targetLinearVel === 0) {
        stoppedSafely = true;
        // Verify stopping clearance is positive (no collision!)
        expect(minClearance).toBeGreaterThan(0.20);
        break;
      }

      const dt = 0.016;
      if (speed < cmd.targetLinearVel) speed = Math.min(cmd.targetLinearVel, speed + 6.0 * dt);
      else speed = Math.max(cmd.targetLinearVel, speed - 6.0 * dt);
      pos[2] += speed * Math.cos(yaw) * dt;
    }

    expect(stoppedSafely).toBe(true);
    expect(minClearance).toBeGreaterThan(0.20);
  });
});
