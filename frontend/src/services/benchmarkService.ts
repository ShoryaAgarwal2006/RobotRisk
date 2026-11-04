/**
 * Benchmark Center & Evaluation Service
 * 
 * ROBOTRISK AI — PHASE 5.3C
 * 
 * MANDATORY ARCHITECTURAL PRINCIPLES:
 * 1. REAL DATA INTEGRITY:
 *    - Uses actual Flight Recorder telemetry and simulation store mission metrics.
 *    - Never fabricates fake metrics.
 *    - Measured ground-truth values are strictly distinguished from calculated derivative indicators.
 * 2. MISSION OUTCOME CLASSIFICATION:
 *    - COMPLETED: Destination successfully reached.
 *    - FAILED: Physical/corridor navigation failure (navState === 'FAILED').
 *    - ABORTED: Manually stopped or cancelled. Elapsed time reported as time-to-failure/abort, NOT time to goal.
 * 3. FAIR COMPARISON PROTOCOL:
 *    - Strictly checks matching environment, difficulty, and target destination.
 *    - Warns with NOT DIRECTLY COMPARABLE if conditions differ. Never claims an improvement on mismatched runs.
 * 4. SAFETY SCORE TRANSPARENCY:
 *    - Collisions and near-misses remain primary independent metrics.
 *    - Composite score formula is explicitly displayed and labeled: "CALCULATED, NOT CERTIFIED".
 *    - A candidate with more collisions is ALWAYS classified as a SAFETY REGRESSION.
 * 5. MULTIPLAYER ATTRIBUTION:
 *    - Remote Mirror runs (Device B) are excluded from authoritative benchmark statistics by default.
 * 6. BOUNDED STORAGE (MAX 20 RUNS):
 *    - Persisted in localStorage with FIFO eviction upon reaching 20 runs. Eviction is communicated to the user.
 * 7. SAFE IMPORT VALIDATION:
 *    - Rejects invalid, malformed, NaN, or Infinity values safely.
 */

import { RobotConfig, DestinationTarget } from '../types/simulation';
import { FlightRecordingSession } from './flightRecorder';

export type MissionOutcome = 'COMPLETED' | 'FAILED' | 'ABORTED';

export interface BenchmarkRun {
  id: string; // e.g. "BENCH-20261104-X9A2"
  name: string;
  createdAt: number; // Unix timestamp in ms
  sourceRecordingId: string;
  environment: string;
  difficulty: 'normal' | 'hard' | 'extreme';
  startPosition: [number, number];
  targetDestination: string;
  result: MissionOutcome;
  isAuthoritative: boolean;
  userRole: 'operator' | 'controller' | 'local';

  // Robot Configuration Snapshot
  robotConfig: RobotConfig;
  navigationPreference: 'default' | 'shortest_safe_path' | 'alternative_route';

  // Measured Ground-Truth Metrics [MEASURED]
  metrics: {
    durationSeconds: number; // Time to goal (if completed) or elapsed time to failure/abort
    distanceTravelledMeters: number;
    collisions: number;
    nearMisses: number;
    replans: number;
    minClearanceRecorded: number | null; // null if no obstacles sampled
    avgClearanceMeters: number | null;
    avgSpeedMps: number;
    maxSpeedMps: number;
    totalFramesSampled: number;
    incidentCounts: {
      collisions: number;
      nearMisses: number;
      ttcCritical: number;
      ttcWarning: number;
      emergencyBraking: number;
    };
  };

  // Derived Indicators [CALCULATED - NOT CERTIFIED]
  indicators: {
    nearMissesPerKm: number | null;
    collisionsPerKm: number | null;
    /** Calculated heuristic safety score (0 - 100). NOT an official safety standard. */
    compositeSafetyScore: number;
    pathEfficiencyScore: number;
  };

  // Downsampled Path Trajectory Envelope (Max 60 points for path drawing)
  trajectoryEnvelope: Array<[number, number]>;

  // Spatial Incident Snapshots for Spatial Risk Heatmap (Phase 5.3D)
  incidentSnapshots?: Array<{
    id: string;
    type: string;
    position: [number, number, number];
    simTime: number;
    wallTime: number;
    description: string;
    minClearance: number | null;
    ttc: number | null;
    highestRiskObstacle: string | null;
    linearVelocity: number | null;
  }>;

  variantTag: 'baseline' | 'optimized' | 'custom';
  notes?: string;
}

export interface ComparabilityResult {
  isComparable: boolean;
  mismatchReasons: string[];
}

export interface MetricDelta {
  metricKey: string;
  label: string;
  isCalculated: boolean;
  baselineValue: number | null;
  candidateValue: number | null;
  absoluteDelta: number | null;
  percentageChange: number | null; // null if baseline was 0 or values missing
  verdict: 'improved' | 'deteriorated' | 'neutral' | 'inconclusive';
  unit: string;
}

export interface BenchmarkComparison {
  baselineRun: BenchmarkRun;
  candidateRun: BenchmarkRun;
  comparability: ComparabilityResult;
  deltas: {
    timeToGoal: MetricDelta;
    distance: MetricDelta;
    collisions: MetricDelta;
    nearMisses: MetricDelta;
    nearMissesPerKm: MetricDelta;
    minClearance: MetricDelta;
    avgClearance: MetricDelta;
    avgSpeed: MetricDelta;
    replans: MetricDelta;
    safetyScore: MetricDelta;
  };
  overallVerdict:
    | 'SIGNIFICANT_IMPROVEMENT'
    | 'MODERATE_IMPROVEMENT'
    | 'SIMILAR_PERFORMANCE'
    | 'PERFORMANCE_REGRESSION'
    | 'SAFETY_REGRESSION'
    | 'NOT_DIRECTLY_COMPARABLE';
  summarySentence: string;
}

export interface BenchmarkDashboardSummary {
  totalRuns: number;
  completedRuns: number;
  failedRuns: number;
  abortedRuns: number;
  successRate: number; // Percentage (0 - 100)
  avgTimeToGoalSeconds: number | null; // Completed runs only
  totalCollisions: number;
  totalNearMisses: number;
  overallNearMissesPerKm: number | null;
  avgMinClearanceMeters: number | null;
  authoritativeRunsCount: number;
  remoteMirrorRunsCount: number;
}

export const MAX_BENCHMARK_RUNS = 20;
const STORAGE_KEY = 'robotrisk_benchmark_runs_v1';

export class BenchmarkService {
  private runs: BenchmarkRun[] = [];

  constructor() {
    this.loadFromStorage();
  }

  /**
   * Loads persisted benchmark runs from localStorage.
   */
  public loadFromStorage(): void {
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.runs = parsed.filter(this.isValidRunObject);
        }
      }
    } catch (e) {
      console.warn('Failed to load benchmark runs from localStorage:', e);
      this.runs = [];
    }
  }

  /**
   * Persists current benchmark runs to localStorage.
   */
  public saveToStorage(): void {
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.runs));
    } catch (e) {
      console.warn('Failed to persist benchmark runs to localStorage:', e);
    }
  }

  /**
   * Compiles a completed FlightRecordingSession and store state into an authoritative BenchmarkRun.
   */
  public createRunFromSession(
    session: FlightRecordingSession,
    missionOutcome: MissionOutcome,
    robotConfig: RobotConfig,
    destination: DestinationTarget | null,
    navigationPreference: 'default' | 'shortest_safe_path' | 'alternative_route' = 'default',
    environmentName: string = 'Warehouse - Baseline',
    difficulty: 'normal' | 'hard' | 'extreme' = 'normal',
    customName?: string,
    variantTag: 'baseline' | 'optimized' | 'custom' = 'custom',
    notes?: string
  ): { run: BenchmarkRun; evictedRunId: string | null } {
    const frames = session.frames || [];
    const duration = Math.max(0, session.endTimeSim - session.startTimeSim);

    // 1. Calculate actual distance travelled from frames displacement
    let distanceTravelled = 0;
    for (let i = 1; i < frames.length; i++) {
      const p1 = frames[i - 1].position;
      const p2 = frames[i].position;
      const step = Math.hypot(p2[0] - p1[0], p2[2] - p1[2]);
      if (step < 2.0) { // filter teleportation / reset jumps
        distanceTravelled += step;
      }
    }
    distanceTravelled = Number(distanceTravelled.toFixed(2));

    // 2. Incident Counts
    const collisions = session.incidents.filter((i) => i.type === 'COLLISION').length;
    const nearMisses = session.incidents.filter((i) => i.type === 'NEAR_MISS').length;
    const ttcCritical = session.incidents.filter((i) => i.type === 'TTC_CRITICAL').length;
    const ttcWarning = session.incidents.filter((i) => i.type === 'TTC_WARNING').length;
    const emergencyBraking = session.incidents.filter((i) => i.type === 'EMERGENCY_BRAKING').length;
    const replans = session.incidents.filter((i) => i.type === 'ROUTE_RECALCULATED').length;

    // 3. Clearances & Speeds (only valid if frames sampled)
    let minClearanceRecorded: number | null = null;
    let avgClearanceMeters: number | null = null;
    let maxSpeedMps = 0;
    let avgSpeedMps = 0;

    if (frames.length > 0) {
      let clearanceSum = 0;
      let validClearanceCount = 0;
      let speedSum = 0;

      for (const f of frames) {
        if (f.minClearance < 900) { // filter default unbounded 999m clearance
          if (minClearanceRecorded === null || f.minClearance < minClearanceRecorded) {
            minClearanceRecorded = f.minClearance;
          }
          clearanceSum += f.minClearance;
          validClearanceCount++;
        }
        speedSum += Math.abs(f.linearVelocity);
        if (Math.abs(f.linearVelocity) > maxSpeedMps) {
          maxSpeedMps = Math.abs(f.linearVelocity);
        }
      }

      if (validClearanceCount > 0) {
        avgClearanceMeters = Number((clearanceSum / validClearanceCount).toFixed(3));
      }
      avgSpeedMps = Number((speedSum / frames.length).toFixed(2));
      maxSpeedMps = Number(maxSpeedMps.toFixed(2));
      if (minClearanceRecorded !== null) {
        minClearanceRecorded = Number(minClearanceRecorded.toFixed(3));
      }
    }

    // 4. Rate Indicators: Near-misses and collisions per kilometre
    let nearMissesPerKm: number | null = null;
    let collisionsPerKm: number | null = null;
    if (distanceTravelled >= 1.0) {
      const km = distanceTravelled / 1000.0;
      nearMissesPerKm = Number((nearMisses / km).toFixed(2));
      collisionsPerKm = Number((collisions / km).toFixed(2));
    }

    // 5. Composite Safety Score (CALCULATED, NOT CERTIFIED)
    // Formula: 100 - (collisions * 40 + nearMisses * 10 + ttcCritical * 5 + penalty for sub-0.45m clearance)
    let penalty = collisions * 40 + nearMisses * 10 + ttcCritical * 5;
    if (minClearanceRecorded !== null && minClearanceRecorded < 0.45 && collisions === 0) {
      penalty += 15;
    }
    const compositeSafetyScore = Math.max(0, Math.min(100, Math.round(100 - penalty)));

    // 6. Path Efficiency Score (Euclidean distance to goal vs actual distance traversed)
    const startPos: [number, number] = frames.length > 0
      ? [frames[0].position[0], frames[0].position[2]]
      : [-14.5, -10.5];

    let pathEfficiencyScore = 100;
    if (destination && distanceTravelled > 1.0) {
      const directDist = Math.hypot(destination.position[0] - startPos[0], destination.position[2] - startPos[1]);
      pathEfficiencyScore = Math.min(100, Math.round((directDist / distanceTravelled) * 100));
    }

    // 7. Downsampled 60-point Trajectory Envelope
    const trajectoryEnvelope: Array<[number, number]> = [];
    if (frames.length > 0) {
      const step = Math.max(1, Math.floor(frames.length / 60));
      for (let i = 0; i < frames.length; i += step) {
        trajectoryEnvelope.push([
          Number(frames[i].position[0].toFixed(2)),
          Number(frames[i].position[2].toFixed(2)),
        ]);
      }
    }

    const runId = `BENCH-${new Date().toISOString().replace(/[-:]/g, '').split('.')[0]}-${Math.random().toString(36).substring(2, 5).toUpperCase()}`;
    const defaultName = `${environmentName} — ${missionOutcome === 'COMPLETED' ? 'Success' : missionOutcome} (${duration.toFixed(1)}s)`;

    const run: BenchmarkRun = {
      id: runId,
      name: customName || defaultName,
      createdAt: Date.now(),
      sourceRecordingId: session.recordingId,
      environment: environmentName,
      difficulty,
      startPosition: startPos,
      targetDestination: destination?.name || 'Warehouse Bay',
      result: missionOutcome,
      isAuthoritative: session.isAuthoritative,
      userRole: session.userRole,
      robotConfig: { ...robotConfig },
      navigationPreference,
      metrics: {
        durationSeconds: Number(duration.toFixed(2)),
        distanceTravelledMeters: distanceTravelled,
        collisions,
        nearMisses,
        replans,
        minClearanceRecorded,
        avgClearanceMeters,
        avgSpeedMps,
        maxSpeedMps,
        totalFramesSampled: frames.length,
        incidentCounts: {
          collisions,
          nearMisses,
          ttcCritical,
          ttcWarning,
          emergencyBraking,
        },
      },
      indicators: {
        nearMissesPerKm,
        collisionsPerKm,
        compositeSafetyScore,
        pathEfficiencyScore,
      },
      trajectoryEnvelope,
      incidentSnapshots: (session.incidents || []).map((inc) => ({
        id: inc.id,
        type: inc.type,
        position: inc.snapshot.position,
        simTime: inc.simTime,
        wallTime: inc.wallTime,
        description: inc.description,
        minClearance: inc.snapshot.minClearance < 900 ? inc.snapshot.minClearance : null,
        ttc: inc.snapshot.ttc,
        highestRiskObstacle: inc.snapshot.highestRiskObstacle,
        linearVelocity: inc.snapshot.linearVelocity,
      })),
      variantTag,
      notes,
    };

    const evictedId = this.saveRun(run);
    return { run, evictedRunId: evictedId };
  }

  /**
   * Saves a benchmark run into memory and localStorage with visible 20-run FIFO eviction.
   */
  public saveRun(run: BenchmarkRun): string | null {
    let evictedRunId: string | null = null;

    // Check if run already exists (update)
    const existingIdx = this.runs.findIndex((r) => r.id === run.id);
    if (existingIdx >= 0) {
      this.runs[existingIdx] = run;
    } else {
      // FIFO eviction if at capacity
      if (this.runs.length >= MAX_BENCHMARK_RUNS) {
        const oldest = this.runs.pop();
        evictedRunId = oldest ? oldest.id : null;
      }
      this.runs.unshift(run);
    }

    this.saveToStorage();
    return evictedRunId;
  }

  public getAllRuns(): BenchmarkRun[] {
    return [...this.runs];
  }

  public getRuns(): BenchmarkRun[] {
    return this.getAllRuns();
  }

  public getRunById(id: string): BenchmarkRun | null {
    return this.runs.find((r) => r.id === id) || null;
  }

  public deleteRun(id: string): boolean {
    const initialLen = this.runs.length;
    this.runs = this.runs.filter((r) => r.id !== id);
    if (this.runs.length !== initialLen) {
      this.saveToStorage();
      return true;
    }
    return false;
  }

  public clearAllRuns(): void {
    this.runs = [];
    this.saveToStorage();
  }

  /**
   * Evaluates whether two runs have matching conditions to qualify as directly comparable.
   */
  public checkComparability(baseline: BenchmarkRun, candidate: BenchmarkRun): ComparabilityResult {
    const mismatchReasons: string[] = [];

    if (baseline.environment !== candidate.environment) {
      mismatchReasons.push(`Environment mismatch: "${baseline.environment}" vs "${candidate.environment}"`);
    }
    if (baseline.difficulty !== candidate.difficulty) {
      mismatchReasons.push(`Difficulty mismatch: ${baseline.difficulty.toUpperCase()} vs ${candidate.difficulty.toUpperCase()}`);
    }
    if (baseline.targetDestination !== candidate.targetDestination) {
      mismatchReasons.push(`Target destination mismatch: "${baseline.targetDestination}" vs "${candidate.targetDestination}"`);
    }

    return {
      isComparable: mismatchReasons.length === 0,
      mismatchReasons,
    };
  }

  /**
   * Helper to compute comparative metric deltas between Baseline and Candidate runs.
   */
  public computeDelta(
    key: string,
    label: string,
    isCalculated: boolean,
    baselineVal: number | null,
    candidateVal: number | null,
    betterDirection: 'lower' | 'higher',
    unit: string
  ): MetricDelta {
    if (baselineVal === null || candidateVal === null || !Number.isFinite(baselineVal) || !Number.isFinite(candidateVal)) {
      return {
        metricKey: key,
        label,
        isCalculated,
        baselineValue: baselineVal,
        candidateValue: candidateVal,
        absoluteDelta: null,
        percentageChange: null,
        verdict: 'inconclusive',
        unit,
      };
    }

    const absoluteDelta = Number((candidateVal - baselineVal).toFixed(2));
    let percentageChange: number | null = null;

    if (Math.abs(baselineVal) > 1e-6) {
      percentageChange = Number(((absoluteDelta / baselineVal) * 100).toFixed(1));
    }

    let verdict: 'improved' | 'deteriorated' | 'neutral' = 'neutral';
    if (Math.abs(absoluteDelta) > 0.001) {
      if (betterDirection === 'lower') {
        verdict = absoluteDelta < 0 ? 'improved' : 'deteriorated';
      } else {
        verdict = absoluteDelta > 0 ? 'improved' : 'deteriorated';
      }
    }

    return {
      metricKey: key,
      label,
      isCalculated,
      baselineValue: baselineVal,
      candidateValue: candidateVal,
      absoluteDelta,
      percentageChange,
      verdict,
      unit,
    };
  }

  /**
   * Compares two benchmark runs side-by-side with strict fairness, delta math, and safety integrity.
   */
  public compareRuns(baseline: BenchmarkRun, candidate: BenchmarkRun): BenchmarkComparison {
    const comparability = this.checkComparability(baseline, candidate);

    const deltas = {
      timeToGoal: this.computeDelta(
        'timeToGoal',
        baseline.result === 'COMPLETED' ? 'Time to Goal' : 'Elapsed Time to Failure/Abort',
        false,
        baseline.metrics.durationSeconds,
        candidate.metrics.durationSeconds,
        'lower',
        's'
      ),
      distance: this.computeDelta(
        'distance',
        'Distance Traversed',
        false,
        baseline.metrics.distanceTravelledMeters,
        candidate.metrics.distanceTravelledMeters,
        'lower',
        'm'
      ),
      collisions: this.computeDelta(
        'collisions',
        'Physical Collisions',
        false,
        baseline.metrics.collisions,
        candidate.metrics.collisions,
        'lower',
        ''
      ),
      nearMisses: this.computeDelta(
        'nearMisses',
        'Near-Miss Incidents',
        false,
        baseline.metrics.nearMisses,
        candidate.metrics.nearMisses,
        'lower',
        ''
      ),
      nearMissesPerKm: this.computeDelta(
        'nearMissesPerKm',
        'Near-Misses per Km',
        true,
        baseline.indicators.nearMissesPerKm,
        candidate.indicators.nearMissesPerKm,
        'lower',
        '/km'
      ),
      minClearance: this.computeDelta(
        'minClearance',
        'Minimum Clearance Recorded',
        false,
        baseline.metrics.minClearanceRecorded,
        candidate.metrics.minClearanceRecorded,
        'higher',
        'm'
      ),
      avgClearance: this.computeDelta(
        'avgClearance',
        'Average Clearance Maintained',
        true,
        baseline.metrics.avgClearanceMeters,
        candidate.metrics.avgClearanceMeters,
        'higher',
        'm'
      ),
      avgSpeed: this.computeDelta(
        'avgSpeed',
        'Average Speed',
        false,
        baseline.metrics.avgSpeedMps,
        candidate.metrics.avgSpeedMps,
        'higher',
        'm/s'
      ),
      replans: this.computeDelta(
        'replans',
        'Dynamic Replans',
        false,
        baseline.metrics.replans,
        candidate.metrics.replans,
        'lower',
        ''
      ),
      safetyScore: this.computeDelta(
        'safetyScore',
        'Composite Safety Rating',
        true,
        baseline.indicators.compositeSafetyScore,
        candidate.indicators.compositeSafetyScore,
        'higher',
        '/100'
      ),
    };

    // Overall Verdict Calculation with Safety Integrity:
    // If not comparable -> NOT_DIRECTLY_COMPARABLE
    // If candidate has MORE collisions -> ALWAYS SAFETY_REGRESSION
    let overallVerdict: BenchmarkComparison['overallVerdict'] = 'SIMILAR_PERFORMANCE';
    let summarySentence = '';

    if (!comparability.isComparable) {
      overallVerdict = 'NOT_DIRECTLY_COMPARABLE';
      summarySentence = `Warning: Runs are not directly comparable due to differences: ${comparability.mismatchReasons.join('; ')}.`;
    } else if (candidate.metrics.collisions > baseline.metrics.collisions) {
      overallVerdict = 'SAFETY_REGRESSION';
      summarySentence = `CRITICAL REGRESSION: Candidate produced +${candidate.metrics.collisions - baseline.metrics.collisions} collision(s). Safety protocol compromised.`;
    } else if (candidate.metrics.collisions < baseline.metrics.collisions) {
      overallVerdict = 'SIGNIFICANT_IMPROVEMENT';
      summarySentence = `SIGNIFICANT IMPROVEMENT: Candidate eliminated ${baseline.metrics.collisions - candidate.metrics.collisions} collision(s) with ${candidate.indicators.compositeSafetyScore}/100 safety score.`;
    } else if (candidate.result === 'COMPLETED' && baseline.result !== 'COMPLETED') {
      overallVerdict = 'SIGNIFICANT_IMPROVEMENT';
      summarySentence = `MISSION SUCCESS: Candidate completed mission whereas baseline resulted in ${baseline.result}.`;
    } else if (candidate.result !== 'COMPLETED' && baseline.result === 'COMPLETED') {
      overallVerdict = 'PERFORMANCE_REGRESSION';
      summarySentence = `FAILURE REGRESSION: Candidate failed or aborted mission whereas baseline completed successfully.`;
    } else if (deltas.nearMisses.verdict === 'deteriorated' && candidate.metrics.nearMisses > baseline.metrics.nearMisses + 1) {
      overallVerdict = 'SAFETY_REGRESSION';
      summarySentence = `SAFETY REGRESSION: Candidate recorded ${candidate.metrics.nearMisses - baseline.metrics.nearMisses} additional near-misses.`;
    } else if (deltas.nearMisses.verdict === 'improved' && deltas.timeToGoal.verdict === 'improved') {
      overallVerdict = 'SIGNIFICANT_IMPROVEMENT';
      summarySentence = `DUAL IMPROVEMENT: Candidate was ${Math.abs(deltas.timeToGoal.absoluteDelta || 0)}s faster and reduced near-misses by ${Math.abs(deltas.nearMisses.absoluteDelta || 0)}.`;
    } else if (deltas.minClearance.verdict === 'improved' || deltas.nearMisses.verdict === 'improved') {
      overallVerdict = 'MODERATE_IMPROVEMENT';
      summarySentence = `MODERATE IMPROVEMENT: Candidate demonstrated enhanced obstacle clearance (${candidate.metrics.minClearanceRecorded?.toFixed(2) || 'N/A'}m).`;
    } else if (deltas.timeToGoal.verdict === 'deteriorated' && (deltas.timeToGoal.percentageChange || 0) > 25) {
      overallVerdict = 'PERFORMANCE_REGRESSION';
      summarySentence = `PERFORMANCE REGRESSION: Candidate mission duration increased significantly (+${deltas.timeToGoal.percentageChange}%).`;
    } else {
      overallVerdict = 'SIMILAR_PERFORMANCE';
      summarySentence = `SIMILAR PERFORMANCE: Both configurations exhibited comparable navigation and clearance metrics.`;
    }

    return {
      baselineRun: baseline,
      candidateRun: candidate,
      comparability,
      deltas,
      overallVerdict,
      summarySentence,
    };
  }

  /**
   * Computes aggregate dashboard KPIs across saved benchmark runs.
   * By default, excludes REMOTE MIRROR runs to preserve authoritative data integrity.
   */
  public getDashboardSummary(
    includeRemoteMirrors: boolean = false,
    customRuns?: BenchmarkRun[]
  ): BenchmarkDashboardSummary {
    const sourceRuns = customRuns || this.runs;
    const filteredRuns = includeRemoteMirrors
      ? sourceRuns
      : sourceRuns.filter((r) => r.isAuthoritative);

    const totalRuns = filteredRuns.length;
    const authoritativeRunsCount = sourceRuns.filter((r) => r.isAuthoritative).length;
    const remoteMirrorRunsCount = sourceRuns.filter((r) => !r.isAuthoritative).length;

    if (totalRuns === 0) {
      return {
        totalRuns: 0,
        completedRuns: 0,
        failedRuns: 0,
        abortedRuns: 0,
        successRate: 0,
        avgTimeToGoalSeconds: null,
        totalCollisions: 0,
        totalNearMisses: 0,
        overallNearMissesPerKm: null,
        avgMinClearanceMeters: null,
        authoritativeRunsCount,
        remoteMirrorRunsCount,
      };
    }

    let completedRuns = 0;
    let failedRuns = 0;
    let abortedRuns = 0;
    let completedDurationSum = 0;
    let totalCollisions = 0;
    let totalNearMisses = 0;
    let totalDistanceTraversed = 0;
    let minClearanceSum = 0;
    let validMinClearanceCount = 0;

    for (const r of filteredRuns) {
      if (r.result === 'COMPLETED') {
        completedRuns++;
        completedDurationSum += r.metrics.durationSeconds;
      } else if (r.result === 'FAILED') {
        failedRuns++;
      } else {
        abortedRuns++;
      }

      totalCollisions += r.metrics.collisions;
      totalNearMisses += r.metrics.nearMisses;
      totalDistanceTraversed += r.metrics.distanceTravelledMeters;

      if (r.metrics.minClearanceRecorded !== null) {
        minClearanceSum += r.metrics.minClearanceRecorded;
        validMinClearanceCount++;
      }
    }

    const successRate = Number(((completedRuns / totalRuns) * 100).toFixed(1));
    const avgTimeToGoalSeconds = completedRuns > 0
      ? Number((completedDurationSum / completedRuns).toFixed(2))
      : null;

    let overallNearMissesPerKm: number | null = null;
    if (totalDistanceTraversed >= 1.0) {
      overallNearMissesPerKm = Number((totalNearMisses / (totalDistanceTraversed / 1000)).toFixed(2));
    }

    const avgMinClearanceMeters = validMinClearanceCount > 0
      ? Number((minClearanceSum / validMinClearanceCount).toFixed(3))
      : null;

    return {
      totalRuns,
      completedRuns,
      failedRuns,
      abortedRuns,
      successRate,
      avgTimeToGoalSeconds,
      totalCollisions,
      totalNearMisses,
      overallNearMissesPerKm,
      avgMinClearanceMeters,
      authoritativeRunsCount,
      remoteMirrorRunsCount,
    };
  }

  /**
   * Helper alias for computing dashboard summary for custom runs array.
   */
  public calculateDashboardSummary(
    runs?: BenchmarkRun[],
    includeRemoteMirrors: boolean = false
  ): BenchmarkDashboardSummary {
    return this.getDashboardSummary(includeRemoteMirrors, runs);
  }

  /**
   * Export all stored benchmark runs as a validated JSON bundle.
   */
  public exportBenchmarksJSON(): string {
    const bundle = {
      format: 'RobotRisk-Benchmarks-v1',
      version: '1.0',
      exportedAtISO: new Date().toISOString(),
      runsCount: this.runs.length,
      summary: this.getDashboardSummary(true),
      runs: this.runs,
    };
    return JSON.stringify(bundle, null, 2);
  }

  /**
   * Export selected or all benchmark runs as a JSON bundle.
   */
  public exportRunsAsJSON(runIds?: string[]): string {
    const runsToExport = runIds && runIds.length > 0
      ? this.runs.filter((r) => runIds.includes(r.id))
      : this.runs;

    const bundle = {
      format: 'RobotRisk-Benchmarks-v1',
      version: '1.0',
      exportedAtISO: new Date().toISOString(),
      runsCount: runsToExport.length,
      summary: this.getDashboardSummary(true, runsToExport),
      runs: runsToExport,
    };
    return JSON.stringify(bundle, null, 2);
  }

  /**
   * Helper method that imports runs and returns a boolean success status.
   */
  public importRunsFromJSON(jsonStr: string): { success: boolean; importedCount: number; errors: string[] } {
    const res = this.importBenchmarksJSON(jsonStr);
    return {
      success: res.importedCount > 0 && res.errors.length === 0,
      importedCount: res.importedCount,
      errors: res.errors,
    };
  }

  /**
   * Imports benchmark runs from a JSON string with strict schema and numerical validation.
   */
  public importBenchmarksJSON(jsonStr: string): { importedCount: number; errors: string[] } {
    const errors: string[] = [];
    let parsed: any;

    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      return { importedCount: 0, errors: ['Invalid JSON syntax: could not parse file.'] };
    }

    if (!parsed || parsed.format !== 'RobotRisk-Benchmarks-v1') {
      return { importedCount: 0, errors: ['Incompatible format: missing format "RobotRisk-Benchmarks-v1".'] };
    }

    if (!Array.isArray(parsed.runs)) {
      return { importedCount: 0, errors: ['Invalid schema: "runs" property must be an array.'] };
    }

    let validImported = 0;
    for (let i = 0; i < parsed.runs.length; i++) {
      const candidate = parsed.runs[i];
      if (this.isValidRunObject(candidate)) {
        this.saveRun(candidate);
        validImported++;
      } else {
        errors.push(`Run at index ${i} failed validation checks and was skipped.`);
      }
    }

    return { importedCount: validImported, errors };
  }

  /**
   * Schema and numerical sanitization validator.
   */
  private isValidRunObject(obj: any): obj is BenchmarkRun {
    if (!obj || typeof obj !== 'object') return false;
    if (typeof obj.id !== 'string' || !obj.id.startsWith('BENCH-')) return false;
    if (typeof obj.name !== 'string') return false;
    if (!Number.isFinite(obj.createdAt)) return false;
    if (!['COMPLETED', 'FAILED', 'ABORTED'].includes(obj.result)) return false;
    if (!obj.metrics || typeof obj.metrics !== 'object') return false;
    if (!Number.isFinite(obj.metrics.durationSeconds) || obj.metrics.durationSeconds < 0) return false;
    if (!Number.isFinite(obj.metrics.distanceTravelledMeters) || obj.metrics.distanceTravelledMeters < 0) return false;
    if (!Number.isFinite(obj.metrics.collisions) || obj.metrics.collisions < 0) return false;
    if (!Number.isFinite(obj.metrics.nearMisses) || obj.metrics.nearMisses < 0) return false;
    if (!obj.indicators || typeof obj.indicators !== 'object') return false;
    if (!Number.isFinite(obj.indicators.compositeSafetyScore)) return false;
    return true;
  }
}

// Global Singleton Instance
export const benchmarkService = new BenchmarkService();
