import { describe, it, expect, beforeEach } from 'vitest';
import {
  BenchmarkService,
  MAX_BENCHMARK_RUNS,
} from '../benchmarkService';
import { FlightRecordingSession, TelemetryFrame, IncidentEvent } from '../flightRecorder';
import { RobotConfig, DestinationTarget } from '../../types/simulation';

// Mock localStorage in Node.js test environment
const mockStorage: Record<string, string> = {};
const localStorageMock = {
  getItem: (k: string) => mockStorage[k] || null,
  setItem: (k: string, v: string) => {
    mockStorage[k] = String(v);
  },
  removeItem: (k: string) => {
    delete mockStorage[k];
  },
  clear: () => {
    for (const key of Object.keys(mockStorage)) {
      delete mockStorage[key];
    }
  },
};

(globalThis as any).window = globalThis;
(globalThis as any).localStorage = localStorageMock;

describe('Phase 5.3C: Benchmark Center Service & Evaluation Engine', () => {
  let service: BenchmarkService;

  const mockRobotConfig: RobotConfig = {
    maxLinearSpeed: 2.0,
    maxAngularSpeed: 1.5,
    linearAcceleration: 1.0,
    angularAcceleration: 1.0,
    linearDamping: 0.1,
    angularDamping: 0.1,
    wheelRadius: 0.1,
    trackWidth: 0.5,
  };

  const mockDestinationA: DestinationTarget = {
    id: 'rack-zone-c',
    name: 'Bay C-04',
    position: [12.0, 0, -8.0],
  };

  const mockDestinationB: DestinationTarget = {
    id: 'charging-dock',
    name: 'Docking Base 01',
    position: [0.0, 0, 0.0],
  };

  const createMockSession = (
    recordingId: string,
    isAuthoritative: boolean = true,
    frameCount: number = 30,
    incidentCount: number = 0
  ): FlightRecordingSession => {
    const frames: TelemetryFrame[] = [];
    for (let i = 0; i < frameCount; i++) {
      const t = i * 0.1;
      frames.push({
        simTime: t,
        wallTime: 1700000000000 + i * 100,
        position: [i * 0.2, 0.22, i * 0.1],
        rotation: 0.5,
        linearVelocity: 1.2,
        angularVelocity: 0.05,
        navState: 'MOVING',
        ttc: 3.5,
        minClearance: 1.4,
        safetyStatus: 'SAFE',
        highestRiskObstacle: 'Pallet Jack',
        isCollisionCourse: false,
        activeObstaclesCount: 1,
        lidar: { forward: 3.5, left: 2.0, right: 2.5 },
      });
    }

    const incidents: IncidentEvent[] = [];
    if (incidentCount > 0) {
      incidents.push({
        id: 'INC-1',
        simTime: 1.2,
        wallTime: 1700000001200,
        type: 'NEAR_MISS',
        description: 'Obstacle within near-miss threshold (0.5m)',
        snapshot: {
          simTime: 1.2,
          wallTime: 1700000001200,
          position: [1, 0, 1],
          rotation: 0,
          linearVelocity: 1.0,
          angularVelocity: 0,
          navState: 'MOVING',
          ttc: 1.4,
          minClearance: 0.5,
          safetyStatus: 'WARNING',
          highestRiskObstacle: 'Pallet Jack',
          isCollisionCourse: false,
          activeObstaclesCount: 1,
          lidar: { forward: 1.2, left: 1.0, right: 1.0 },
        },
      });
    }

    return {
      recordingId,
      sessionId: 'RR-TEST-SESSION',
      isAuthoritative,
      userRole: isAuthoritative ? 'operator' : 'controller',
      startTimeSim: 0.0,
      endTimeSim: frameCount * 0.1,
      startTimeWall: 1700000000000,
      endTimeWall: 1700000000000 + frameCount * 100,
      isCompleted: true,
      totalFramesSampled: frameCount,
      hasBufferWrapped: false,
      frames,
      incidents,
    };
  };

  beforeEach(() => {
    localStorage.clear();
    service = new BenchmarkService();
    service.clearAllRuns();
  });

  describe('1. Compilation from Flight Session & Metric Ground Truth', () => {
    it('creates an authoritative BenchmarkRun from a valid FlightRecordingSession', () => {
      const session = createMockSession('REC-001', true, 50, 1);
      const { run } = service.createRunFromSession(
        session,
        'COMPLETED',
        mockRobotConfig,
        mockDestinationA,
        'shortest_safe_path',
        'Warehouse (Standard)',
        'normal',
        'Standard Corridor Test',
        'baseline'
      );

      expect(run.id).toMatch(/^BENCH-/);
      expect(run.name).toBe('Standard Corridor Test');
      expect(run.sourceRecordingId).toBe('REC-001');
      expect(run.result).toBe('COMPLETED');
      expect(run.isAuthoritative).toBe(true);
      expect(run.environment).toBe('Warehouse (Standard)');
      expect(run.difficulty).toBe('normal');
      expect(run.targetDestination).toBe('Bay C-04');
      expect(run.metrics.totalFramesSampled).toBe(50);
      expect(run.metrics.nearMisses).toBe(1);
      expect(run.metrics.distanceTravelledMeters).toBeGreaterThan(0);
      expect(run.indicators.compositeSafetyScore).toBeGreaterThanOrEqual(0);
      expect(run.indicators.compositeSafetyScore).toBeLessThanOrEqual(100);
      expect(run.trajectoryEnvelope.length).toBeLessThanOrEqual(60);
    });

    it('correctly classifies COMPLETED, FAILED, and ABORTED outcomes', () => {
      const session = createMockSession('REC-002', true, 40);

      const runCompleted = service.createRunFromSession(
        session,
        'COMPLETED',
        mockRobotConfig,
        mockDestinationA,
        'default'
      ).run;
      expect(runCompleted.result).toBe('COMPLETED');

      const runFailed = service.createRunFromSession(
        session,
        'FAILED',
        mockRobotConfig,
        mockDestinationA,
        'default'
      ).run;
      expect(runFailed.result).toBe('FAILED');

      const runAborted = service.createRunFromSession(
        session,
        'ABORTED',
        mockRobotConfig,
        mockDestinationA,
        'default'
      ).run;
      expect(runAborted.result).toBe('ABORTED');
    });

    it('guards against division by zero on very short or immediately aborted runs', () => {
      // Session with 2 frames where distance < 1.0m
      const session = createMockSession('REC-SHORT', true, 2, 0);
      const { run } = service.createRunFromSession(
        session,
        'ABORTED',
        mockRobotConfig,
        mockDestinationA,
        'default'
      );

      // Should return null for per-km rates when distance < 1.0m to prevent Infinity/NaN
      expect(run.indicators.nearMissesPerKm).toBeNull();
      expect(run.indicators.collisionsPerKm).toBeNull();
      expect(Number.isFinite(run.indicators.compositeSafetyScore)).toBe(true);
    });
  });

  describe('2. Fair Benchmark Comparison & Comparability Check', () => {
    it('determines runs are comparable when environment, difficulty, and target match', () => {
      const sessionA = createMockSession('REC-A', true, 50);
      const sessionB = createMockSession('REC-B', true, 50);

      const runA = service.createRunFromSession(
        sessionA,
        'COMPLETED',
        mockRobotConfig,
        mockDestinationA,
        'default',
        'Warehouse (Standard)',
        'normal'
      ).run;

      const runB = service.createRunFromSession(
        sessionB,
        'COMPLETED',
        mockRobotConfig,
        mockDestinationA,
        'shortest_safe_path',
        'Warehouse (Standard)',
        'normal'
      ).run;

      const comp = service.checkComparability(runA, runB);
      expect(comp.isComparable).toBe(true);
      expect(comp.mismatchReasons).toHaveLength(0);
    });

    it('detects and flags environment, difficulty, or destination mismatches', () => {
      const sessionA = createMockSession('REC-A', true, 50);
      const sessionB = createMockSession('REC-B', true, 50);

      const runA = service.createRunFromSession(
        sessionA,
        'COMPLETED',
        mockRobotConfig,
        mockDestinationA,
        'default',
        'Warehouse (Standard)',
        'normal'
      ).run;

      const runDiffEnv = service.createRunFromSession(
        sessionB,
        'COMPLETED',
        mockRobotConfig,
        mockDestinationA,
        'default',
        'Warehouse (Dynamic Hazards)',
        'normal'
      ).run;

      const compEnv = service.checkComparability(runA, runDiffEnv);
      expect(compEnv.isComparable).toBe(false);
      expect(compEnv.mismatchReasons.some((r) => r.includes('Environment'))).toBe(true);

      const runDiffDest = service.createRunFromSession(
        sessionB,
        'COMPLETED',
        mockRobotConfig,
        mockDestinationB,
        'default',
        'Warehouse (Standard)',
        'normal'
      ).run;

      const compDest = service.checkComparability(runA, runDiffDest);
      expect(compDest.isComparable).toBe(false);
      expect(compDest.mismatchReasons.some((r) => r.includes('destination'))).toBe(true);
    });

    it('returns NOT_DIRECTLY_COMPARABLE verdict when comparing mismatched runs', () => {
      const sessionA = createMockSession('REC-A', true, 50);
      const sessionB = createMockSession('REC-B', true, 50);

      const runA = service.createRunFromSession(
        sessionA,
        'COMPLETED',
        mockRobotConfig,
        mockDestinationA,
        'default',
        'Warehouse (Standard)',
        'normal'
      ).run;

      const runB = service.createRunFromSession(
        sessionB,
        'COMPLETED',
        mockRobotConfig,
        mockDestinationB,
        'default',
        'Warehouse (Crowded)',
        'hard'
      ).run;

      const comparison = service.compareRuns(runA, runB);
      expect(comparison.comparability.isComparable).toBe(false);
      expect(comparison.overallVerdict).toBe('NOT_DIRECTLY_COMPARABLE');
      expect(comparison.summarySentence).toContain('differ');
    });
  });

  describe('3. Metric Deltas & Absolute Priority on Safety Regressions', () => {
    it('always classifies a candidate with higher collisions as SAFETY_REGRESSION', () => {
      const sessionA = createMockSession('REC-A', true, 50);
      const sessionB = createMockSession('REC-B', true, 40);

      // Baseline: 0 collisions
      const runA = service.createRunFromSession(
        sessionA,
        'COMPLETED',
        mockRobotConfig,
        mockDestinationA,
        'default',
        'Warehouse (Standard)',
        'normal'
      ).run;

      // Candidate: Faster speed, but 2 collisions
      const runB = service.createRunFromSession(
        sessionB,
        'COMPLETED',
        mockRobotConfig,
        mockDestinationA,
        'default',
        'Warehouse (Standard)',
        'normal'
      ).run;
      runB.metrics.collisions = 2;
      runB.metrics.incidentCounts.collisions = 2;

      const comp = service.compareRuns(runA, runB);
      expect(comp.overallVerdict).toBe('SAFETY_REGRESSION');
      expect(comp.deltas.collisions.verdict).toBe('deteriorated');
      expect(comp.deltas.collisions.absoluteDelta).toBe(2);
      expect(comp.summarySentence).toContain('REGRESSION');
    });

    it('identifies SIGNIFICANT_IMPROVEMENT when collisions/near-misses drop and clearance rises', () => {
      const sessionA = createMockSession('REC-A', true, 50, 2);
      const sessionB = createMockSession('REC-B', true, 45, 0);

      const runA = service.createRunFromSession(
        sessionA,
        'COMPLETED',
        mockRobotConfig,
        mockDestinationA,
        'default',
        'Warehouse (Standard)',
        'normal'
      ).run;
      runA.metrics.collisions = 1;
      runA.metrics.nearMisses = 3;
      runA.metrics.minClearanceRecorded = 0.35;
      runA.indicators.compositeSafetyScore = 65;

      const runB = service.createRunFromSession(
        sessionB,
        'COMPLETED',
        mockRobotConfig,
        mockDestinationA,
        'default',
        'Warehouse (Standard)',
        'normal'
      ).run;
      runB.metrics.collisions = 0;
      runB.metrics.nearMisses = 0;
      runB.metrics.minClearanceRecorded = 0.85;
      runB.indicators.compositeSafetyScore = 95;

      const comp = service.compareRuns(runA, runB);
      expect(comp.overallVerdict).toBe('SIGNIFICANT_IMPROVEMENT');
      expect(comp.deltas.collisions.verdict).toBe('improved');
      expect(comp.deltas.nearMisses.verdict).toBe('improved');
      expect(comp.deltas.minClearance.verdict).toBe('improved');
    });

    it('correctly handles percentage calculation when baseline value is zero', () => {
      const sessionA = createMockSession('REC-A', true, 50);
      const sessionB = createMockSession('REC-B', true, 50);

      const runA = service.createRunFromSession(
        sessionA,
        'COMPLETED',
        mockRobotConfig,
        mockDestinationA
      ).run;
      runA.metrics.collisions = 0;

      const runB = service.createRunFromSession(
        sessionB,
        'COMPLETED',
        mockRobotConfig,
        mockDestinationA
      ).run;
      runB.metrics.collisions = 1;

      const comp = service.compareRuns(runA, runB);
      // Percentage change from 0 is undefined (null), but absoluteDelta is 1
      expect(comp.deltas.collisions.percentageChange).toBeNull();
      expect(comp.deltas.collisions.absoluteDelta).toBe(1);
    });
  });

  describe('4. Dashboard Summary & Multiplayer Remote Mirror Exclusion', () => {
    it('calculates aggregate metrics and restricts time to goal exclusively to completed runs', () => {
      const session1 = createMockSession('REC-1', true, 60);
      const session2 = createMockSession('REC-2', true, 40);
      const session3 = createMockSession('REC-3', true, 100);

      // Run 1: Completed, duration 6.0s
      const run1 = service.createRunFromSession(session1, 'COMPLETED', mockRobotConfig, mockDestinationA).run;
      run1.metrics.durationSeconds = 6.0;

      // Run 2: Completed, duration 4.0s
      const run2 = service.createRunFromSession(session2, 'COMPLETED', mockRobotConfig, mockDestinationA).run;
      run2.metrics.durationSeconds = 4.0;

      // Run 3: Failed, duration 10.0s (MUST be excluded from average time to goal)
      const run3 = service.createRunFromSession(session3, 'FAILED', mockRobotConfig, mockDestinationA).run;
      run3.metrics.durationSeconds = 10.0;

      const summary = service.calculateDashboardSummary([run1, run2, run3], false);

      expect(summary.totalRuns).toBe(3);
      expect(summary.completedRuns).toBe(2);
      expect(summary.failedRuns).toBe(1);
      expect(summary.abortedRuns).toBe(0);
      expect(summary.successRate).toBeCloseTo(66.67, 1);
      // Average of completed only: (6.0 + 4.0) / 2 = 5.0s
      expect(summary.avgTimeToGoalSeconds).toBe(5.0);
    });

    it('excludes remote mirror runs from authoritative summary unless explicitly requested', () => {
      const authorSession = createMockSession('REC-AUTH', true, 50);
      const remoteSession = createMockSession('REC-REMOTE', false, 50);

      const authRun = service.createRunFromSession(authorSession, 'COMPLETED', mockRobotConfig, mockDestinationA).run;
      authRun.isAuthoritative = true;

      const remoteRun = service.createRunFromSession(remoteSession, 'COMPLETED', mockRobotConfig, mockDestinationA).run;
      remoteRun.isAuthoritative = false;

      // Exclude remote mirrors
      const summaryDefault = service.calculateDashboardSummary([authRun, remoteRun], false);
      expect(summaryDefault.totalRuns).toBe(1);
      expect(summaryDefault.authoritativeRunsCount).toBe(1);
      expect(summaryDefault.remoteMirrorRunsCount).toBe(1);

      // Include remote mirrors
      const summaryWithRemote = service.calculateDashboardSummary([authRun, remoteRun], true);
      expect(summaryWithRemote.totalRuns).toBe(2);
    });
  });

  describe('5. Bounded Storage & FIFO Eviction (Max 20 Runs)', () => {
    it('enforces maximum 20 runs limit by FIFO evicting the oldest run', () => {
      // Save 22 runs sequentially
      for (let i = 1; i <= 22; i++) {
        const session = createMockSession(`REC-${i}`, true, 10);
        const { evictedRunId } = service.createRunFromSession(
          session,
          'COMPLETED',
          mockRobotConfig,
          mockDestinationA,
          'default',
          'Warehouse',
          'normal',
          `Run #${i}`
        );

        if (i <= MAX_BENCHMARK_RUNS) {
          expect(evictedRunId).toBeNull();
        } else {
          expect(evictedRunId).not.toBeNull();
        }
      }

      const storedRuns = service.getRuns();
      expect(storedRuns.length).toBe(MAX_BENCHMARK_RUNS);
      // Run #1 and #2 must have been evicted; newest at index 0, earliest remaining is Run #3
      expect(storedRuns[0].name).toBe('Run #22');
      expect(storedRuns[storedRuns.length - 1].name).toBe('Run #3');
    });

    it('persists and restores runs from localStorage', () => {
      const session = createMockSession('REC-PERSIST', true, 25);
      service.createRunFromSession(session, 'COMPLETED', mockRobotConfig, mockDestinationA);

      // Create new service instance to verify hydration
      const rehydratedService = new BenchmarkService();
      expect(rehydratedService.getRuns()).toHaveLength(1);
      expect(rehydratedService.getRuns()[0].sourceRecordingId).toBe('REC-PERSIST');
    });
  });

  describe('6. Safe JSON Export & Import Validation', () => {
    it('exports benchmark runs as clean JSON', () => {
      const session = createMockSession('REC-EXP', true, 30);
      const { run } = service.createRunFromSession(session, 'COMPLETED', mockRobotConfig, mockDestinationA);

      const jsonStr = service.exportRunsAsJSON([run.id]);
      const parsed = JSON.parse(jsonStr);

      expect(parsed.format).toBe('RobotRisk-Benchmarks-v1');
      expect(Array.isArray(parsed.runs)).toBe(true);
      expect(parsed.runs).toHaveLength(1);
      expect(parsed.runs[0].id).toBe(run.id);
      expect(parsed.runs[0].metrics).toBeDefined();
    });

    it('safely imports valid benchmark runs', () => {
      const session = createMockSession('REC-IMP', true, 30);
      const { run } = service.createRunFromSession(session, 'COMPLETED', mockRobotConfig, mockDestinationA);
      const jsonStr = service.exportRunsAsJSON([run.id]);

      service.clearAllRuns();
      expect(service.getRuns()).toHaveLength(0);

      const result = service.importRunsFromJSON(jsonStr);
      expect(result.success).toBe(true);
      expect(result.importedCount).toBe(1);
      expect(service.getRuns()).toHaveLength(1);
    });

    it('safely rejects malformed JSON, invalid schemas, or NaN/Infinity values', () => {
      // 1. Malformed JSON
      const res1 = service.importRunsFromJSON('{ not valid json');
      expect(res1.success).toBe(false);
      expect(res1.importedCount).toBe(0);

      // 2. Non-array JSON
      const res2 = service.importRunsFromJSON('{"some": "object"}');
      expect(res2.success).toBe(false);

      // 3. Array with missing required fields
      const res3 = service.importRunsFromJSON(JSON.stringify([{ invalid: 'run' }]));
      expect(res3.importedCount).toBe(0);

      // 4. Object containing NaN or non-finite numbers
      const session = createMockSession('REC-NAN', true, 20);
      const { run } = service.createRunFromSession(session, 'COMPLETED', mockRobotConfig, mockDestinationA);
      const rawRun = JSON.parse(JSON.stringify(run));
      rawRun.metrics.durationSeconds = 'invalid_number';

      const res4 = service.importRunsFromJSON(JSON.stringify([rawRun]));
      expect(res4.importedCount).toBe(0);
    });
  });
});
