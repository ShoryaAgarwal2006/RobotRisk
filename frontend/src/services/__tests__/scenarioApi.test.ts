import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateScenario, validateScenario } from '../scenarioApi';
import { GeneratedScenario } from '../../types/scenario';

describe('scenarioApi service', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const mockGeneratedScenario: GeneratedScenario = {
    scenario_id: 'scen-test-01',
    title: 'Test Corridor 2 Dual Forklifts',
    description: 'High speed test scenario',
    environment: 'warehouse',
    difficulty: 'hard',
    seed: 42,
    robot_setup: {
      start_position: [-14.5, 0.22, -10.5],
      start_rotation_rad: 0,
      destination_id: 'bay-4',
      destination_name: 'Bay 4',
      destination_position: [14.0, 0.22, 10.5],
      navigation_preference: 'default',
    },
    actors: [
      {
        id: 'actor-forklift-1',
        name: 'Forklift 1',
        actor_type: 'forklift',
        spawn_position: [0.0, 0.1, -5.0],
        patrol_start: [0.0, -10.0],
        patrol_end: [0.0, 10.0],
        patrol_speed: 1.6,
        initial_heading_rad: 0,
        direction: 1,
        initial_patrol_progress: 0.25,
      },
    ],
    static_hazards: [
      {
        id: 'hazard-barrier-1',
        hazard_type: 'barrier',
        name: 'Barrier 1',
        position: [0.0, 0.55, 0.0],
        size: [2.4, 0.4, 1.1],
        rotation_rad: 0,
      },
    ],
    provenance_audit: [
      {
        field_name: 'actors[0].speed_mps',
        provenance: 'EXPLICIT_USER',
        rationale: 'User requested 1.6 m/s',
      },
    ],
    unsupported_features: [],
    generator_engine: 'GEMINI_1_5_FLASH',
  };

  it('successfully generates scenario from backend endpoint', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        scenario: mockGeneratedScenario,
        validation: {
          is_valid: true,
          issues: [],
          tested_footprints_count: 50,
          swept_path_segments_count: 10,
        },
      }),
    });

    const res = await generateScenario({
      prompt: 'Two forklifts in corridor 2',
      preferred_corridor: 'aisle-2',
      difficulty: 'hard',
    });

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(res.scenario.scenario_id).toBe('scen-test-01');
    expect(res.scenario.generator_engine).toBe('GEMINI_1_5_FLASH');
    expect(res.validation.is_valid).toBe(true);
  });

  it('handles structured 422 Unprocessable Entity error with detailed issue messages', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({
        detail: [
          {
            loc: ['body', 'prompt'],
            msg: 'Prompt must not be empty or blank',
            type: 'value_error',
          },
          {
            loc: ['body', 'corridor'],
            msg: 'Corridor aisle-99 is not supported',
            type: 'value_error',
          },
        ],
      }),
    });

    await expect(
      generateScenario({
        prompt: '   ',
        preferred_corridor: 'aisle-99',
      })
    ).rejects.toThrow(/Prompt must not be empty or blank/);
  });

  it('handles response when backend uses deterministic fallback', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        scenario: {
          ...mockGeneratedScenario,
          generator_engine: 'DETERMINISTIC_PATTERN_FALLBACK',
        },
        validation: {
          is_valid: true,
          issues: [],
          tested_footprints_count: 50,
          swept_path_segments_count: 10,
        },
      }),
    });

    const res = await generateScenario({
      prompt: 'Dual forklifts in corridor 2',
      preferred_corridor: 'aisle-2',
      difficulty: 'hard',
    });

    expect(res.scenario).toBeDefined();
    expect(res.scenario.generator_engine).toBe('DETERMINISTIC_PATTERN_FALLBACK');
    expect(res.scenario.actors.length).toBeGreaterThan(0);
    expect(res.validation.is_valid).toBe(true);
  });

  it('throws ScenarioApiError when network fetch fails completely', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Failed to fetch'));

    await expect(
      generateScenario({
        prompt: 'Dual forklifts in corridor 2',
        preferred_corridor: 'aisle-2',
      })
    ).rejects.toThrow(/Unable to reach scenario service/);
  });

  it('successfully validates scenario via /api/scenario/validate', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        validation: {
          is_valid: true,
          issues: [],
          tested_footprints_count: 80,
          swept_path_segments_count: 15,
        },
      }),
    });

    const val = await validateScenario(mockGeneratedScenario);
    expect(val.is_valid).toBe(true);
    expect(val.tested_footprints_count).toBe(80);
  });
});
