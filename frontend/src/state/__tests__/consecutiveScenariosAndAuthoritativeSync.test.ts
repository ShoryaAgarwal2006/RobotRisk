import { describe, it, expect, beforeEach } from 'vitest';
import { useSimulationStore } from '../useSimulationStore';
import { flightRecorderService } from '../../services/flightRecorder';
import { GeneratedScenario } from '../../types/scenario';

const mockScenario1_Boxes: GeneratedScenario = {
  scenario_id: 'scen-4-boxes-001',
  title: '4 Cargo Boxes in Robot Path',
  description: 'Physical boxes placed along corridor 1',
  environment: 'warehouse',
  difficulty: 'extreme',
  seed: 42,
  robot_setup: {
    start_position: [-14.5, 0.22, -10.5],
    start_rotation_rad: 0,
    destination_id: 'bay-4',
    destination_name: 'Loading Bay 4',
    destination_position: [-14.5, 0.22, 10.5],
    navigation_preference: 'default',
  },
  actors: [],
  static_hazards: [
    { id: 'box-1', hazard_type: 'cube', name: 'Cargo Box 1', position: [-14.5, 0.4, -4.5], size: [0.8, 0.8, 0.8], rotation_rad: 0, shape: 'cube', is_static: true, collider_type: 'cuboid' },
    { id: 'box-2', hazard_type: 'cube', name: 'Cargo Box 2', position: [-14.5, 0.4, -1.5], size: [0.8, 0.8, 0.8], rotation_rad: 0, shape: 'cube', is_static: true, collider_type: 'cuboid' },
    { id: 'box-3', hazard_type: 'cube', name: 'Cargo Box 3', position: [-14.5, 0.4, 1.5], size: [0.8, 0.8, 0.8], rotation_rad: 0, shape: 'cube', is_static: true, collider_type: 'cuboid' },
    { id: 'box-4', hazard_type: 'cube', name: 'Cargo Box 4', position: [-14.5, 0.4, 4.5], size: [0.8, 0.8, 0.8], rotation_rad: 0, shape: 'cube', is_static: true, collider_type: 'cuboid' },
  ],
  provenance_audit: [],
  unsupported_features: [],
  generator_engine: 'DETERMINISTIC_PATTERN_FALLBACK',
};

const mockScenario2_Forklifts: GeneratedScenario = {
  scenario_id: 'scen-2-forklifts-002',
  title: '2 Opposing Forklifts in Narrow Aisle',
  description: 'Heavy industrial forklifts patrolling',
  environment: 'warehouse',
  difficulty: 'hard',
  seed: 101,
  robot_setup: {
    start_position: [-14.5, 0.22, -10.5],
    start_rotation_rad: 0,
    destination_id: 'bay-4',
    destination_name: 'Loading Bay 4',
    destination_position: [-14.5, 0.22, 10.5],
    navigation_preference: 'shortest_safe_path',
  },
  actors: [
    {
      id: 'forklift-1',
      name: 'Forklift Alpha',
      actor_type: 'forklift',
      spawn_position: [-14.5, 0, 5],
      patrol_start: [-14.5, 5],
      patrol_end: [-14.5, -5],
      patrol_speed: 1.2,
      initial_heading_rad: 3.1415,
      direction: 1,
      initial_patrol_progress: 0,
      geometry: { geometry_type: 'forklift_compound' },
    },
    {
      id: 'forklift-2',
      name: 'Forklift Beta',
      actor_type: 'forklift',
      spawn_position: [-14.5, 0, -2],
      patrol_start: [-14.5, -5],
      patrol_end: [-14.5, 5],
      patrol_speed: 1.0,
      initial_heading_rad: 0,
      direction: 1,
      initial_patrol_progress: 0,
      geometry: { geometry_type: 'forklift_compound' },
    },
  ],
  static_hazards: [],
  provenance_audit: [],
  unsupported_features: [],
  generator_engine: 'DETERMINISTIC_PATTERN_FALLBACK',
};

describe('Consecutive Scenario Executions & Authoritative Metrics Synchronization', () => {
  beforeEach(() => {
    useSimulationStore.getState().clearActiveScenario();
  });

  it('resets all objects, colliders, metrics and generates unique executionId across consecutive runs', async () => {
    // 1. Launch Scenario 1 (4 Boxes)
    await useSimulationStore.getState().launchCommittedScenario(mockScenario1_Boxes);
    // Directly stage the 4 boxes as mapped in store
    useSimulationStore.setState({
      interactiveObjects: mockScenario1_Boxes.static_hazards.map((h) => ({
        id: h.id,
        type: 'cube',
        position: h.position,
        size: 0.8,
        color: '#f59e0b',
        name: h.name,
        rotation: 0,
        velocity: [0, 0, 0],
      })),
    });

    const state1 = useSimulationStore.getState();
    expect(state1.authoritativeExecutionRecord.scenarioId).toBe('scen-4-boxes-001');
    expect(state1.authoritativeExecutionRecord.collisionCount).toBe(0);
    expect(state1.authoritativeExecutionRecord.missionStatus).toBe('RUNNING');
    expect(state1.interactiveObjects.length).toBe(4);
    const execId1 = state1.authoritativeExecutionRecord.executionId;
    const recordingId1 = state1.authoritativeExecutionRecord.recordingSessionId;
    expect(execId1).toBeTruthy();
    expect(recordingId1).toBeTruthy();

    // 2. Trigger collision in Scenario 1
    useSimulationStore.getState().recordCollision(250.0, 'Cargo Box 1');

    const state1Collided = useSimulationStore.getState();
    expect(state1Collided.authoritativeExecutionRecord.collisionCount).toBe(1);
    expect(state1Collided.robotStatus.collisionCount).toBe(1);
    expect(state1Collided.missionMetrics.collisions).toBe(1);
    expect(state1Collided.authoritativeExecutionRecord.safetyStatus).toBe('CRITICAL');

    // Debounce check: second collision with same object within 100ms should be suppressed
    useSimulationStore.getState().recordCollision(240.0, 'Cargo Box 1');
    expect(useSimulationStore.getState().authoritativeExecutionRecord.collisionCount).toBe(1);

    // 3. Clear active scenario before starting Scenario 2
    useSimulationStore.getState().clearActiveScenario();
    const stateCleared = useSimulationStore.getState();
    expect(stateCleared.interactiveObjects.length).toBe(0);
    expect(stateCleared.authoritativeExecutionRecord.collisionCount).toBe(0);
    expect(stateCleared.robotStatus.collisionCount).toBe(0);
    expect(stateCleared.missionMetrics.collisions).toBe(0);
    expect(stateCleared.authoritativeExecutionRecord.safetyStatus).toBe('SAFE');

    // 4. Launch Scenario 2 (2 Forklifts)
    await useSimulationStore.getState().launchCommittedScenario(mockScenario2_Forklifts);
    useSimulationStore.setState({
      interactiveObjects: mockScenario2_Forklifts.actors.map((a) => ({
        id: a.id,
        type: 'forklift',
        position: a.spawn_position,
        rotation: a.initial_heading_rad,
        color: '#eab308',
        size: 1.0,
        name: a.name,
        velocity: [0, 0, a.patrol_speed],
      })),
    });

    const state2 = useSimulationStore.getState();
    expect(state2.authoritativeExecutionRecord.scenarioId).toBe('scen-2-forklifts-002');
    expect(state2.authoritativeExecutionRecord.collisionCount).toBe(0);
    expect(state2.robotStatus.collisionCount).toBe(0);
    expect(state2.missionMetrics.collisions).toBe(0);
    expect(state2.interactiveObjects.length).toBe(2);
    expect(state2.interactiveObjects.map((o) => o.id)).toEqual(['forklift-1', 'forklift-2']);

    const execId2 = state2.authoritativeExecutionRecord.executionId;
    const recordingId2 = state2.authoritativeExecutionRecord.recordingSessionId;
    expect(execId2).toBeTruthy();
    expect(recordingId2).toBeTruthy();
    expect(execId2).not.toBe(execId1);
    expect(recordingId2).not.toBe(recordingId1);

    // Verify historical Flight Recorder preserved recordingId1
    const pastSessions = flightRecorderService.getAllSessions();
    const pastIds = pastSessions.map((s) => s.recordingId);
    expect(pastIds).toContain(recordingId1);
  });
});
