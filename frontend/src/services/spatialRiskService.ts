/**
 * Spatial Risk Heatmap & Incident Hotspot Analytics Service
 * 
 * ROBOTRISK AI — PHASE 5.3D
 * 
 * CORE ARCHITECTURAL PRINCIPLES:
 * 1. UNIFORM 1m x 1m GRID:
 *    - 40 columns (X: -20m to +20m) x 32 rows (Z: -16m to +16m) = 1,280 discrete cells.
 *    - Origin (0, 0, 0) is the warehouse center.
 * 2. REAL INCIDENT INTEGRITY:
 *    - Uses exact coordinates and snapshots from Phase 5.3B Flight Recorder and Phase 5.3C Benchmarks.
 *    - Never fabricates or invents coordinates. Out-of-bounds coordinates are safely filtered.
 * 3. NO DOUBLE COUNTING:
 *    - Each incident has a unique id; in COMBINED layer, incidents are evaluated once using primary type.
 * 4. FAIR COMPARATIVE NORMALIZATION:
 *    - Baseline and candidate comparisons share a consistent, identical normalization scale.
 * 5. COVERAGE INTEGRITY:
 *    - Clearly distinguishes OBSERVED (>= 3 samples), INSUFFICIENT TELEMETRY (1-2 samples), and UNTESTED (0 samples).
 *    - Labeled: "Estimated from sampled telemetry (not certified clearance testing)".
 * 6. ZERO-INCIDENT SAFE HANDLING:
 *    - Exact status: "NO INCIDENTS DETECTED IN RECORDED COVERAGE."
 *    - Never declares an environment 100% safe based solely on absence of incidents.
 * 7. TRANSPARENT HEURISTIC RISK:
 *    - All risk indices labeled: "CALCULATED HEURISTIC (NOT CERTIFIED SAFETY MEASUREMENT)".
 */

import { FlightRecordingSession, TelemetryFrame } from './flightRecorder';
import { BenchmarkRun } from './benchmarkService';

export const WAREHOUSE_BOUNDS = {
  minX: -20.0,
  maxX: 20.0,
  minZ: -16.0,
  maxZ: 16.0,
  width: 40.0,
  length: 32.0,
};

export const GRID_COLUMNS = 40; // 40 columns (1m each)
export const GRID_ROWS = 32;    // 32 rows (1m each)
export const CELL_SIZE = 1.0;   // 1.0m resolution
export const TOTAL_GRID_CELLS = 1280;

export type SpatialRiskLayer =
  | 'COMBINED'
  | 'COLLISION'
  | 'NEAR_MISS'
  | 'EMERGENCY_BRAKING'
  | 'TTC_CRITICAL'
  | 'TTC_WARNING';

export const INCIDENT_WEIGHTS: Record<string, number> = {
  COLLISION: 10.0,
  NEAR_MISS: 4.0,
  EMERGENCY_BRAKING: 3.0,
  TTC_CRITICAL: 2.0,
  TTC_WARNING: 1.0,
};

export interface SpatialIncident {
  id: string;
  type: string;
  position: [number, number, number]; // [X, Y, Z]
  simTime: number;
  wallTime: number;
  description: string;
  minClearance: number | null;
  ttc: number | null;
  highestRiskObstacle: string | null;
  linearVelocity: number | null;
  stoppingDistance?: number | null;
  sourceRunId?: string;
  sourceSessionId?: string;
}

export type CellCoverageState = 'UNTESTED' | 'INSUFFICIENT_TELEMETRY' | 'OBSERVED';
export type CellRiskLevel = 'CLEAR' | 'CAUTION' | 'MODERATE' | 'CRITICAL';

export interface SpatialCell {
  col: number; // 0..39
  row: number; // 0..31
  centerX: number; // Physical Three.js X
  centerZ: number; // Physical Three.js Z
  rawRiskScore: number;
  normalizedRiskIndex: number; // 0 - 100
  riskLevel: CellRiskLevel;
  incidentCounts: {
    collisions: number;
    nearMisses: number;
    emergencyBrakings: number;
    ttcCriticals: number;
    ttcWarnings: number;
    total: number;
  };
  sampleCount: number; // Telemetry frame visits
  coverageState: CellCoverageState;
  isNavigableAisle: boolean;
}

export interface SpatialCluster {
  id: string;
  center: [number, number]; // [X, Z]
  incidents: SpatialIncident[];
  dominantType: string;
  count: number;
  radiusMeters: number;
}

export interface SpatialCoverageSummary {
  totalCells: number;
  navigableCells: number;
  observedCells: number;
  insufficientTelemetryCells: number;
  untestedCells: number;
  coveragePercentage: number;
  label: string;
}

export interface SpatialHeatmapData {
  grid: SpatialCell[][]; // [col][row]
  activeLayer: SpatialRiskLayer;
  incidents: SpatialIncident[];
  clusters: SpatialCluster[];
  coverage: SpatialCoverageSummary;
  maxRawScore: number;
  normalizationScale: number;
  normalizationLabel: string;
  statusMessage: string;
}

export interface SpatialComparisonDelta {
  baselineName: string;
  candidateName: string;
  sharedNormalizationScale: number;
  deltaGrid: Array<{
    col: number;
    row: number;
    centerX: number;
    centerZ: number;
    baselineRaw: number;
    candidateRaw: number;
    deltaRaw: number; // candidate - baseline
    deltaNormalized: number;
    verdict: 'IMPROVED' | 'DETERIORATED' | 'NEUTRAL';
  }>;
  totalRiskReduction: number;
  totalRiskIncrease: number;
  overallSpatialVerdict: 'RISK_REDUCED' | 'RISK_INCREASED' | 'SIMILAR_SPATIAL_PROFILE';
  summarySentence: string;
}

export class SpatialRiskService {
  /**
   * Verifies if physical coordinates [X, Z] fall strictly within warehouse bounds.
   */
  public isValidCoordinate(x: number, z: number): boolean {
    return (
      Number.isFinite(x) &&
      Number.isFinite(z) &&
      x >= WAREHOUSE_BOUNDS.minX &&
      x <= WAREHOUSE_BOUNDS.maxX &&
      z >= WAREHOUSE_BOUNDS.minZ &&
      z <= WAREHOUSE_BOUNDS.maxZ
    );
  }

  /**
   * Converts Three.js world coordinates (X, Z) into uniform grid column and row.
   */
  public worldToGrid(x: number, z: number): { col: number; row: number } | null {
    if (!this.isValidCoordinate(x, z)) return null;
    const col = Math.min(GRID_COLUMNS - 1, Math.max(0, Math.floor(x - WAREHOUSE_BOUNDS.minX)));
    const row = Math.min(GRID_ROWS - 1, Math.max(0, Math.floor(z - WAREHOUSE_BOUNDS.minZ)));
    return { col, row };
  }

  /**
   * Converts grid (col, row) back to Three.js world coordinates (center of the 1m cell).
   */
  public gridToWorld(col: number, row: number): { centerX: number; centerZ: number } {
    const centerX = Number((WAREHOUSE_BOUNDS.minX + col + CELL_SIZE / 2).toFixed(2));
    const centerZ = Number((WAREHOUSE_BOUNDS.minZ + row + CELL_SIZE / 2).toFixed(2));
    return { centerX, centerZ };
  }

  /**
   * Normalizes world coordinates to [0, 1] for 2D Canvas or SVG rendering.
   */
  public worldToNormalized(x: number, z: number): { u: number; v: number } {
    const clampedX = Math.max(WAREHOUSE_BOUNDS.minX, Math.min(WAREHOUSE_BOUNDS.maxX, x));
    const clampedZ = Math.max(WAREHOUSE_BOUNDS.minZ, Math.min(WAREHOUSE_BOUNDS.maxZ, z));
    const u = (clampedX - WAREHOUSE_BOUNDS.minX) / WAREHOUSE_BOUNDS.width;
    const v = (clampedZ - WAREHOUSE_BOUNDS.minZ) / WAREHOUSE_BOUNDS.length;
    return { u, v };
  }

  /**
   * Extracts spatial incidents from a FlightRecordingSession.
   */
  public extractIncidentsFromSession(session: FlightRecordingSession): SpatialIncident[] {
    const incidents: SpatialIncident[] = [];
    if (!session || !Array.isArray(session.incidents)) return incidents;

    for (const inc of session.incidents) {
      if (!inc.snapshot || !Array.isArray(inc.snapshot.position)) continue;
      const [x, y, z] = inc.snapshot.position;
      if (!this.isValidCoordinate(x, z)) continue;

      incidents.push({
        id: inc.id || `INC-${inc.simTime.toFixed(2)}`,
        type: inc.type,
        position: [x, y, z],
        simTime: inc.simTime,
        wallTime: inc.wallTime,
        description: inc.description || inc.type,
        minClearance: inc.snapshot.minClearance < 900 ? inc.snapshot.minClearance : null,
        ttc: inc.snapshot.ttc,
        highestRiskObstacle: inc.snapshot.highestRiskObstacle,
        linearVelocity: inc.snapshot.linearVelocity,
        stoppingDistance: inc.details?.stoppingDistance ?? null,
        sourceSessionId: session.sessionId,
      });
    }

    return incidents;
  }

  /**
   * Extracts spatial incidents from a BenchmarkRun.
   */
  public extractIncidentsFromBenchmarkRun(run: BenchmarkRun): SpatialIncident[] {
    const incidents: SpatialIncident[] = [];
    if (!run) return incidents;

    // Check if run contains spatial incident snapshots
    const snapshots = (run as any).incidentSnapshots;
    if (Array.isArray(snapshots)) {
      for (const s of snapshots) {
        if (!Array.isArray(s.position)) continue;
        const [x, y, z] = s.position;
        if (!this.isValidCoordinate(x, z)) continue;
        incidents.push({
          id: s.id || `INC-${s.simTime}`,
          type: s.type,
          position: [x, y, z],
          simTime: s.simTime,
          wallTime: s.wallTime,
          description: s.description || s.type,
          minClearance: s.minClearance ?? null,
          ttc: s.ttc ?? null,
          highestRiskObstacle: s.highestRiskObstacle ?? null,
          linearVelocity: s.linearVelocity ?? null,
          stoppingDistance: s.stoppingDistance ?? null,
          sourceRunId: run.id,
        });
      }
    }

    return incidents;
  }

  /**
   * Evaluates if a physical world point (X, Z) is inside an obstacle (e.g. storage rack).
   */
  public isNavigableAisle(x: number, z: number): boolean {
    // Rack row check: Racks are placed at X in [-10.45, -9.05], [-3.95, -2.55], [2.55, 3.95], [9.05, 10.45]
    // within Z in [-7.75, -1.25] and [1.25, 7.75]
    const rackXSpans = [
      [-10.6, -8.9],
      [-4.1, -2.4],
      [2.4, 4.1],
      [8.9, 10.6],
    ];

    for (const [minRx, maxRx] of rackXSpans) {
      if (x >= minRx && x <= maxRx) {
        if ((z >= -8.0 && z <= -1.0) || (z >= 1.0 && z <= 8.0)) {
          return false; // inside physical rack shelf footprint
        }
      }
    }
    return true;
  }

  /**
   * Filters incidents by selected layer without double-counting.
   */
  public filterIncidentsByLayer(
    incidents: SpatialIncident[],
    layer: SpatialRiskLayer
  ): SpatialIncident[] {
    if (layer === 'COMBINED') {
      // In combined layer, retain every valid unique incident
      const seen = new Set<string>();
      return incidents.filter((inc) => {
        if (seen.has(inc.id)) return false;
        seen.add(inc.id);
        return true;
      });
    }

    // Single layer filters
    return incidents.filter((inc) => {
      switch (layer) {
        case 'COLLISION':
          return inc.type === 'COLLISION';
        case 'NEAR_MISS':
          return inc.type === 'NEAR_MISS';
        case 'EMERGENCY_BRAKING':
          return inc.type === 'EMERGENCY_BRAKING';
        case 'TTC_CRITICAL':
          return inc.type === 'TTC_CRITICAL';
        case 'TTC_WARNING':
          return inc.type === 'TTC_WARNING';
        default:
          return true;
      }
    });
  }

  /**
   * Proximity clustering: Groups incidents within 1.2m into clusters.
   */
  public clusterIncidents(
    incidents: SpatialIncident[],
    proximityThreshold: number = 1.2
  ): SpatialCluster[] {
    const clusters: SpatialCluster[] = [];
    const visited = new Set<string>();

    for (let i = 0; i < incidents.length; i++) {
      const inc = incidents[i];
      if (visited.has(inc.id)) continue;

      const clusterGroup: SpatialIncident[] = [inc];
      visited.add(inc.id);

      for (let j = i + 1; j < incidents.length; j++) {
        const other = incidents[j];
        if (visited.has(other.id)) continue;

        const dist = Math.hypot(
          inc.position[0] - other.position[0],
          inc.position[2] - other.position[2]
        );

        if (dist <= proximityThreshold) {
          clusterGroup.push(other);
          visited.add(other.id);
        }
      }

      // Calculate centroid
      let sumX = 0;
      let sumZ = 0;
      for (const item of clusterGroup) {
        sumX += item.position[0];
        sumZ += item.position[2];
      }
      const centerX = Number((sumX / clusterGroup.length).toFixed(2));
      const centerZ = Number((sumZ / clusterGroup.length).toFixed(2));

      // Dominant incident type
      const typeCounts: Record<string, number> = {};
      for (const item of clusterGroup) {
        typeCounts[item.type] = (typeCounts[item.type] || 0) + 1;
      }
      let dominantType = inc.type;
      let maxCount = 0;
      for (const [t, count] of Object.entries(typeCounts)) {
        if (count > maxCount) {
          maxCount = count;
          dominantType = t;
        }
      }

      clusters.push({
        id: `CLUST-${clusters.length + 1}`,
        center: [centerX, centerZ],
        incidents: clusterGroup,
        dominantType,
        count: clusterGroup.length,
        radiusMeters: proximityThreshold,
      });
    }

    return clusters;
  }

  /**
   * Compiles the complete 40x32 Spatial Heatmap Grid using Gaussian Kernel Density Estimation.
   */
  public generateHeatmapData(
    incidents: SpatialIncident[],
    telemetryFrames: TelemetryFrame[] = [],
    activeLayer: SpatialRiskLayer = 'COMBINED',
    externalNormScale?: number
  ): SpatialHeatmapData {
    const filteredIncidents = this.filterIncidentsByLayer(incidents, activeLayer);

    // 1. Initialize Grid
    const grid: SpatialCell[][] = [];
    for (let c = 0; c < GRID_COLUMNS; c++) {
      grid[c] = [];
      for (let r = 0; r < GRID_ROWS; r++) {
        const { centerX, centerZ } = this.gridToWorld(c, r);
        grid[c][r] = {
          col: c,
          row: r,
          centerX,
          centerZ,
          rawRiskScore: 0,
          normalizedRiskIndex: 0,
          riskLevel: 'CLEAR',
          incidentCounts: {
            collisions: 0,
            nearMisses: 0,
            emergencyBrakings: 0,
            ttcCriticals: 0,
            ttcWarnings: 0,
            total: 0,
          },
          sampleCount: 0,
          coverageState: 'UNTESTED',
          isNavigableAisle: this.isNavigableAisle(centerX, centerZ),
        };
      }
    }

    // 2. Compute Telemetry Frame Coverage (filter jumps > 2.0m)
    for (let i = 0; i < telemetryFrames.length; i++) {
      const frame = telemetryFrames[i];
      if (!frame || !Array.isArray(frame.position)) continue;

      if (i > 0) {
        const prev = telemetryFrames[i - 1];
        const step = Math.hypot(
          frame.position[0] - prev.position[0],
          frame.position[2] - prev.position[2]
        );
        if (step > 2.0) {
          continue; // teleportation or reset jump
        }
      }

      const gridPos = this.worldToGrid(frame.position[0], frame.position[2]);
      if (gridPos) {
        grid[gridPos.col][gridPos.row].sampleCount++;
      }
    }

    // 3. Classify Cell Coverage States
    let observedCells = 0;
    let insufficientCells = 0;
    let untestedCells = 0;
    let navigableCells = 0;

    for (let c = 0; c < GRID_COLUMNS; c++) {
      for (let r = 0; r < GRID_ROWS; r++) {
        const cell = grid[c][r];
        if (cell.isNavigableAisle) {
          navigableCells++;
          if (cell.sampleCount >= 3) {
            cell.coverageState = 'OBSERVED';
            observedCells++;
          } else if (cell.sampleCount >= 1) {
            cell.coverageState = 'INSUFFICIENT_TELEMETRY';
            insufficientCells++;
          } else {
            cell.coverageState = 'UNTESTED';
            untestedCells++;
          }
        } else {
          cell.coverageState = cell.sampleCount >= 3 ? 'OBSERVED' : 'UNTESTED';
        }
      }
    }

    // 4. Incident Placement & Counts
    for (const inc of filteredIncidents) {
      const gridPos = this.worldToGrid(inc.position[0], inc.position[2]);
      if (gridPos) {
        const cell = grid[gridPos.col][gridPos.row];
        cell.incidentCounts.total++;
        if (inc.type === 'COLLISION') cell.incidentCounts.collisions++;
        else if (inc.type === 'NEAR_MISS') cell.incidentCounts.nearMisses++;
        else if (inc.type === 'EMERGENCY_BRAKING') cell.incidentCounts.emergencyBrakings++;
        else if (inc.type === 'TTC_CRITICAL') cell.incidentCounts.ttcCriticals++;
        else if (inc.type === 'TTC_WARNING') cell.incidentCounts.ttcWarnings++;
      }
    }

    // 5. Gaussian Kernel Density Estimation (sigma = 1.2m, cutoff = 3.0m)
    const sigma = 1.2;
    const twoSigmaSq = 2 * sigma * sigma;
    const cutoffDist = 3.0;
    let maxRawScore = 0;

    for (let c = 0; c < GRID_COLUMNS; c++) {
      for (let r = 0; r < GRID_ROWS; r++) {
        const cell = grid[c][r];
        let cellRawRisk = 0;

        for (const inc of filteredIncidents) {
          const dist = Math.hypot(cell.centerX - inc.position[0], cell.centerZ - inc.position[2]);
          if (dist <= cutoffDist) {
            const weight = INCIDENT_WEIGHTS[inc.type] ?? 2.0;
            const kernel = Math.exp(-(dist * dist) / twoSigmaSq);
            cellRawRisk += weight * kernel;
          }
        }

        cell.rawRiskScore = Number(cellRawRisk.toFixed(3));
        if (cell.rawRiskScore > maxRawScore) {
          maxRawScore = cell.rawRiskScore;
        }
      }
    }

    // 6. Risk Normalization (using fixed baseline or shared comparative ceiling)
    const normScale = externalNormScale !== undefined ? externalNormScale : Math.max(15.0, maxRawScore);

    for (let c = 0; c < GRID_COLUMNS; c++) {
      for (let r = 0; r < GRID_ROWS; r++) {
        const cell = grid[c][r];
        const normalized = normScale > 0
          ? Number(Math.min(100, (cell.rawRiskScore / normScale) * 100).toFixed(1))
          : 0;

        cell.normalizedRiskIndex = normalized;

        if (normalized >= 66) {
          cell.riskLevel = 'CRITICAL';
        } else if (normalized >= 36) {
          cell.riskLevel = 'MODERATE';
        } else if (normalized >= 11) {
          cell.riskLevel = 'CAUTION';
        } else {
          cell.riskLevel = 'CLEAR';
        }
      }
    }

    // 7. Proximity Clusters
    const clusters = this.clusterIncidents(filteredIncidents, 1.2);

    // 8. Coverage Summary
    const coveragePercentage = navigableCells > 0
      ? Number(((observedCells / navigableCells) * 100).toFixed(1))
      : 0;

    const coverage: SpatialCoverageSummary = {
      totalCells: TOTAL_GRID_CELLS,
      navigableCells,
      observedCells,
      insufficientTelemetryCells: insufficientCells,
      untestedCells,
      coveragePercentage,
      label: 'Estimated from sampled telemetry (not certified clearance testing)',
    };

    // 9. Exact Zero-Incident Status Message
    const statusMessage = filteredIncidents.length === 0
      ? 'NO INCIDENTS DETECTED IN RECORDED COVERAGE.'
      : `${filteredIncidents.length} spatial incident(s) mapped across ${clusters.length} active risk hotspot(s).`;

    return {
      grid,
      activeLayer,
      incidents: filteredIncidents,
      clusters,
      coverage,
      maxRawScore,
      normalizationScale: normScale,
      normalizationLabel: 'CALCULATED HEURISTIC (NOT CERTIFIED SAFETY MEASUREMENT)',
      statusMessage,
    };
  }

  /**
   * Compares spatial risk maps between a Baseline and Candidate benchmark run.
   * Enforces a shared normalization scale so risk increases are never concealed.
   */
  public compareSpatialRisk(
    baselineRun: BenchmarkRun,
    candidateRun: BenchmarkRun,
    activeLayer: SpatialRiskLayer = 'COMBINED'
  ): SpatialComparisonDelta {
    const baseIncidents = this.extractIncidentsFromBenchmarkRun(baselineRun);
    const candIncidents = this.extractIncidentsFromBenchmarkRun(candidateRun);

    // Compute raw max across both runs to establish a single, fair shared scale
    const rawBase = this.generateHeatmapData(baseIncidents, [], activeLayer, 100.0);
    const rawCand = this.generateHeatmapData(candIncidents, [], activeLayer, 100.0);
    const sharedScale = Math.max(15.0, rawBase.maxRawScore, rawCand.maxRawScore);

    // Re-generate using identical shared scale
    const baseMap = this.generateHeatmapData(baseIncidents, [], activeLayer, sharedScale);
    const candMap = this.generateHeatmapData(candIncidents, [], activeLayer, sharedScale);

    const deltaGrid: SpatialComparisonDelta['deltaGrid'] = [];
    let totalRiskReduction = 0;
    let totalRiskIncrease = 0;

    for (let c = 0; c < GRID_COLUMNS; c++) {
      for (let r = 0; r < GRID_ROWS; r++) {
        const bCell = baseMap.grid[c][r];
        const cCell = candMap.grid[c][r];

        const deltaRaw = Number((cCell.rawRiskScore - bCell.rawRiskScore).toFixed(3));
        const deltaNorm = Number((cCell.normalizedRiskIndex - bCell.normalizedRiskIndex).toFixed(1));

        let verdict: 'IMPROVED' | 'DETERIORATED' | 'NEUTRAL' = 'NEUTRAL';
        if (deltaNorm < -3.0) {
          verdict = 'IMPROVED';
          totalRiskReduction += Math.abs(deltaNorm);
        } else if (deltaNorm > 3.0) {
          verdict = 'DETERIORATED';
          totalRiskIncrease += deltaNorm;
        }

        deltaGrid.push({
          col: c,
          row: r,
          centerX: bCell.centerX,
          centerZ: bCell.centerZ,
          baselineRaw: bCell.rawRiskScore,
          candidateRaw: cCell.rawRiskScore,
          deltaRaw,
          deltaNormalized: deltaNorm,
          verdict,
        });
      }
    }

    let overallSpatialVerdict: SpatialComparisonDelta['overallSpatialVerdict'] = 'SIMILAR_SPATIAL_PROFILE';
    let summarySentence = '';

    if (totalRiskIncrease > totalRiskReduction + 15.0) {
      overallSpatialVerdict = 'RISK_INCREASED';
      summarySentence = `SPATIAL RISK REGRESSION: Candidate generated new or amplified incident hotspots (Net spatial risk delta: +${(totalRiskIncrease - totalRiskReduction).toFixed(1)} pts).`;
    } else if (totalRiskReduction > totalRiskIncrease + 15.0) {
      overallSpatialVerdict = 'RISK_REDUCED';
      summarySentence = `SPATIAL RISK IMPROVEMENT: Candidate mitigated baseline hazard zones (Net spatial risk reduction: -${(totalRiskReduction - totalRiskIncrease).toFixed(1)} pts).`;
    } else {
      overallSpatialVerdict = 'SIMILAR_SPATIAL_PROFILE';
      summarySentence = `SIMILAR SPATIAL PROFILE: Both runs exhibited comparable spatial risk density across corridors.`;
    }

    return {
      baselineName: baselineRun.name,
      candidateName: candidateRun.name,
      sharedNormalizationScale: sharedScale,
      deltaGrid,
      totalRiskReduction: Number(totalRiskReduction.toFixed(1)),
      totalRiskIncrease: Number(totalRiskIncrease.toFixed(1)),
      overallSpatialVerdict,
      summarySentence,
    };
  }
}

// Global Singleton Instance
export const spatialRiskService = new SpatialRiskService();
