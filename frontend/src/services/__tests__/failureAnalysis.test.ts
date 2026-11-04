import { describe, it, expect, beforeEach } from 'vitest';
import {
  failureAnalysisService,
  ScenarioSnapshot,
} from '../failureAnalysisService';
import { SpatialIncident } from '../spatialRiskService';
import { RobotConfig, InteractiveObject, AisleBarrier } from '../../types/simulation';
import { useSimulationStore } from '../../state/useSimulationStore';

describe('AI Failure Analysis & Optimization Advisor Service (Phase 5.4)', () => {
  const defaultRobotConfig: RobotConfig = {
    maxLinearSpeed: 4.0,
    linearAcceleration: 6.0,
    maxAngularSpeed: 2.5,
    angularAcceleration: 4.0,
    linearDamping: 1.0,
    angularDamping: 1.0,
    wheelRadius: 0.1,
    trackWidth: 0.5,
  };

  beforeEach(() => {
    // Reset simulation store state
    useSimulationStore.setState({
      robotConfig: { ...defaultRobotConfig },
      navigationPreference: 'default',
      baselineConfig: null,
      configHistory: [],
      activeScenarioSnapshot: null,
      isAdvisorOpen: false,
      advisorSelectedIncident: null,
    });
  });

  describe('1. Parameter Bounds & Validation', () => {
    it('accepts valid parameters within certified ranges', () => {
      const res = failureAnalysisService.validateParameter('maxLinearSpeed', 3.0);
      expect(res.valid).toBe(true);
      expect(res.clampedValue).toBe(3.0);
      expect(res.error).toBeUndefined();
    });

    it('clamps excessive speed to upper bound', () => {
      const res = failureAnalysisService.validateParameter('maxLinearSpeed', 8.5);
      expect(res.valid).toBe(false);
      expect(res.clampedValue).toBe(5.0);
      expect(res.error).toContain('out of safe range');
    });

    it('clamps sub-minimum acceleration to lower bound', () => {
      const res = failureAnalysisService.validateParameter('linearAcceleration', 0.1);
      expect(res.valid).toBe(false);
      expect(res.clampedValue).toBe(0.5);
      expect(res.error).toContain('out of safe range');
    });

    it('rejects unsupported or arbitrary parameter keys', () => {
      const res = failureAnalysisService.validateParameter('chassisWidth', 1.2);
      expect(res.valid).toBe(false);
      expect(res.error).toContain('Unsupported robot parameter');
    });

    it('rejects non-finite numerical input', () => {
      const res = failureAnalysisService.validateParameter('maxLinearSpeed', 'not_a_number');
      expect(res.valid).toBe(false);
      expect(res.error).toContain('finite numerical value');
    });

    it('validates navigation route preferences', () => {
      expect(failureAnalysisService.validateParameter('navigationPreference', 'shortest_safe_path').valid).toBe(true);
      expect(failureAnalysisService.validateParameter('navigationPreference', 'alternative_route').valid).toBe(true);
      expect(failureAnalysisService.validateParameter('navigationPreference', 'default').valid).toBe(true);

      const invalid = failureAnalysisService.validateParameter('navigationPreference', 'teleport_route');
      expect(invalid.valid).toBe(false);
      expect(invalid.error).toContain('Invalid navigation preference');
    });
  });

  describe('2. Deterministic Collision Failure Analysis', () => {
    const collisionIncident: SpatialIncident = {
      id: 'INC-COLLISION-001',
      type: 'COLLISION',
      position: [-5.0, 0.22, 10.0],
      simTime: 14.5,
      wallTime: Date.now(),
      description: 'Collision with moving obstacle forklift in Aisle 2',
      minClearance: 0.15,
      ttc: 0.7,
      highestRiskObstacle: 'Automated Forklift #2',
      linearVelocity: 3.5,
      stoppingDistance: null,
    };

    it('computes physical stopping distance d = v^2 / 2a correctly', () => {
      const report = failureAnalysisService.generateDeterministicAnalysis(
        collisionIncident,
        defaultRobotConfig,
        'default',
        'Distribution Center'
      );

      expect(report.incidentId).toBe('INC-COLLISION-001');
      expect(report.primaryFailureMode).toBe('INSUFFICIENT_STOPPING_CLEARANCE');
      expect(report.isDeterministicFallback).toBe(true);

      // v = 3.5, a = 6.0 => d_stop = (3.5^2) / (2 * 6.0) = 12.25 / 12 = 1.02m
      const stoppingEvidence = report.measuredEvidence.find((e) =>
        e.metricName.includes('Calculated Stopping Distance')
      );
      expect(stoppingEvidence).toBeDefined();
      expect(stoppingEvidence?.evidenceType).toBe('CALCULATED_PHYSICS');
      expect(stoppingEvidence?.measuredValue).toBe('1.02 m');

      // Measured evidence distinction
      const speedEvidence = report.measuredEvidence.find((e) =>
        e.metricName.includes('Instantaneous Linear Speed')
      );
      expect(speedEvidence?.evidenceType).toBe('MEASURED_GROUND_TRUTH');
      expect(speedEvidence?.measuredValue).toBe('3.50 m/s');
    });

    it('proposes maximum linear speed moderation with clear trade-offs', () => {
      const report = failureAnalysisService.generateDeterministicAnalysis(
        collisionIncident,
        defaultRobotConfig,
        'default',
        'Distribution Center'
      );

      const speedRec = report.recommendations.find((r) => r.category === 'SOFTWARE_PARAMETER');
      expect(speedRec).toBeDefined();
      expect(speedRec?.status).toBe('PENDING_REVIEW');
      expect(speedRec?.isHardwareAdvisory).toBe(false);

      const change = speedRec?.proposedChanges[0];
      expect(change?.parameterKey).toBe('maxLinearSpeed');
      expect(change?.currentValue).toBe(4.0);
      expect(change?.proposedValue).toBeLessThan(4.0);
      expect(change?.proposedValue).toBeGreaterThanOrEqual(0.5);

      expect(speedRec?.potentialTradeoffs).toContain('transit time duration');
    });
  });

  describe('3. Emergency Braking Failure Analysis', () => {
    const eBrakingIncident: SpatialIncident = {
      id: 'INC-BRAKING-002',
      type: 'EMERGENCY_BRAKING',
      position: [2.0, 0.22, -4.0],
      simTime: 8.2,
      wallTime: Date.now(),
      description: 'Emergency stop triggered due to critical deceleration surge',
      minClearance: 0.65,
      ttc: 1.1,
      highestRiskObstacle: 'Pedestrian Barrier',
      linearVelocity: 2.8,
      stoppingDistance: 0.8,
    };

    it('diagnoses aggressive acceleration and recommends smoothing', () => {
      const report = failureAnalysisService.generateDeterministicAnalysis(
        eBrakingIncident,
        defaultRobotConfig,
        'default',
        'Distribution Center'
      );

      expect(report.primaryFailureMode).toBe('SUDDEN_BRAKING_SURGE');
      const accelRec = report.recommendations.find((r) => r.category === 'SOFTWARE_PARAMETER');
      expect(accelRec).toBeDefined();
      expect(accelRec?.title).toContain('Smooth Linear Acceleration Dynamics');

      const change = accelRec?.proposedChanges[0];
      expect(change?.parameterKey).toBe('linearAcceleration');
      expect(change?.proposedValue).toBeLessThan(defaultRobotConfig.linearAcceleration);
    });
  });

  describe('4. Hardware Advisory Isolation', () => {
    it('isolates hardware recommendations and prevents automated parameter tuning', () => {
      const incident: SpatialIncident = {
        id: 'INC-HW-003',
        type: 'TTC_CRITICAL',
        position: [0, 0.22, 0],
        simTime: 5.0,
        wallTime: Date.now(),
        description: 'TTC Critical warning in blind spot',
        minClearance: 0.4,
        ttc: 0.9,
        highestRiskObstacle: 'Pallet Rack Corner',
        linearVelocity: 1.8,
      };

      const report = failureAnalysisService.generateDeterministicAnalysis(
        incident,
        defaultRobotConfig,
        'default',
        'Warehouse'
      );

      const hwRec = report.recommendations.find((r) => r.isHardwareAdvisory);
      expect(hwRec).toBeDefined();
      expect(hwRec?.category).toBe('HARDWARE_ADVISORY');
      // Hardware advisories must never carry automated software parameter diffs
      expect(hwRec?.proposedChanges.length).toBe(0);
      expect(hwRec?.potentialTradeoffs).toContain('Software configuration cannot physically modify hardware');
    });
  });

  describe('5. Scenario Equivalence Verification', () => {
    const testObjects: InteractiveObject[] = [
      { id: 'obj-1', type: 'cube', position: [0, 0, 0], size: 0.8, name: 'Box 1', color: '#3b82f6' },
    ];
    const testBarriers: AisleBarrier[] = [
      { id: 'aisle-1', aisleId: 'aisle-1', name: 'Aisle 1', position: [0, 0.5, 0], width: 2, depth: 0.5, height: 1, rotation: 0 },
    ];

    const baselineSnapshot: ScenarioSnapshot = {
      scenarioId: 'SCENARIO-TEST-001',
      environmentName: 'Warehouse',
      destinationId: 'dest-bay-a',
      destinationName: 'Bay A',
      difficulty: 'hard',
      startPosition: [-14.5, 0.22, -10.5],
      startRotation: 0,
      interactiveObjects: testObjects,
      activeBarriers: testBarriers,
      baselineConfig: { ...defaultRobotConfig },
      navigationPreference: 'default',
      recordedAt: Date.now(),
    };

    it('confirms exact equivalence when conditions are identical', () => {
      const current = {
        destinationId: 'dest-bay-a',
        difficulty: 'hard' as const,
        startPosition: [-14.5, 0.22, -10.5] as [number, number, number],
        interactiveObjects: [...testObjects],
        activeBarriers: [...testBarriers],
      };

      const res = failureAnalysisService.checkScenarioEquivalence(baselineSnapshot, current);
      expect(res.isIdentical).toBe(true);
      expect(res.differences.length).toBe(0);
    });

    it('detects and discloses destination mismatch', () => {
      const divergent = {
        destinationId: 'dest-bay-b',
        difficulty: 'hard' as const,
        startPosition: [-14.5, 0.22, -10.5] as [number, number, number],
        interactiveObjects: [...testObjects],
        activeBarriers: [...testBarriers],
      };

      const res = failureAnalysisService.checkScenarioEquivalence(baselineSnapshot, divergent);
      expect(res.isIdentical).toBe(false);
      expect(res.differences).toContain('Destination mismatch: dest-bay-a vs dest-bay-b');
    });

    it('detects and discloses start position displacement', () => {
      const moved = {
        destinationId: 'dest-bay-a',
        difficulty: 'hard' as const,
        startPosition: [-10.0, 0.22, -10.5] as [number, number, number], // 4.5m shift
        interactiveObjects: [...baselineSnapshot.interactiveObjects],
        activeBarriers: [...baselineSnapshot.activeBarriers],
      };

      const res = failureAnalysisService.checkScenarioEquivalence(baselineSnapshot, moved);
      expect(res.isIdentical).toBe(false);
      expect(res.differences.some((d) => d.includes('Start position altered'))).toBe(true);
    });
  });

  describe('6. Simulation Store Config Versioning & Rollback', () => {
    it('saves scenario snapshots and maintains configuration history', () => {
      const store = useSimulationStore.getState();
      expect(store.baselineConfig).toBeNull();

      // First optimization change
      store.updateRobotConfig({ maxLinearSpeed: 2.5 }, 'AI Advisor: Moderate Speed');
      const state1 = useSimulationStore.getState();

      expect(state1.robotConfig.maxLinearSpeed).toBe(2.5);
      expect(state1.baselineConfig).not.toBeNull();
      expect(state1.baselineConfig?.maxLinearSpeed).toBe(4.0);
      expect(state1.configHistory.length).toBe(1);
      expect(state1.configHistory[0].maxLinearSpeed).toBe(4.0);
      expect(state1.eventLog[0]).toContain('Moderate Speed');
    });

    it('rolls back safely to the baseline configuration', () => {
      const store = useSimulationStore.getState();
      store.updateRobotConfig({ maxLinearSpeed: 2.0, linearAcceleration: 3.0 }, 'Change 1');
      store.updateRobotConfig({ maxLinearSpeed: 1.5 }, 'Change 2');

      expect(useSimulationStore.getState().robotConfig.maxLinearSpeed).toBe(1.5);
      expect(useSimulationStore.getState().configHistory.length).toBe(2);

      // Trigger rollback
      useSimulationStore.getState().rollbackRobotConfig();

      const restored = useSimulationStore.getState();
      expect(restored.robotConfig.maxLinearSpeed).toBe(4.0);
      expect(restored.robotConfig.linearAcceleration).toBe(6.0);
      expect(restored.baselineConfig).toBeNull();
      expect(restored.configHistory.length).toBe(0);
    });
  });

  describe('7. Missing Telemetry Integrity', () => {
    it('handles null or missing telemetry metrics gracefully without inventing data', () => {
      const sparseIncident: SpatialIncident = {
        id: 'INC-SPARSE-004',
        type: 'WARNING',
        position: [0, 0, 0],
        simTime: 1.0,
        wallTime: Date.now(),
        description: 'Sparse incident test',
        minClearance: null,
        ttc: null,
        highestRiskObstacle: null,
        linearVelocity: null,
      };

      const report = failureAnalysisService.generateDeterministicAnalysis(
        sparseIncident,
        defaultRobotConfig,
        'default',
        'Warehouse'
      );

      expect(report.incidentId).toBe('INC-SPARSE-004');
      const clearanceItem = report.measuredEvidence.find((e) => e.metricName.includes('Clearance'));
      expect(clearanceItem).toBeUndefined(); // Does not fabricate measured clearance

      const stoppingItem = report.measuredEvidence.find((e) => e.metricName.includes('Stopping Distance'));
      expect(stoppingItem?.thresholdOrBaseline).toContain('N/A');
    });
  });
});
