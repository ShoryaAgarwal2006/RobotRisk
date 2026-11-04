/**
 * Scenario Storage Service
 * ROBOTRISK AI — PHASE 5.5C
 * 
 * Local persistence for approved/generated scenarios using browser localStorage.
 * Storage key: robotrisk_saved_scenarios_v1 (Max 25 items).
 */

import { GeneratedScenario } from '../types/scenario';

export const STORAGE_KEY = 'robotrisk_saved_scenarios_v1';
export const MAX_SAVED_SCENARIOS = 25;

export interface StoredScenarioRecord {
  scenario: GeneratedScenario;
  savedAt: number;
}

function isValidScenario(obj: any): obj is GeneratedScenario {
  return (
    obj &&
    typeof obj === 'object' &&
    typeof obj.scenario_id === 'string' &&
    typeof obj.title === 'string' &&
    obj.environment === 'warehouse' &&
    typeof obj.seed === 'number' &&
    obj.robot_setup &&
    typeof obj.robot_setup === 'object' &&
    Array.isArray(obj.actors) &&
    Array.isArray(obj.static_hazards) &&
    typeof obj.generator_engine === 'string'
  );
}

export const scenarioStorageService = {
  saveScenario(scenario: GeneratedScenario): { success: boolean; message: string; error?: string } {
    if (!isValidScenario(scenario)) {
      return { success: false, message: 'Invalid scenario definition.', error: 'SCHEMA_INVALID' };
    }

    try {
      const records = scenarioStorageService.listScenarios();
      const existingIdx = records.findIndex((r) => r.scenario.scenario_id === scenario.scenario_id);
      const newRecord: StoredScenarioRecord = {
        scenario,
        savedAt: Date.now(),
      };

      if (existingIdx >= 0) {
        records[existingIdx] = newRecord;
      } else {
        if (records.length >= MAX_SAVED_SCENARIOS) {
          // FIFO: Remove oldest record
          records.shift();
        }
        records.push(newRecord);
      }

      localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
      return { success: true, message: `Scenario "${scenario.title}" saved to local library.` };
    } catch (err: any) {
      const msg = err.name === 'QuotaExceededError'
        ? 'Browser storage quota exceeded. Please delete older scenarios.'
        : `Unable to save scenario: ${err.message || 'Storage error'}`;
      return { success: false, message: msg, error: err.message };
    }
  },

  listScenarios(): StoredScenarioRecord[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];

      // Filter out corrupted or malformed entries
      return parsed.filter(
        (entry) =>
          entry &&
          typeof entry === 'object' &&
          typeof entry.savedAt === 'number' &&
          isValidScenario(entry.scenario)
      );
    } catch {
      // Malformed JSON in localStorage -> return empty array safely
      return [];
    }
  },

  getScenario(scenarioId: string): GeneratedScenario | null {
    const records = scenarioStorageService.listScenarios();
    const match = records.find((r) => r.scenario.scenario_id === scenarioId);
    return match ? match.scenario : null;
  },

  deleteScenario(scenarioId: string): boolean {
    try {
      const records = scenarioStorageService.listScenarios().filter(
        (r) => r.scenario.scenario_id !== scenarioId
      );
      localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
      return true;
    } catch {
      return false;
    }
  },

  clearAll(): void {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore
    }
  },

  exportScenarioAsJson(scenario: GeneratedScenario): string {
    return JSON.stringify(scenario, null, 2);
  },

  importScenarioFromJson(jsonString: string): { success: boolean; scenario?: GeneratedScenario; error?: string } {
    try {
      const parsed = JSON.parse(jsonString);
      if (!isValidScenario(parsed)) {
        return { success: false, error: 'JSON payload does not conform to GeneratedScenario schema.' };
      }
      return { success: true, scenario: parsed };
    } catch (err: any) {
      return { success: false, error: `Invalid JSON syntax: ${err.message}` };
    }
  },
};
