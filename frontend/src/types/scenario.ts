/**
 * Scenario Schemas & Types
 * ROBOTRISK AI — PHASE 5.5C
 * 
 * Strict TypeScript mirror of backend/app/schemas/scenario.py.
 */

export type GeneratorEngine =
  | 'GEMINI_1_5_FLASH'
  | 'GEMINI_STRUCTURED'
  | 'DETERMINISTIC_PATTERN_FALLBACK';

export type ProvenanceType =
  | 'EXPLICIT_USER'
  | 'INFERRED_DEFAULT'
  | 'SYSTEM_CONSTRAINED';

export type ScenarioDifficulty = 'normal' | 'hard' | 'extreme';

export interface ParameterProvenance {
  field_name: string;
  provenance: ProvenanceType;
  rationale?: string | null;
  original_extracted_value?: string | null;
}

export interface ForkliftCompoundColliderGeometry {
  chassis_width?: number;
  chassis_length?: number;
  chassis_offset_z?: number;
  forks_width?: number;
  forks_length?: number;
  forks_offset_z?: number;
  overall_width?: number;
  overall_length?: number;
  rear_extent_z?: number;
  front_extent_z?: number;
}

export interface WorkerColliderGeometry {
  radius?: number;
  height?: number;
}

export interface ActorGeometry {
  geometry_type: 'forklift_compound' | 'worker_cylinder';
  forklift?: ForkliftCompoundColliderGeometry;
  worker?: WorkerColliderGeometry;
}

export interface ActorDefinition {
  id: string;
  name: string;
  actor_type: 'forklift' | 'worker';
  spawn_position: [number, number, number]; // [X, Y, Z]
  patrol_start: [number, number];           // [X, Z]
  patrol_end: [number, number];             // [X, Z]
  patrol_speed: number;                     // m/s
  initial_heading_rad: number;              // radians (0 = facing +Z)
  direction: 1 | -1;                        // +1: S -> E, -1: E -> S
  initial_patrol_progress: number;          // alpha along segment [0, 1]
  color?: string;
  role_description?: string | null;
  geometry?: ActorGeometry;
}

export interface StaticHazardDefinition {
  id: string;
  hazard_type: 'cube' | 'sphere' | 'barrier';
  name: string;
  position: [number, number, number];
  size?: number[] | null;                   // [w, d, h] or [radius]
  dimensions?: number[] | null;             // [w, h, d]
  rotation_rad?: number;
  aisle_id?: string | null;
  shape?: string;
  is_static?: boolean;
  collider_type?: string;
}

export interface RobotMissionSetup {
  start_position: [number, number, number];
  start_rotation_rad: number;
  destination_id: string;
  destination_name: string;
  destination_position: [number, number, number];
  navigation_preference: 'default' | 'shortest_safe_path' | 'alternative_route';
}

export interface ValidationIssue {
  severity: 'ERROR' | 'WARNING';
  code: string;
  message: string;
  affected_entity_id?: string | null;
  details?: Record<string, any>;
}

export interface ScenarioValidationResult {
  is_valid: boolean;
  issues: ValidationIssue[];
  tested_footprints_count: number;
  swept_path_segments_count: number;
}

export interface GeneratedScenario {
  scenario_id: string;
  title: string;
  description: string;
  environment: 'warehouse';
  difficulty: ScenarioDifficulty;
  seed: number;
  robot_setup: RobotMissionSetup;
  actors: ActorDefinition[];
  static_hazards: StaticHazardDefinition[];
  provenance_audit: ParameterProvenance[];
  unsupported_features: string[];
  generator_engine: GeneratorEngine;
}

export interface ScenarioGenerateRequest {
  prompt: string;
  preferred_corridor?: string | null;
  difficulty?: ScenarioDifficulty | null;
}

export interface ScenarioGenerateResponse {
  scenario: GeneratedScenario;
  validation: ScenarioValidationResult;
}

export interface ScenarioValidateRequest {
  scenario: GeneratedScenario;
}

export interface ScenarioValidateResponse {
  validation: ScenarioValidationResult;
}

export type StagingStatus =
  | 'IDLE'
  | 'STAGING'
  | 'VERIFYING_PHYSICS'
  | 'COMMITTED'
  | 'ROLLING_BACK'
  | 'FAILED'
  | 'RECOVERY_FAILED';

export type ScenarioExecutionStatus =
  | 'IDLE'
  | 'STAGED'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'ABORTED';

export interface AuthoritativeExecutionRecord {
  scenarioId: string | null;
  scenarioTitle: string | null;
  recordingSessionId: string | null;
  executionId: string | null;
  startTime: number;
  missionStatus: ScenarioExecutionStatus;
  collisionCount: number;
  nearMissCount: number;
  minObservedClearance: number | null; // null if unmeasured
  minObservedTtc: number | null; // null if no dynamic threat
  currentClearance: number | null;
  currentTtc: number | null;
  safetyStatus: 'SAFE' | 'WARNING' | 'CRITICAL';
  failureReason?: string | null;
}
