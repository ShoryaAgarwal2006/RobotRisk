import { GridMap } from './GridMap';
import { InteractiveObject, AisleBarrier } from '../types/simulation';
import { evaluateSceneTTC } from './ttcUtils';

export interface SensorRayHit {
  id: string;
  angleOffset: number; // radians relative to robot heading
  maxRange: number;
  origin: [number, number, number];
  hitPoint: [number, number, number];
  distance: number;
  hasHit: boolean;
  hitType?: 'static' | 'dynamic' | 'barrier';
}

export interface SensorScanResult {
  rays: SensorRayHit[];
  forwardDist: number;
  leftDist: number;
  rightDist: number;
  closestObstacleName: string | null;
  riskLevel: 'clear' | 'caution' | 'critical';
  obstaclePosition: [number, number] | null; // [X, Z] in world coords
  ttc?: number | null;
  safetyStatus?: 'SAFE' | 'WARNING' | 'CRITICAL';
  highestRiskObstacle?: string | null;
  minClearance?: number;
  isCollisionCourse?: boolean;
}

export function performSensorScan(
  robotPos: [number, number, number],
  robotYaw: number,
  gridMap: GridMap,
  dynamicObjects: InteractiveObject[] = [],
  activeBarriers: AisleBarrier[] = [],
  currentTime: number = 0,
  linearVelocity: number = 0
): SensorScanResult {
  const [rx, ry, rz] = robotPos;
  const sensorOriginY = ry + 0.12;
  const robotRadius = 0.34;

  // High-Density Sensor ray configurations: 15 rays ensuring zero blindspots
  const RAY_CONFIGS = [
    { angleDeg: 0, range: 6.0, id: 'f-center' },
    { angleDeg: -5, range: 5.8, id: 'f-left-0' },
    { angleDeg: 5, range: 5.8, id: 'f-right-0' },
    { angleDeg: -10, range: 5.5, id: 'f-left-1' },
    { angleDeg: 10, range: 5.5, id: 'f-right-1' },
    { angleDeg: -18, range: 5.0, id: 'f-left-2' },
    { angleDeg: 18, range: 5.0, id: 'f-right-2' },
    { angleDeg: -28, range: 4.2, id: 'f-left-3' },
    { angleDeg: 28, range: 4.2, id: 'f-right-3' },
    { angleDeg: -40, range: 3.5, id: 'f-left-4' },
    { angleDeg: 40, range: 3.5, id: 'f-right-4' },
    { angleDeg: -60, range: 2.8, id: 'side-left-1' },
    { angleDeg: 60, range: 2.8, id: 'side-right-1' },
    { angleDeg: -85, range: 2.2, id: 'side-left-2' },
    { angleDeg: 85, range: 2.2, id: 'side-right-2' },
  ];

  const rayHits: SensorRayHit[] = [];
  let minForward = 6.0;
  let minLeft = 3.0;
  let minRight = 3.0;
  let closestName: string | null = null;
  let closestHitCoords: [number, number] | null = null;

  for (const cfg of RAY_CONFIGS) {
    const angleRad = (cfg.angleDeg * Math.PI) / 180;
    const rayHeading = robotYaw + angleRad;

    const dirX = Math.sin(rayHeading);
    const dirZ = Math.cos(rayHeading);

    const stepSize = 0.10; // 10cm fine ray marching step
    const maxSteps = Math.floor(cfg.range / stepSize);

    let hitDist = cfg.range;
    let hasHit = false;
    let hitType: 'static' | 'dynamic' | 'barrier' | undefined = undefined;

    // Ray march forward
    for (let step = 1; step <= maxSteps; step++) {
      const d = step * stepSize;
      const testX = rx + dirX * d;
      const testZ = rz + dirZ * d;

      // 1. Check against placed dynamic objects
      let hitDynamic = false;
      for (const obj of dynamicObjects) {
        if (obj.type === 'forklift') {
          // Precise oriented bounding box (OBB) for industrial forklift
          // Width: 1.0m (halfX = 0.52m), Length: 2.1m (halfZ = 1.05m)
          const dx = testX - obj.position[0];
          const dz = testZ - obj.position[2];
          const rot = obj.rotation || 0;
          const cos = Math.cos(-rot);
          const sin = Math.sin(-rot);
          const localX = cos * dx - sin * dz;
          const localZ = sin * dx + cos * dz;

          if (Math.abs(localX) <= 0.52 && Math.abs(localZ) <= 1.05) {
            hitDist = d;
            hasHit = true;
            hitDynamic = true;
            hitType = 'dynamic';
            break;
          }
        } else {
          const distToObj = Math.hypot(testX - obj.position[0], testZ - obj.position[2]);
          const collisionRadius = (obj.size || 0.6) * 0.65;
          if (distToObj <= collisionRadius) {
            hitDist = d;
            hasHit = true;
            hitDynamic = true;
            hitType = 'dynamic';
            break;
          }
        }
      }
      if (hitDynamic) break;

      // 2. Check against active aisle barriers
      let hitBarrier = false;
      for (const barrier of activeBarriers) {
        const dx = testX - barrier.position[0];
        const dz = testZ - barrier.position[2];
        const cos = Math.cos(-barrier.rotation);
        const sin = Math.sin(-barrier.rotation);
        const localX = cos * dx - sin * dz;
        const localZ = sin * dx + cos * dz;

        if (
          Math.abs(localX) <= barrier.width / 2 &&
          Math.abs(localZ) <= barrier.depth / 2
        ) {
          hitDist = d;
          hasHit = true;
          hitBarrier = true;
          hitType = 'barrier';
          break;
        }
      }
      if (hitBarrier) break;

      // 3. Check against static physical warehouse obstacles (walls, racks, pallets)
      if (d > 0.36 && gridMap.isPhysicalObstacle(testX, testZ)) {
        hitDist = d;
        hasHit = true;
        hitType = 'static';
        break;
      }
    }

    const hitPoint: [number, number, number] = [
      rx + dirX * hitDist,
      sensorOriginY,
      rz + dirZ * hitDist,
    ];

    rayHits.push({
      id: cfg.id,
      angleOffset: angleRad,
      maxRange: cfg.range,
      origin: [rx, sensorOriginY, rz],
      hitPoint,
      distance: hitDist,
      hasHit,
      hitType,
    });

    // Categorize distance by swept corridor and lateral sectors
    const localLateral = hitDist * Math.sin(angleRad);
    const localForward = hitDist * Math.cos(angleRad);
    const forwardCorridorHalfWidth = robotRadius + 0.12; // 0.46m swept corridor

    if (hasHit && localForward > 0 && Math.abs(localLateral) <= forwardCorridorHalfWidth) {
      // True forward path obstacle
      if (hitDist < minForward) {
        minForward = hitDist;
        closestName =
          hitType === 'barrier'
            ? 'Aisle Barrier'
            : hitType === 'dynamic'
            ? 'Dynamic Obstacle'
            : 'Storage Rack / Wall';
        closestHitCoords = [hitPoint[0], hitPoint[2]];
      }
    } else if (cfg.angleDeg < 0) {
      if (hitDist < minLeft) minLeft = hitDist;
    } else if (cfg.angleDeg > 0) {
      if (hitDist < minRight) minRight = hitDist;
    }
  }

  // 4. PROJECTED FORWARD PATH ENVELOPE CHECK (Zero Blindspots for Dynamic Objects & Barriers)
  for (const obj of dynamicObjects) {
    const dx = obj.position[0] - rx;
    const dz = obj.position[2] - rz;

    const localForwardZ = dx * Math.sin(robotYaw) + dz * Math.cos(robotYaw);
    const localLateralX = dx * Math.cos(robotYaw) - dz * Math.sin(robotYaw);

    const objRadius = (obj.size || 0.6) * 0.65;
    const collideHalfWidth = robotRadius + objRadius;

    // Only obstructs forward path if lateral offset penetrates the swept travel cylinder
    if (localForwardZ > 0 && Math.abs(localLateralX) <= collideHalfWidth) {
      const surfaceDistance = Math.max(0.01, localForwardZ - objRadius);
      if (surfaceDistance < minForward) {
        minForward = surfaceDistance;
        closestName = obj.name || `Dynamic ${String(obj.type || 'obstacle').toUpperCase()}`;
        closestHitCoords = [obj.position[0], obj.position[2]];
      }
    } else if (Math.abs(localForwardZ) < 1.5) {
      // Lateral clearance while passing alongside obstacle
      const sideClearance = Math.max(0.01, Math.abs(localLateralX) - objRadius);
      if (localLateralX > 0 && sideClearance < minLeft) minLeft = sideClearance;
      if (localLateralX < 0 && sideClearance < minRight) minRight = sideClearance;
    }
  }

  for (const barrier of activeBarriers) {
    const dx = barrier.position[0] - rx;
    const dz = barrier.position[2] - rz;

    const localForwardZ = dx * Math.sin(robotYaw) + dz * Math.cos(robotYaw);
    const localLateralX = dx * Math.cos(robotYaw) - dz * Math.sin(robotYaw);

    const collideHalfWidth = robotRadius + barrier.width / 2;
    if (localForwardZ > 0 && Math.abs(localLateralX) <= collideHalfWidth) {
      const surfaceDistance = Math.max(0.01, localForwardZ - barrier.depth / 2);
      if (surfaceDistance < minForward) {
        minForward = surfaceDistance;
        closestName = `Physical Barrier (${barrier.name})`;
        closestHitCoords = [barrier.position[0], barrier.position[2]];
      }
    }
  }

  // Realistic Threat Classification:
  // AMR radius is 0.34m. Forward bumper is 0.34m from center.
  let riskLevel: 'clear' | 'caution' | 'critical' = 'clear';

  if (minForward < 0.95 || minLeft < 0.36 || minRight < 0.36) {
    riskLevel = 'critical';
  } else if (minForward < 2.8 || minLeft < 0.48 || minRight < 0.48) {
    riskLevel = 'caution';
  }

  // Dynamic TTC & Scene Collision Analysis
  const sceneTTC = evaluateSceneTTC(
    {
      position: robotPos,
      rotation: robotYaw,
      linearVelocity: linearVelocity,
      angularVelocity: 0,
    },
    dynamicObjects,
    activeBarriers,
    gridMap,
    currentTime
  );

  return {
    rays: rayHits,
    forwardDist: minForward,
    leftDist: minLeft,
    rightDist: minRight,
    closestObstacleName: closestName,
    riskLevel,
    obstaclePosition: closestHitCoords,
    ttc: sceneTTC.minTtc,
    safetyStatus: sceneTTC.safetyStatus,
    highestRiskObstacle: sceneTTC.highestRiskObstacle,
    minClearance: sceneTTC.minClearance,
    isCollisionCourse: sceneTTC.isCollisionCourse,
  };
}
