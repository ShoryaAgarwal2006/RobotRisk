import { describe, it, expect, beforeEach } from 'vitest';
import { scenarioStorageService, STORAGE_KEY, MAX_SAVED_SCENARIOS } from '../scenarioStorageService';
import { GeneratedScenario } from '../../types/scenario';

let store: Record<string, string> = {};
const localStorageMock = {
  getItem: (key: string) => store[key] || null,
  setItem: (key: string, value: string) => {
    store[key] = value.toString();
  },
  removeItem: (key: string) => {
    delete store[key];
  },
  clear: () => {
    store = {};
  },
};
(globalThis as any).localStorage = localStorageMock;

describe('scenarioStorageService', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  const createMockScenario = (id: string, title: string): GeneratedScenario => ({
    scenario_id: id,
    title,
    description: `Description for ${title}`,
    environment: 'warehouse',
    difficulty: 'normal',
    seed: 12345,
    robot_setup: {
      start_position: [-14.5, 0.22, -10.5],
      start_rotation_rad: 0,
      destination_id: 'bay-4',
      destination_name: 'Bay 4',
      destination_position: [14.0, 0.22, 10.5],
      navigation_preference: 'default',
    },
    actors: [],
    static_hazards: [],
    provenance_audit: [],
    unsupported_features: [],
    generator_engine: 'GEMINI_1_5_FLASH',
  });

  it('saves and retrieves a scenario from localStorage', () => {
    const sc = createMockScenario('scen-01', 'Test Scenario 1');
    const res = scenarioStorageService.saveScenario(sc);
    expect(res.success).toBe(true);

    const retrieved = scenarioStorageService.getScenario('scen-01');
    expect(retrieved).not.toBeNull();
    expect(retrieved?.title).toBe('Test Scenario 1');
  });

  it('updates an existing scenario in-place without exceeding count', () => {
    const sc1 = createMockScenario('scen-01', 'Initial Title');
    scenarioStorageService.saveScenario(sc1);
    expect(scenarioStorageService.listScenarios().length).toBe(1);

    const scUpdated = createMockScenario('scen-01', 'Updated Title');
    scenarioStorageService.saveScenario(scUpdated);
    const list = scenarioStorageService.listScenarios();
    expect(list.length).toBe(1);
    expect(list[0].scenario.title).toBe('Updated Title');
  });

  it('enforces FIFO eviction at 25 scenarios limit', () => {
    for (let i = 1; i <= 26; i++) {
      const sc = createMockScenario(`scen-${i}`, `Scenario ${i}`);
      scenarioStorageService.saveScenario(sc);
    }

    const list = scenarioStorageService.listScenarios();
    expect(list.length).toBe(MAX_SAVED_SCENARIOS);
    expect(list.length).toBe(25);
    // Oldest (scen-1) must have been evicted, oldest remaining is scen-2
    expect(scenarioStorageService.getScenario('scen-1')).toBeNull();
    expect(scenarioStorageService.getScenario('scen-2')).not.toBeNull();
    expect(scenarioStorageService.getScenario('scen-26')).not.toBeNull();
  });

  it('deletes a scenario by ID', () => {
    const sc = createMockScenario('scen-delete-me', 'To be deleted');
    scenarioStorageService.saveScenario(sc);
    expect(scenarioStorageService.getScenario('scen-delete-me')).not.toBeNull();

    const deleted = scenarioStorageService.deleteScenario('scen-delete-me');
    expect(deleted).toBe(true);
    expect(scenarioStorageService.getScenario('scen-delete-me')).toBeNull();
  });

  it('filters out corrupted or malformed entries from localStorage', () => {
    const corruptedData = [
      { savedAt: 12345, scenario: { invalid: 'object' } }, // Corrupted
      null,
      'not-even-an-object',
      { savedAt: Date.now(), scenario: createMockScenario('valid-1', 'Valid Scenario') },
    ];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(corruptedData));

    const list = scenarioStorageService.listScenarios();
    expect(list.length).toBe(1);
    expect(list[0].scenario.scenario_id).toBe('valid-1');
  });

  it('exports and parses valid JSON format', () => {
    const sc = createMockScenario('scen-export', 'Exportable Scenario');
    const jsonStr = scenarioStorageService.exportScenarioAsJson(sc);
    expect(typeof jsonStr).toBe('string');
    const parsed = JSON.parse(jsonStr);
    expect(parsed.scenario_id).toBe('scen-export');
    expect(parsed.title).toBe('Exportable Scenario');
  });
});
