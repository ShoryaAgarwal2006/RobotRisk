import { describe, it, expect, beforeEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import { useSimulationStore } from '../../state/useSimulationStore';
import { ScenarioResultPanel } from '../ScenarioResultPanel';
import { GeneratedScenario } from '../../types/scenario';

const mockScenario: GeneratedScenario = {
  scenario_id: 'SCEN-TEST-EXEC-001',
  title: 'Opposing Dual Forklifts in Corridor 2',
  description: 'Two heavy forklifts approaching head on',
  difficulty: 'hard',
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
  actors: [
    {
      id: 'fk-1',
      name: 'Forklift Alpha',
      actor_type: 'forklift',
      spawn_position: [0.0, 0.0, -6.0],
      patrol_start: [0.0, -7.0],
      patrol_end: [0.0, 4.0],
      patrol_speed: 1.8,
      initial_heading_rad: 0.0,
      direction: 1,
      initial_patrol_progress: 0.1,
      role_description: 'Southbound patrol',
    },
  ],
  static_hazards: [],
  provenance_audit: [],
  unsupported_features: [],
  generator_engine: 'DETERMINISTIC_PATTERN_FALLBACK',
};

describe('ScenarioResultPanel', () => {
  beforeEach(() => {
    useSimulationStore.setState({
      activeScenarioId: null,
      activeScenarioMetadata: null,
      scenarioExecutionStatus: 'IDLE',
      minObservedClearance: Infinity,
      minObservedTtc: Infinity,
      robotPose: {
        position: [-14.5, 0.22, -10.5],
        rotation: 0.0,
        linearVelocity: 1.2,
        angularVelocity: 0.0,
      },
      robotStatus: {
        battery: 100,
        isEmergencyStopped: false,
        collisionCount: 0,
        lastCollisionForce: 0,
      },
      sensorData: {
        forwardDist: 4.5,
        leftDist: 2.1,
        rightDist: 2.1,
        riskLevel: 'clear',
        safetyStatus: 'SAFE',
        minClearance: 2.8,
        ttc: 3.4,
        closestObstacle: null,
      },
      missionMetrics: {
        distanceTravelled: 5.2,
        missionTime: 4.5,
        timeStopped: 0,
        nearMisses: 1,
        replanCount: 0,
        obstaclesDetected: 0,
        collisions: 0,
        missionStatus: 'running',
      },
      flightRecorderStats: {
        frameCount: 45,
        incidentCount: 1,
        duration: 4.5,
        activeRecordingId: 'FR-SCENARIO-REC-1',
      },
    });
  });

  it('renders nothing when activeScenarioMetadata is null', () => {
    const html = renderToString(<ScenarioResultPanel forceScenario={null} />);
    expect(html).toBe('');
  });

  it('renders complete scenario execution panel when activeScenarioMetadata is set', () => {
    useSimulationStore.setState({
      activeScenarioId: mockScenario.scenario_id,
      activeScenarioMetadata: mockScenario,
      scenarioExecutionStatus: 'RUNNING',
      minObservedClearance: 1.25,
      minObservedTtc: 1.85,
    });

    const html = renderToString(
      <ScenarioResultPanel
        forceScenario={mockScenario}
        forceStatus="RUNNING"
        forceRecordingId="FR-SCENARIO-REC-1"
      />
    );
    expect(html).toContain('data-testid="scenario-result-panel"');
    expect(html).toContain('Opposing Dual Forklifts in Corridor 2');
    expect(html).toContain('SCEN-TEST-EXEC-001');
    expect(html).toContain('Deterministic');
    expect(html).toContain('RUNNING');
    expect(html).toContain('FR-SCENARIO-REC-1');
  });

  it('displays COMPLETED status with success indication', () => {
    const html = renderToString(
      <ScenarioResultPanel forceScenario={mockScenario} forceStatus="COMPLETED" />
    );
    expect(html).toContain('COMPLETED');
    expect(html).toContain('AMR Delivered to Goal');
  });

  it('displays FAILED status and collision counts upon failure', () => {
    useSimulationStore.setState({
      robotStatus: {
        battery: 80,
        isEmergencyStopped: true,
        collisionCount: 2,
        lastCollisionForce: 1500,
      },
    });

    const html = renderToString(
      <ScenarioResultPanel forceScenario={mockScenario} forceStatus="FAILED" />
    );
    expect(html).toContain('FAILED');
    expect(html).toContain('Collision / Path Impasse');
    expect(html).toContain('2'); // Collision count
  });
});
