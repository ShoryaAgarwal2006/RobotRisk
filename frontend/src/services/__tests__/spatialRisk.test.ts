import { describe, it, expect, beforeEach } from 'vitest';
import {
  SpatialRiskService,
  GRID_COLUMNS,
  GRID_ROWS,
  TOTAL_GRID_CELLS,
  WAREHOUSE_BOUNDS,
  CELL_SIZE,
  SpatialIncident,
} from '../spatialRiskService';
import { FlightRecordingSession, TelemetryFrame, IncidentEvent } from '../flightRecorder';
import { BenchmarkRun } from '../benchmarkService';

describe('Phase 5.3D: Spatial Risk Heatmap & Incident Hotspot Analytics', () => {
  let service: SpatialRiskService;

  beforeEach(() => {
    service = new SpatialRiskService();
  });

  describe('1. Uniform 1m x 1m Grid & Coordinate Mapping', () => {
    it('initializes grid constants matching 40x32 warehouse dimensions (1,280 cells)', () => {
      expect(GRID_COLUMNS).toBe(40);
      expect(GRID_ROWS).toBe(32);
      expect(CELL_SIZE).toBe(1.0);
      expect(TOTAL_GRID_CELLS).toBe(1280);
      expect(WAREHOUSE_BOUNDS.width).toBe(40.0);
      expect(WAREHOUSE_BOUNDS.length).toBe(32.0);
    });

    it('correctly maps valid Three.js world coordinates into discrete grid indices', () => {
      // Bottom-Left boundary corner: (-20.0, -16.0) -> col 0, row 0
      const bl = service.worldToGrid(-20.0, -16.0);
      expect(bl).toEqual({ col: 0, row: 0 });

      // Warehouse origin (0.0, 0.0) -> col 20, row 16
      const origin = service.worldToGrid(0.0, 0.0);
      expect(origin).toEqual({ col: 20, row: 16 });

      // Top-Right corner: (19.9, 15.9) -> col 39, row 31
      const tr = service.worldToGrid(19.9, 15.9);
      expect(tr).toEqual({ col: 39, row: 31 });
    });

    it('calculates exact physical cell center coordinates from grid indices', () => {
      // Cell (0, 0) center: -20 + 0.5 = -19.5, -16 + 0.5 = -15.5
      const c00 = service.gridToWorld(0, 0);
      expect(c00.centerX).toBe(-19.5);
      expect(c00.centerZ).toBe(-15.5);

      // Cell (20, 16) center: -20 + 20.5 = 0.5, -16 + 16.5 = 0.5
      const c20 = service.gridToWorld(20, 16);
      expect(c20.centerX).toBe(0.5);
      expect(c20.centerZ).toBe(0.5);
    });

    it('filters out-of-bounds, non-finite, and NaN coordinates safely', () => {
      expect(service.isValidCoordinate(-25.0, 0.0)).toBe(false);
      expect(service.isValidCoordinate(0.0, 20.0)).toBe(false);
      expect(service.isValidCoordinate(NaN, 0.0)).toBe(false);
      expect(service.isValidCoordinate(0.0, Infinity)).toBe(false);

      expect(service.worldToGrid(-25.0, 0.0)).toBeNull();
      expect(service.worldToGrid(100.0, 100.0)).toBeNull();
    });

    it('normalizes world coordinates to [0, 1] for 2D floorplan rendering', () => {
      const normOrigin = service.worldToNormalized(0.0, 0.0);
      expect(normOrigin.u).toBeCloseTo(0.5, 4);
      expect(normOrigin.v).toBeCloseTo(0.5, 4);

      const normBL = service.worldToNormalized(-20.0, -16.0);
      expect(normBL.u).toBe(0);
      expect(normBL.v).toBe(0);

      const normTR = service.worldToNormalized(20.0, 16.0);
      expect(normTR.u).toBe(1);
      expect(normTR.v).toBe(1);
    });
  });

  describe('2. Incident Extraction & Layer Filtering (No Double Counting)', () => {
    const createMockIncidentEvent = (
      id: string,
      type: 'COLLISION' | 'NEAR_MISS' | 'EMERGENCY_BRAKING' | 'TTC_CRITICAL' | 'TTC_WARNING',
      x: number,
      z: number
    ): IncidentEvent => ({
      id,
      type,
      simTime: 4.2,
      wallTime: 1700000000000,
      description: `${type} event at [${x}, ${z}]`,
      snapshot: {
        simTime: 4.2,
        wallTime: 1700000000000,
        position: [x, 0.22, z],
        rotation: 0,
        linearVelocity: 1.5,
        angularVelocity: 0,
        navState: 'MOVING',
        ttc: 1.1,
        minClearance: 0.4,
        safetyStatus: 'WARNING',
        highestRiskObstacle: 'Pallet Jack',
        isCollisionCourse: true,
        activeObstaclesCount: 1,
        lidar: { forward: 1.0, left: 2.0, right: 2.0 },
      },
      details: { stoppingDistance: 1.12 },
    });

    it('extracts valid spatial incidents from flight recorder sessions while discarding invalid coordinates', () => {
      const session: FlightRecordingSession = {
        recordingId: 'REC-TEST-SPATIAL',
        sessionId: 'RR-SESSION',
        startTimeSim: 0,
        endTimeSim: 10,
        startTimeWall: 1700000000000,
        endTimeWall: 1700000010000,
        isAuthoritative: true,
        userRole: 'operator',
        frames: [],
        totalFramesSampled: 0,
        hasBufferWrapped: false,
        incidents: [
          createMockIncidentEvent('INC-1', 'COLLISION', 12.0, 8.0),
          createMockIncidentEvent('INC-2', 'NEAR_MISS', -5.0, 2.0),
          createMockIncidentEvent('INC-OUT', 'COLLISION', 99.0, 99.0), // out of bounds
        ],
        isCompleted: true,
      };

      const extracted = service.extractIncidentsFromSession(session);
      expect(extracted).toHaveLength(2);
      expect(extracted[0].id).toBe('INC-1');
      expect(extracted[0].type).toBe('COLLISION');
      expect(extracted[0].position).toEqual([12.0, 0.22, 8.0]);
      expect(extracted[1].id).toBe('INC-2');
    });

    it('filters incidents independently across supported layers without double counting in COMBINED layer', () => {
      const incidents: SpatialIncident[] = [
        {
          id: 'INC-A',
          type: 'COLLISION',
          position: [0, 0, 0],
          simTime: 1,
          wallTime: 1000,
          description: 'A',
          minClearance: 0,
          ttc: null,
          highestRiskObstacle: null,
          linearVelocity: 1.0,
        },
        {
          id: 'INC-B',
          type: 'NEAR_MISS',
          position: [1, 0, 1],
          simTime: 2,
          wallTime: 2000,
          description: 'B',
          minClearance: 0.4,
          ttc: 1.2,
          highestRiskObstacle: 'Rack',
          linearVelocity: 1.0,
        },
        {
          id: 'INC-C',
          type: 'EMERGENCY_BRAKING',
          position: [2, 0, 2],
          simTime: 3,
          wallTime: 3000,
          description: 'C',
          minClearance: 0.8,
          ttc: 2.0,
          highestRiskObstacle: null,
          linearVelocity: 0.2,
        },
        // Duplicate ID simulation to test guard
        {
          id: 'INC-A',
          type: 'COLLISION',
          position: [0, 0, 0],
          simTime: 1,
          wallTime: 1000,
          description: 'A-dup',
          minClearance: 0,
          ttc: null,
          highestRiskObstacle: null,
          linearVelocity: 1.0,
        },
      ];

      const colls = service.filterIncidentsByLayer(incidents, 'COLLISION');
      expect(colls).toHaveLength(2); // contains the two with type COLLISION

      const nearMisses = service.filterIncidentsByLayer(incidents, 'NEAR_MISS');
      expect(nearMisses).toHaveLength(1);
      expect(nearMisses[0].id).toBe('INC-B');

      const brakings = service.filterIncidentsByLayer(incidents, 'EMERGENCY_BRAKING');
      expect(brakings).toHaveLength(1);
      expect(brakings[0].id).toBe('INC-C');

      // COMBINED layer must strictly deduplicate IDs to avoid double counting
      const combined = service.filterIncidentsByLayer(incidents, 'COMBINED');
      expect(combined).toHaveLength(3);
      expect(combined.map((i) => i.id)).toEqual(['INC-A', 'INC-B', 'INC-C']);
    });
  });

  describe('3. Gaussian Kernel Density Estimation (KDE) & Risk Scoring', () => {
    it('applies physical Gaussian decay with bandwidth sigma=1.2m and cutoff=3.0m', () => {
      const incidents: SpatialIncident[] = [
        {
          id: 'INC-COL',
          type: 'COLLISION', // weight = 10.0
          position: [0.5, 0.0, 0.5], // exact center of cell (20, 16)
          simTime: 5.0,
          wallTime: 1700000000000,
          description: 'Rack collision',
          minClearance: 0,
          ttc: null,
          highestRiskObstacle: 'Rack B',
          linearVelocity: 1.5,
        },
      ];

      const heatmap = service.generateHeatmapData(incidents, [], 'COMBINED');

      // Center cell (20, 16) distance = 0 -> kernel = 1.0 -> raw score = 10.0
      const centerCell = heatmap.grid[20][16];
      expect(centerCell.rawRiskScore).toBe(10.0);
      expect(centerCell.riskLevel).toBe('CRITICAL');

      // Neighbor cell (21, 16) distance = 1.0m -> kernel = exp(-1/(2*1.44)) = exp(-0.3472) ~= 0.7067
      // raw score = 10.0 * 0.7067 ~= 7.07
      const neighborCell = heatmap.grid[21][16];
      expect(neighborCell.rawRiskScore).toBeGreaterThan(6.5);
      expect(neighborCell.rawRiskScore).toBeLessThan(7.5);

      // Distant cell (25, 16) distance = 5.0m > cutoff (3.0m) -> 0
      const distantCell = heatmap.grid[25][16];
      expect(distantCell.rawRiskScore).toBe(0);
      expect(distantCell.riskLevel).toBe('CLEAR');
    });

    it('correctly reports raw risk score and transparent heuristic label', () => {
      const incidents: SpatialIncident[] = [
        {
          id: 'INC-NM',
          type: 'NEAR_MISS',
          position: [5.5, 0.0, 5.5],
          simTime: 2.0,
          wallTime: 1000,
          description: 'Near-miss',
          minClearance: 0.3,
          ttc: 1.0,
          highestRiskObstacle: 'Obstacle',
          linearVelocity: 1.0,
        },
      ];

      const heatmap = service.generateHeatmapData(incidents, [], 'NEAR_MISS');
      expect(heatmap.normalizationLabel).toContain('CALCULATED HEURISTIC');
      expect(heatmap.maxRawScore).toBeGreaterThan(0);
    });
  });

  describe('4. Coverage Integrity: Untested, Insufficient Telemetry, and Observed', () => {
    it('filters teleportation / reset jumps (> 2.0m) from telemetry coverage', () => {
      const frames: TelemetryFrame[] = [
        {
          simTime: 0.0,
          wallTime: 1000,
          position: [-10.5, 0.22, 0.5],
          rotation: 0,
          linearVelocity: 1.0,
          angularVelocity: 0,
          navState: 'MOVING',
          ttc: null,
          minClearance: 2.0,
          safetyStatus: 'SAFE',
          highestRiskObstacle: null,
          isCollisionCourse: false,
          activeObstaclesCount: 0,
          lidar: { forward: 3, left: 3, right: 3 },
        },
        // Teleport jump to opposite side of warehouse (> 2.0m jump)
        {
          simTime: 0.1,
          wallTime: 1100,
          position: [15.5, 0.22, 10.5],
          rotation: 0,
          linearVelocity: 0.0,
          angularVelocity: 0,
          navState: 'STOPPED',
          ttc: null,
          minClearance: 2.0,
          safetyStatus: 'SAFE',
          highestRiskObstacle: null,
          isCollisionCourse: false,
          activeObstaclesCount: 0,
          lidar: { forward: 3, left: 3, right: 3 },
        },
      ];

      const heatmap = service.generateHeatmapData([], frames, 'COMBINED');
      const startGrid = service.worldToGrid(-10.5, 0.5)!;
      const jumpGrid = service.worldToGrid(15.5, 10.5)!;

      // Start cell received 1 visit
      expect(heatmap.grid[startGrid.col][startGrid.row].sampleCount).toBe(1);
      // Teleport destination was skipped because delta > 2.0m
      expect(heatmap.grid[jumpGrid.col][jumpGrid.row].sampleCount).toBe(0);
    });

    it('classifies cells strictly by sample count: UNTESTED (0), INSUFFICIENT (1-2), OBSERVED (>= 3)', () => {
      const pos: [number, number, number] = [-14.5, 0.22, -10.5]; // in West Arterial (navigable aisle)
      const frames: TelemetryFrame[] = [];

      // 1. Zero visits
      const map0 = service.generateHeatmapData([], frames, 'COMBINED');
      const gPos = service.worldToGrid(pos[0], pos[2])!;
      expect(map0.grid[gPos.col][gPos.row].coverageState).toBe('UNTESTED');

      // 2. 1 visit -> INSUFFICIENT_TELEMETRY
      frames.push({
        simTime: 0.1,
        wallTime: 100,
        position: pos,
        rotation: 0,
        linearVelocity: 1.0,
        angularVelocity: 0,
        navState: 'MOVING',
        ttc: null,
        minClearance: 2,
        safetyStatus: 'SAFE',
        highestRiskObstacle: null,
        isCollisionCourse: false,
        activeObstaclesCount: 0,
        lidar: { forward: 3, left: 3, right: 3 },
      });
      const map1 = service.generateHeatmapData([], frames, 'COMBINED');
      expect(map1.grid[gPos.col][gPos.row].coverageState).toBe('INSUFFICIENT_TELEMETRY');

      // 3. 3 visits -> OBSERVED
      for (let i = 1; i <= 2; i++) {
        frames.push({
          simTime: 0.1 * (i + 1),
          wallTime: 100 * (i + 1),
          position: pos,
          rotation: 0,
          linearVelocity: 1.0,
          angularVelocity: 0,
          navState: 'MOVING',
          ttc: null,
          minClearance: 2,
          safetyStatus: 'SAFE',
          highestRiskObstacle: null,
          isCollisionCourse: false,
          activeObstaclesCount: 0,
          lidar: { forward: 3, left: 3, right: 3 },
        });
      }
      const map3 = service.generateHeatmapData([], frames, 'COMBINED');
      expect(map3.grid[gPos.col][gPos.row].coverageState).toBe('OBSERVED');
    });

    it('identifies physical storage rack footprints as non-navigable cells', () => {
      // Cell inside Storage Rack D (e.g. X = -9.75, Z = -4.5)
      expect(service.isNavigableAisle(-9.75, -4.5)).toBe(false);
      // Cell in open aisle (e.g. X = 0.0, Z = 0.0)
      expect(service.isNavigableAisle(0.0, 0.0)).toBe(true);
    });
  });

  describe('5. Zero-Incident Handling & Exact Messaging', () => {
    it('produces exact required notification when zero incidents are detected', () => {
      const heatmap = service.generateHeatmapData([], [], 'COMBINED');
      expect(heatmap.statusMessage).toBe('NO INCIDENTS DETECTED IN RECORDED COVERAGE.');
      expect(heatmap.clusters).toHaveLength(0);
      expect(heatmap.maxRawScore).toBe(0);
    });
  });

  describe('6. Proximity Hotspot Clustering', () => {
    it('groups incidents within 1.2m proximity into a single cluster with centroid and dominant type', () => {
      const incidents: SpatialIncident[] = [
        {
          id: 'INC-1',
          type: 'COLLISION',
          position: [2.0, 0, 2.0],
          simTime: 1,
          wallTime: 100,
          description: '',
          minClearance: 0,
          ttc: null,
          highestRiskObstacle: null,
          linearVelocity: 1.0,
        },
        {
          id: 'INC-2',
          type: 'NEAR_MISS',
          position: [2.5, 0, 2.4], // distance ~ 0.64m <= 1.2m
          simTime: 2,
          wallTime: 200,
          description: '',
          minClearance: 0.3,
          ttc: 1.0,
          highestRiskObstacle: null,
          linearVelocity: 1.0,
        },
        {
          id: 'INC-3',
          type: 'COLLISION',
          position: [2.2, 0, 2.1], // distance <= 1.2m
          simTime: 3,
          wallTime: 300,
          description: '',
          minClearance: 0,
          ttc: null,
          highestRiskObstacle: null,
          linearVelocity: 1.0,
        },
        // Separate incident 10m away
        {
          id: 'INC-DISTANT',
          type: 'EMERGENCY_BRAKING',
          position: [-10.0, 0, -10.0],
          simTime: 4,
          wallTime: 400,
          description: '',
          minClearance: 0.5,
          ttc: 2.0,
          highestRiskObstacle: null,
          linearVelocity: 0.5,
        },
      ];

      const clusters = service.clusterIncidents(incidents, 1.2);
      expect(clusters).toHaveLength(2);

      const clusterNear = clusters.find((c) => c.incidents.length === 3);
      expect(clusterNear).toBeDefined();
      expect(clusterNear!.dominantType).toBe('COLLISION'); // 2 collisions vs 1 near-miss
      expect(clusterNear!.count).toBe(3);
      // Centroid: average of (2.0 + 2.5 + 2.2)/3 = 2.23
      expect(clusterNear!.center[0]).toBeCloseTo(2.23, 2);
    });
  });

  describe('7. Comparative Spatial Delta & Fair Normalization', () => {
    it('enforces a single shared normalization scale between baseline and candidate', () => {
      const baseRun: BenchmarkRun = {
        id: 'BENCH-BASE',
        name: 'Baseline Standard',
        createdAt: 1000,
        sourceRecordingId: 'REC-B',
        environment: 'Warehouse',
        difficulty: 'normal',
        startPosition: [-14.5, -10.5],
        targetDestination: 'Bay 4',
        result: 'COMPLETED',
        isAuthoritative: true,
        userRole: 'operator',
        robotConfig: {} as any,
        navigationPreference: 'default',
        metrics: {} as any,
        indicators: {} as any,
        trajectoryEnvelope: [],
        variantTag: 'baseline',
        incidentSnapshots: [
          {
            id: 'B-INC-1',
            type: 'COLLISION',
            position: [0.5, 0, 0.5],
            simTime: 5,
            wallTime: 1000,
            description: '',
            minClearance: 0,
            ttc: null,
            highestRiskObstacle: null,
            linearVelocity: 1.0,
          },
        ],
      } as any;

      const candRun: BenchmarkRun = {
        id: 'BENCH-CAND',
        name: 'Candidate Clean',
        createdAt: 2000,
        sourceRecordingId: 'REC-C',
        environment: 'Warehouse',
        difficulty: 'normal',
        startPosition: [-14.5, -10.5],
        targetDestination: 'Bay 4',
        result: 'COMPLETED',
        isAuthoritative: true,
        userRole: 'operator',
        robotConfig: {} as any,
        navigationPreference: 'shortest_safe_path',
        metrics: {} as any,
        indicators: {} as any,
        trajectoryEnvelope: [],
        variantTag: 'optimized',
        incidentSnapshots: [], // 0 incidents
      } as any;

      const comparison = service.compareSpatialRisk(baseRun, candRun, 'COMBINED');

      expect(comparison.sharedNormalizationScale).toBeGreaterThanOrEqual(15.0);
      expect(comparison.overallSpatialVerdict).toBe('RISK_REDUCED');
      expect(comparison.totalRiskReduction).toBeGreaterThan(0);
      expect(comparison.totalRiskIncrease).toBe(0);
      expect(comparison.summarySentence).toContain('SPATIAL RISK IMPROVEMENT');
    });

    it('identifies spatial risk migration when candidate introduces new hazard zones', () => {
      const baseRun: BenchmarkRun = {
        id: 'BENCH-B',
        name: 'Base Run',
        incidentSnapshots: [],
      } as any;

      const candRun: BenchmarkRun = {
        id: 'BENCH-C',
        name: 'Candidate Regressed',
        incidentSnapshots: [
          {
            id: 'C-INC-1',
            type: 'COLLISION',
            position: [12.0, 0, 8.0],
            simTime: 10,
            wallTime: 2000,
            description: 'New bottleneck collision',
            minClearance: 0,
            ttc: null,
            highestRiskObstacle: null,
            linearVelocity: 1.5,
          },
        ],
      } as any;

      const comparison = service.compareSpatialRisk(baseRun, candRun, 'COMBINED');
      expect(comparison.overallSpatialVerdict).toBe('RISK_INCREASED');
      expect(comparison.totalRiskIncrease).toBeGreaterThan(0);
      expect(comparison.summarySentence).toContain('SPATIAL RISK REGRESSION');
    });
  });
});
