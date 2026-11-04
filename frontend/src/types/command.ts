export type CommandActionType =
  | 'spawn_obstacle'
  | 'spawn_workers'
  | 'block_aisle'
  | 'unblock_aisle'
  | 'clear_obstacles'
  | 'set_simulation_state'
  | 'start_mission'
  | 'pause_mission'
  | 'resume_mission'
  | 'emergency_stop'
  | 'reset_simulation'
  | 'set_difficulty'
  | 'replan_route'
  | 'remove_target_obstacle'
  | 'start_vertical_impact_scenario'
  | 'query_explanation'
  | 'query_events'
  | 'clarification_needed'
  | 'unknown';

export interface CommandParameters {
  objectType?: 'cube' | 'sphere' | 'worker';
  position?: [number, number, number];
  relativeToRobot?: {
    distanceAhead: number; // e.g. 3.0 meters ahead
  };
  aisleId?: string; // e.g. 'aisle-2'
  aisleName?: string;
  count?: number; // e.g. 5 moving workers
  simulationRunning?: boolean; // true for resume, false for pause
  destinationId?: string;
  difficulty?: 'normal' | 'hard' | 'extreme';
  navigationPreference?: 'default' | 'shortest_safe_path' | 'alternative_route';
  targetObstacleId?: string;
  emergencyStopActive?: boolean;
}

export interface SubAction {
  id: string;
  action: CommandActionType;
  intent: string;
  confidence: number;
  parameters: CommandParameters;
  description: string;
  requiresApproval: boolean;
  impactSummary: string;
  proposedChanges: string[];
}

export interface ParsedCommand {
  id: string;
  rawPrompt: string;
  action: CommandActionType;
  intent: string;
  confidence: number;
  parameters: CommandParameters;
  description: string;
  explanation?: string;
  requiresApproval: boolean;
  impactSummary: string;
  proposedChanges: string[];
  subActions?: SubAction[];
  isMultiIntent?: boolean;
  clarificationQuestion?: string;
  parserMode?: 'gemini_llm' | 'deterministic_fallback';
  directResponse?: string;
}

export type CommandStatus =
  | 'pending_approval'
  | 'approved'
  | 'rejected'
  | 'executed'
  | 'failed'
  | 'clarification_needed';

export interface ChatMessage {
  id: string;
  sender: 'user' | 'ai' | 'system';
  timestamp: number;
  text: string;
  parsedCommand?: ParsedCommand;
  status?: CommandStatus;
  executionResult?: {
    success: boolean;
    message: string;
    details?: string;
    stepResults?: Array<{
      stepId: string;
      intent: string;
      step?: number;
      action?: string;
      success: boolean;
      message: string;
    }>;
  };
}

export interface ConversationHistoryItem {
  sender: string;
  text: string;
  action?: string;
}

export interface CommandContextPayload {
  prompt: string;
  context?: {
    robot_position?: [number, number, number];
    robot_yaw?: number;
    robot_speed?: number;
    nav_state?: string;
    is_e_stopped?: boolean;
    is_running?: boolean;
    closest_obstacle?: string | null;
    obstacle_position?: [number, number] | null;
    forward_clearance?: number;
    risk_level?: string;
    stopping_distance?: number;
    braking_status?: string;
    route_validity?: string;
    failure_explanation?: string | null;
    collision_count?: number;
    last_collision_force?: number;
    recent_events?: string[];
    current_difficulty?: string;
    last_spawned_obstacle_id?: string;
    last_action_type?: string;
    conversation_history?: ConversationHistoryItem[];
  };
}
