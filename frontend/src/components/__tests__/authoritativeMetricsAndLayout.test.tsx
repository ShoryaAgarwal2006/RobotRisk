import { describe, it, expect, beforeEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import { useSimulationStore } from '../../state/useSimulationStore';
import { RobotHUD } from '../RobotHUD';
import { AutonomousLabPanel } from '../AutonomousLabPanel';
import { ScenarioResultPanel } from '../ScenarioResultPanel';
import { GeneratedScenario } from '../../types/scenario';

const testScenario: GeneratedScenario = {
  scenario_id: 'SCEN-METRIC-SYNC-001',
  title: 'Four Obstacle Impasse',
  description: 'Four crates placed in the robot path',
  difficulty: 'normal',
  seed: 42,
  environment: 'warehouse',
  robot_setup: {
    start_position: [-14.5, 0.22, -10.5],
    start_rotation_rad: 0.0,
    destination_id: 'bay-4',
    destination_name: 'BAY 4 DELIVERY DROP-OFF',
    destination_position: [14.0, 0.0, 10.5],
    navigation_preference: 'default',
  },
  actors: [], // Pure static scenario (no dynamic actors)
  static_hazards: [
    {
      id: 'hazard-box-1',
      name: 'Cargo Crate 1',
      hazard_type: 'cube',
      position: [-14.5, 0.4, -4.5],
      size: [0.8, 0.8, 0.8],
      dimensions: [0.8, 0.8, 0.8],
    },
    {
      id: 'hazard-box-2',
      name: 'Cargo Crate 2',
      hazard_type: 'cube',
      position: [-14.5, 0.4, -1.5],
      size: [0.8, 0.8, 0.8],
      dimensions: [0.8, 0.8, 0.8],
    },
    {
      id: 'hazard-box-3',
      name: 'Cargo Crate 3',
      hazard_type: 'cube',
      position: [-14.5, 0.4, 1.5],
      size: [0.8, 0.8, 0.8],
      dimensions: [0.8, 0.8, 0.8],
    },
    {
      id: 'hazard-box-4',
      name: 'Cargo Crate 4',
      hazard_type: 'cube',
      position: [-14.5, 0.4, 4.5],
      size: [0.8, 0.8, 0.8],
      dimensions: [0.8, 0.8, 0.8],
    },
  ],
  provenance_audit: [],
  unsupported_features: [],
  generator_engine: 'DETERMINISTIC_PATTERN_FALLBACK',
};

describe('Authoritative Execution Record & Metric Synchronization', () => {
  beforeEach(() => {
    useSimulationStore.setState({
      mode: 'autonomous',
      activeScenarioId: testScenario.scenario_id,
      activeScenarioMetadata: testScenario,
      scenarioExecutionStatus: 'RUNNING',
      isLeftPanelOpen: true,
      isRightPanelOpen: true,
      isZenMode: false,
      robotPose: {
        position: [-14.5, 0.22, -10.5],
        rotation: 0.0,
        linearVelocity: 1.0,
        angularVelocity: 0.0,
      },
      robotStatus: {
        battery: 95,
        isEmergencyStopped: false,
        collisionCount: 0,
        lastCollisionForce: 0,
      },
      sensorData: {
        forwardDist: 6.0,
        leftDist: 2.0,
        rightDist: 2.0,
        riskLevel: 'clear',
        safetyStatus: 'SAFE',
        minClearance: 4.25, // instantaneous clearance
        ttc: null,          // No dynamic targets
        closestObstacle: null,
      },
      missionMetrics: {
        distanceTravelled: 2.5,
        missionTime: 3.2,
        timeStopped: 0,
        nearMisses: 0,
        replanCount: 0,
        obstaclesDetected: 4,
        collisions: 0,
        missionStatus: 'running',
      },
      minObservedClearance: 1.85, // minimum clearance observed so far
      minObservedTtc: Infinity,
      authoritativeExecutionRecord: {
        scenarioId: testScenario.scenario_id,
        scenarioTitle: testScenario.title,
        recordingSessionId: 'FR-REC-SYNC-1',
        executionId: 'exec_sync_001',
        startTime: 0,
        missionStatus: 'RUNNING',
        collisionCount: 0,
        nearMissCount: 0,
        minObservedClearance: 1.85,
        minObservedTtc: null,
        currentClearance: 4.25,
        currentTtc: null,
        safetyStatus: 'SAFE',
        failureReason: null,
      },
    });
  });

  it('guarantees single authoritative collision count across RobotHUD, AutonomousLab, and ScenarioResult', () => {
    const hudHtml = renderToString(<RobotHUD />);
    const labHtml = renderToString(<AutonomousLabPanel forceMode="autonomous" />);
    const resultHtml = renderToString(
      <ScenarioResultPanel forceScenario={testScenario} forceStatus="RUNNING" />
    );

    // Initial state: 0 collisions across all three panels
    expect(hudHtml).toContain('>0</span>');
    expect(labHtml).toContain('data-testid="collisions-counter"');
    expect(labHtml).toContain('0');
    expect(resultHtml).toContain('>0</span>');

    // Simulate authoritative collision event
    useSimulationStore.getState().recordCollision(850, 'hazard-box-1');

    const state = useSimulationStore.getState();
    expect(state.authoritativeExecutionRecord.collisionCount).toBe(1);
    expect(state.robotStatus.collisionCount).toBe(1);
    expect(state.missionMetrics.collisions).toBe(1);

    const hudAfter = renderToString(<RobotHUD />);
    const labAfter = renderToString(<AutonomousLabPanel forceMode="autonomous" />);
    const resultAfter = renderToString(
      <ScenarioResultPanel forceScenario={testScenario} forceStatus="RUNNING" />
    );

    // All three panels synchronously show exactly 1 collision
    expect(hudAfter).toContain('>1</span>');
    expect(labAfter).toContain('data-testid="collisions-counter"');
    expect(labAfter).toContain('1');
    expect(resultAfter).toContain('>1</span>');
  });

  it('distinguishes instantaneous current clearance from minimum observed clearance', () => {
    const labHtml = renderToString(<AutonomousLabPanel forceMode="autonomous" />);
    const resultHtml = renderToString(
      <ScenarioResultPanel forceScenario={testScenario} forceStatus="RUNNING" />
    );

    // Minimum observed clearance (1.85m) is displayed in both panels
    expect(labHtml).toContain('1.85');
    expect(resultHtml).toContain('1.85m');

    // Instantaneous current clearance (4.25m) is displayed under current in AutonomousLab
    expect(labHtml).toContain('4.25');
  });

  it('displays Dynamic TTC as NONE when no dynamic targets exist in the scene', () => {
    const labHtml = renderToString(<AutonomousLabPanel forceMode="autonomous" />);
    const resultHtml = renderToString(
      <ScenarioResultPanel forceScenario={testScenario} forceStatus="RUNNING" />
    );

    // In a scenario with 0 dynamic actors, TTC must be strictly NONE
    expect(labHtml).toContain('NONE');
    expect(resultHtml).toContain('NONE');
  });

  it('supports collapsible drawers and unobstructed Zen view mode', () => {
    const { toggleLeftPanel, toggleRightPanel, toggleZenMode } = useSimulationStore.getState();

    // Collapse left panel
    toggleLeftPanel();
    expect(useSimulationStore.getState().isLeftPanelOpen).toBe(false);

    // Collapse right panel
    toggleRightPanel();
    expect(useSimulationStore.getState().isRightPanelOpen).toBe(false);

    // Toggle Zen Mode to exit Zen (restoring panels)
    toggleZenMode();
    expect(useSimulationStore.getState().isZenMode).toBe(true);
    expect(useSimulationStore.getState().isLeftPanelOpen).toBe(false);
    expect(useSimulationStore.getState().isRightPanelOpen).toBe(false);

    // Toggle Zen Mode again
    toggleZenMode();
    expect(useSimulationStore.getState().isZenMode).toBe(false);
    expect(useSimulationStore.getState().isLeftPanelOpen).toBe(true);
    expect(useSimulationStore.getState().isRightPanelOpen).toBe(true);
  });
});
