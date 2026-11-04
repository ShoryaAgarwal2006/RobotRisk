import { ParsedCommand, CommandContextPayload, SubAction, CommandActionType } from '../types/command';
import { RobotPose, RobotStatus, NavState, SensorData, NavigationDiagnostics, AisleBarrier } from '../types/simulation';

export interface CommandParseContext {
  robotPose: RobotPose;
  robotStatus: RobotStatus;
  navState: NavState;
  isRunning: boolean;
  sensorData: SensorData;
  diagnostics: NavigationDiagnostics;
  eventLog: string[];
  activeBarriers: AisleBarrier[];
  currentDifficulty?: 'normal' | 'hard' | 'extreme';
  lastSpawnedObstacleId?: string;
  lastActionType?: string;
  conversationHistory?: Array<{ sender: string; text: string; action?: string }>;
}

const AISLE_MAP: Record<string, [string, string]> = {
  '1': ['aisle-1', 'Aisle 1 (Rack Bay A-B)'],
  'one': ['aisle-1', 'Aisle 1 (Rack Bay A-B)'],
  'first': ['aisle-1', 'Aisle 1 (Rack Bay A-B)'],
  '2': ['aisle-2', 'Aisle 2 (Rack Bay B-C)'],
  'two': ['aisle-2', 'Aisle 2 (Rack Bay B-C)'],
  'second': ['aisle-2', 'Aisle 2 (Rack Bay B-C)'],
  '3': ['aisle-3', 'Aisle 3 (Rack Bay C-D)'],
  'three': ['aisle-3', 'Aisle 3 (Rack Bay C-D)'],
  'third': ['aisle-3', 'Aisle 3 (Rack Bay C-D)'],
  'west': ['aisle-main-west', 'West Transit Arterial'],
  'east': ['aisle-main-east', 'East Transit Arterial'],
  'north': ['aisle-north-cross', 'North Cross Aisle'],
  'south': ['aisle-south-cross', 'South Cross Aisle'],
};

const WORD_TO_NUM: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

const WAREHOUSE_BOUNDS = {
  minX: -19.0,
  maxX: 19.0,
  minZ: -15.0,
  maxZ: 15.0,
};

export function splitMultiIntentPrompt(prompt: string = ''): string[] {
  const protectedText = prompt.replace(
    /([xX]\s*[:=]?\s*-?\d+\.?\d*)\s*,\s*([zZ]\s*[:=]?\s*-?\d+\.?\d*)/g,
    '$1_COORD_COMMA_$2'
  );

  const actionVerbLookahead = '(?:take|start|begin|launch|block|close|unblock|reopen|create|spawn|place|drop|make|set|put|add|remove|clear|delete|pause|resume|freeze|explain|show|try|run|stop|halt|hold)\\b';
  const pattern = new RegExp(
    '\\s+(?:and\\s+then|then|as\\s+well\\s+as)\\s+|;\\s*|,\\s*(?=' +
      actionVerbLookahead +
      ')|\\s+and\\s+(?=' +
      actionVerbLookahead +
      ')',
    'i'
  );

  const parts = protectedText.split(pattern);
  const cleaned: string[] = [];

  for (const part of parts) {
    if (part && part.trim()) {
      cleaned.push(part.replace(/_COORD_COMMA_/g, ', ').trim());
    }
  }

  return cleaned;
}

export function extractAisle(text: string): [string, string] {
  const low = text.toLowerCase();
  for (const [key, [aid, aname]] of Object.entries(AISLE_MAP)) {
    if (low.includes(`aisle ${key}`) || low.includes(`aisle #${key}`) || low.includes(`aisle-${key}`) || low.includes(`lane ${key}`)) {
      return [aid, aname];
    }
  }
  if (low.includes('second aisle') || low.includes('2nd aisle')) {
    return ['aisle-2', 'Aisle 2 (Rack Bay B-C)'];
  }
  if (low.includes('first aisle') || low.includes('1st aisle')) {
    return ['aisle-1', 'Aisle 1 (Rack Bay A-B)'];
  }
  if (low.includes('third aisle') || low.includes('3rd aisle')) {
    return ['aisle-3', 'Aisle 3 (Rack Bay C-D)'];
  }
  return ['aisle-2', 'Aisle 2 (Rack Bay B-C)'];
}

export function parseCommandLocally(prompt: string, ctx: CommandParseContext): ParsedCommand {
  const raw = prompt.trim();
  const chunks = splitMultiIntentPrompt(raw);

  if (chunks.length > 1) {
    const subActions: SubAction[] = [];
    let requiresAnyApproval = false;
    const allProposedChanges: string[] = [];
    let runningDiff = ctx.currentDifficulty;
    let runningAction = ctx.lastActionType;

    chunks.forEach((chunk, idx) => {
      const subCtx: CommandParseContext = {
        ...ctx,
        currentDifficulty: runningDiff,
        lastActionType: runningAction,
      };
      const parsed = parseSingleIntent(chunk, subCtx);
      if (parsed.action !== 'unknown') {
        const subId = `step-${idx + 1}`;
        subActions.push({
          id: subId,
          action: parsed.action,
          intent: parsed.intent,
          confidence: parsed.confidence,
          parameters: parsed.parameters,
          description: parsed.description,
          requiresApproval: parsed.requiresApproval,
          impactSummary: parsed.impactSummary,
          proposedChanges: parsed.proposedChanges,
        });

        if (parsed.requiresApproval) requiresAnyApproval = true;
        if (parsed.action === 'set_difficulty' && parsed.parameters.difficulty) {
          runningDiff = parsed.parameters.difficulty;
        }
        runningAction = parsed.action;

        parsed.proposedChanges.forEach((change) => {
          allProposedChanges.push(`[Step ${idx + 1}] ${change}`);
        });
      }
    });

    if (subActions.length >= 2) {
      const combinedIntent = subActions.map((s) => s.intent).join(' + ');
      const combinedImpact = `Sequential multi-action workflow: ${subActions.map((s) => s.intent).join(' -> ')}`;
      const avgConfidence = Number(
        (subActions.reduce((acc, curr) => acc + curr.confidence, 0) / subActions.length).toFixed(2)
      );

      return {
        id: `cmd-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        rawPrompt: raw,
        action: subActions[0].action,
        intent: combinedIntent,
        confidence: avgConfidence,
        parameters: subActions[0].parameters,
        description: `Execute ${subActions.length} coordinated simulation operations sequentially.`,
        requiresApproval: requiresAnyApproval,
        impactSummary: combinedImpact,
        proposedChanges: allProposedChanges,
        subActions,
        isMultiIntent: true,
        parserMode: 'deterministic_fallback',
        directResponse: `Prepared composite workflow with ${subActions.length} coordinated actions. Awaiting operator confirmation.`,
      };
    }
  }

  return parseSingleIntent(raw, ctx);
}

function parseSingleIntent(raw: string, ctx: CommandParseContext): ParsedCommand {
  const low = raw.toLowerCase();
  const id = `cmd-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

  // 1. CONTEXTUAL FOLLOW-UP: "ADD TWO MORE"
  if (
    /\badd\s+(?:two|three|four|five|2|3|4|5|another|one|more)\s*(?:more)?\b/.test(low) &&
    !(low.includes('obstacle') || low.includes('box') || low.includes('worker') || low.includes('people'))
  ) {
    const lastAction = ctx.lastActionType || '';
    let count = 2;
    for (const [w, v] of Object.entries(WORD_TO_NUM)) {
      if (low.includes(w)) {
        count = v;
        break;
      }
    }
    const countMatch = low.match(/\b(\d+)\b/);
    if (countMatch) count = parseInt(countMatch[1], 10);

    if (lastAction.includes('worker')) {
      return {
        id,
        rawPrompt: raw,
        action: 'spawn_workers',
        intent: `Spawn ${count} Additional Workers`,
        confidence: 0.95,
        parameters: { count },
        description: `Contextual follow-up: Injected ${count} additional workers based on previous command.`,
        requiresApproval: true,
        impactSummary: `Adds ${count} more moving workers to the active scenario`,
        proposedChanges: [`Spawn ${count} more articulated workers across aisles`],
        parserMode: 'deterministic_fallback',
      };
    } else if (lastAction.includes('obstacle')) {
      return {
        id,
        rawPrompt: raw,
        action: 'spawn_obstacle',
        intent: `Spawn ${count} Additional Obstacles`,
        confidence: 0.95,
        parameters: { count, objectType: 'cube' },
        description: `Contextual follow-up: Injected ${count} additional cargo obstacles.`,
        requiresApproval: true,
        impactSummary: `Adds ${count} more obstacle colliders`,
        proposedChanges: [`Place ${count} additional dynamic cargo boxes in warehouse aisles`],
        parserMode: 'deterministic_fallback',
      };
    } else {
      return {
        id,
        rawPrompt: raw,
        action: 'clarification_needed',
        intent: 'Clarify Follow-Up Request',
        confidence: 0.85,
        parameters: {},
        description: 'The follow-up reference is ambiguous without preceding context.',
        requiresApproval: false,
        impactSummary: 'No simulation changes',
        proposedChanges: [],
        clarificationQuestion: 'Would you like to add more workers or cargo crate obstacles?',
        directResponse: 'Would you like to add more moving workers or cargo crate obstacles?',
        parserMode: 'deterministic_fallback',
      };
    }
  }

  // 2. CONTEXTUAL FOLLOW-UP: "REMOVE THAT OBSTACLE"
  if (
    (low.startsWith('remove that') || low.startsWith('delete that') || low === 'remove the obstacle' || low === 'delete it') &&
    !(low.includes('all') || low.includes('aisle') || low.includes('barrier'))
  ) {
    const targetId = ctx.lastSpawnedObstacleId;
    return {
      id,
      rawPrompt: raw,
      action: 'remove_target_obstacle',
      intent: 'Remove Targeted Obstacle',
      confidence: 0.95,
      parameters: { targetObstacleId: targetId },
      description: 'Remove the most recently placed obstacle from the physics and navigation grids.',
      requiresApproval: true,
      impactSummary: 'Deletes targeted obstacle and restores corridor clearance',
      proposedChanges: [
        `Remove active collider for obstacle '${targetId || 'most recently placed'}'`,
        'Clear obstacle footprint in A* GridMap',
        'Trigger route re-evaluation if navigation is active',
      ],
      directResponse: 'Prepared removal of the targeted obstacle. Awaiting operator confirmation.',
      parserMode: 'deterministic_fallback',
    };
  }

  // 2b. ADVERSARIAL SCENARIO: VERTICAL IMPACT FALLING PALLET TEST
  if (
    low.includes('falling pallet') ||
    low.includes('vertical impact') ||
    low.includes('pallet test') ||
    low.includes('drop pallet')
  ) {
    return {
      id,
      rawPrompt: raw,
      action: 'start_vertical_impact_scenario',
      intent: 'Adversarial Vertical Impact Test',
      confidence: 0.98,
      parameters: {
        difficulty: 'extreme',
        destinationId: 'dest-bay-a',
      },
      description: 'Engage adversarial VERTICAL IMPACT — FALLING PALLET TEST. Suspends 250kg pallet at Y=3.6m above centerline and drops under gravity when AMR approaches within 3m.',
      requiresApproval: true,
      impactSummary: 'Dispatches autonomous AMR on straight route to Bay A with overhead 250kg falling pallet trigger.',
      proposedChanges: [
        'Set environment difficulty to EXTREME',
        'Place AMR at start of North Cross Aisle [-14.5, 0.22, -10.5]',
        'Suspend 250kg heavy pallet at Y=3.6m directly above path centerline',
        'Configure 3.0m proximity drop trigger with Rapier gravity (g=9.81m/s²)',
        'Activate Flight Recorder black box telemetry session',
      ],
      directResponse: 'Adversarial Vertical Impact Falling Pallet Test prepared. Ready to dispatch.',
      parserMode: 'deterministic_fallback',
    };
  }

  // 3. CONTEXTUAL FOLLOW-UP: "TRY ANOTHER ROUTE" / "FIND ANOTHER ROUTE"
  if (
    low.includes('try another route') ||
    low.includes('find another route') ||
    low.includes('find an alternative path') ||
    low.includes('take another route') ||
    low.includes('detour around')
  ) {
    return {
      id,
      rawPrompt: raw,
      action: 'replan_route',
      intent: 'Replan Route (Alternative Corridor)',
      confidence: 0.96,
      parameters: { navigationPreference: 'alternative_route' },
      description: 'Recalculate route to destination using an alternative safe corridor.',
      requiresApproval: false,
      impactSummary: 'AMR recalculates route seeking alternative open aisle',
      proposedChanges: [
        'Force A* pathfinder to evaluate alternative transit corridors',
        'Update planned waypoint ribbon',
      ],
      directResponse: 'Replanning route via alternative corridor.',
      parserMode: 'deterministic_fallback',
    };
  }

  // 4. CONTEXTUAL FOLLOW-UP: "RUN THE SAME TEST AGAIN"
  if (low.includes('run the same test again') || low.includes('retry the test') || low.includes('repeat the test') || low.includes('rerun mission')) {
    return {
      id,
      rawPrompt: raw,
      action: 'start_mission',
      intent: 'Rerun Simulation Test',
      confidence: 0.95,
      parameters: { destinationId: 'bay-4' },
      description: 'Reset AMR pose and re-execute the autonomous mission from baseline.',
      requiresApproval: false,
      impactSummary: 'Resets AMR to start position and re-executes mission',
      proposedChanges: [
        'Reset AMR position to charging dock',
        'Recalculate A* path to Bay 4',
        'Engage autonomous driving controller',
      ],
      directResponse: 'Rerunning mission to Bay 4.',
      parserMode: 'deterministic_fallback',
    };
  }

  // 5. EXPLAIN WHY ROBOT STOPPED / WHAT HAPPENED
  if (
    (low.includes('why') && (low.includes('stop') || low.includes('halt') || low.includes('stuck') || low.includes('not moving') || low.includes('paused'))) ||
    (low.includes('explain') && (low.includes('stop') || low.includes('halt') || low.includes('stuck') || low.includes('status') || low.includes('happened') || low.includes('failure'))) ||
    low.includes('what happened') ||
    low.includes('why did it halt') ||
    low.includes('diagnose')
  ) {
    const explanation = generateTelemetryExplanation(ctx);
    return {
      id,
      rawPrompt: raw,
      action: 'query_explanation',
      intent: 'Explain Robot Stoppage',
      confidence: 0.99,
      parameters: {},
      description: 'Analyze real-time simulation telemetry to diagnose robot stoppage reason.',
      requiresApproval: false,
      impactSummary: 'Telemetry query (Read-Only)',
      proposedChanges: [],
      directResponse: explanation,
      parserMode: 'deterministic_fallback',
    };
  }

  // 6. SHOW LATEST COLLISION AND SAFETY EVENTS
  if (
    (low.includes('event') || low.includes('collision') || low.includes('log') || low.includes('incident') || low.includes('near miss')) &&
    (low.includes('show') || low.includes('latest') || low.includes('list') || low.includes('get') || low.includes('what') || low.includes('view'))
  ) {
    const summary = generateEventsSummary(ctx);
    return {
      id,
      rawPrompt: raw,
      action: 'query_events',
      intent: 'Query Safety & Collision Events',
      confidence: 0.96,
      parameters: {},
      description: 'Retrieve recent collision metrics and chronological safety event logs.',
      requiresApproval: false,
      impactSummary: 'Telemetry query (Read-Only)',
      proposedChanges: [],
      directResponse: summary,
      parserMode: 'deterministic_fallback',
    };
  }

  // 7. EMERGENCY STOP (Immediate Execution, Highest Safety Priority)
  // Examples: "Emergency stop.", "Stop immediately.", "Halt immediately.", "E-stop.", "Stop right now."
  if (
    low.includes('emergency stop') ||
    low.includes('e-stop') ||
    low.includes('estop') ||
    /\b(?:stop|halt)\s+(?:immediately|now|right\s+now|at\s+once)\b/.test(low) ||
    /\b(?:emergency\s+brake|emergency\s+halt)\b/.test(low)
  ) {
    return {
      id,
      rawPrompt: raw,
      action: 'emergency_stop',
      intent: 'Emergency Stop',
      confidence: 0.99,
      parameters: { emergencyStopActive: true },
      description: 'Engage physical emergency brake (18.0 m/s²) and halt robot immediately.',
      requiresApproval: false,
      impactSummary: 'Safety critical: Emergency Stop ENGAGED',
      proposedChanges: ['Engage emergency braking mechanism (18.0 m/s²)', 'Halt AMR immediately at current position'],
      directResponse: 'Emergency Stop ENGAGED. Maximum deceleration applied. Robot halted immediately.',
      parserMode: 'deterministic_fallback',
    };
  }

  // 8. PAUSE THE SIMULATION (Clock & Physics Frozen)
  // Examples: "Pause the simulation.", "Freeze the simulation.", "Pause sim.", "Freeze sim."
  if (
    /\b(?:pause|freeze|suspend)\s+(?:the\s+)?(?:simulation|sim|clock|world)\b/.test(low) ||
    ['pause', 'freeze', 'pause sim', 'freeze sim', 'pause simulation', 'freeze simulation'].includes(low.trim())
  ) {
    return {
      id,
      rawPrompt: raw,
      action: 'set_simulation_state',
      intent: 'Pause Simulation',
      confidence: 0.99,
      parameters: { simulationRunning: false },
      description: 'Pause the simulation clock and freeze all dynamic motion.',
      requiresApproval: false,
      impactSummary: 'Simulation state change: PAUSED',
      proposedChanges: ['Set simulation clock to PAUSED', 'Hold AMR and dynamic actors in place'],
      directResponse: 'Simulation clock paused. All robot and dynamic entity movement suspended.',
      parserMode: 'deterministic_fallback',
    };
  }

  // 9. PAUSE THE ROBOT (Preserving Route, Destination & Pose)
  // Examples: "Pause the robot.", "Stop the robot temporarily.", "Hold position.", "Pause navigation.", "Hold the robot."
  if (
    /\b(?:pause|stop)\s+(?:the\s+)?(?:robot|amr|navigation|mission)\b/.test(low) ||
    /\bstop\s+(?:the\s+)?(?:robot|amr)\s+temporarily\b/.test(low) ||
    /\bhold\s+(?:position|the\s+robot|here)\b/.test(low) ||
    low.includes('pause the robot') ||
    low.includes('stop the robot temporarily') ||
    low.includes('hold position')
  ) {
    return {
      id,
      rawPrompt: raw,
      action: 'pause_mission',
      intent: 'Pause Robot Navigation',
      confidence: 0.98,
      parameters: {},
      description: 'Temporarily stop robot movement while preserving mission, route, and destination.',
      requiresApproval: false,
      impactSummary: 'Robot state: STOPPED (Route & destination preserved)',
      proposedChanges: ['Set robot navigation state to STOPPED', 'Hold robot in place without erasing route'],
      directResponse: 'Robot paused and holding position. Active route and destination preserved.',
      parserMode: 'deterministic_fallback',
    };
  }

  // 10. RESUME THE SIMULATION (Clock & Physics Active)
  // Examples: "Resume the simulation.", "Unfreeze the simulation.", "Resume sim.", "Restart the clock."
  if (
    /\b(?:resume|unpause|unfreeze)\s+(?:the\s+)?(?:simulation|sim|clock)\b/.test(low) ||
    ['resume', 'unpause', 'unfreeze', 'resume sim', 'resume simulation'].includes(low.trim())
  ) {
    return {
      id,
      rawPrompt: raw,
      action: 'set_simulation_state',
      intent: 'Resume Simulation',
      confidence: 0.99,
      parameters: { simulationRunning: true },
      description: 'Resume the simulation clock and active robot execution.',
      requiresApproval: false,
      impactSummary: 'Simulation state change: RUNNING',
      proposedChanges: ['Set simulation clock to RUNNING', 'Resume AMR kinematics and mission execution'],
      directResponse: 'Simulation clock resumed. Navigation and physics active.',
      parserMode: 'deterministic_fallback',
    };
  }

  // 11. RESUME ROBOT NAVIGATION (Continue Active Mission)
  // Examples: "Resume the robot.", "Continue the mission.", "Continue moving.", "Restart navigation.", "Resume navigation."
  if (
    /\b(?:continue|resume)\s+(?:the\s+)?(?:mission|robot|navigation|moving|journey|drive)\b/.test(low) ||
    /\brestart\s+(?:navigation|mission)\b/.test(low) ||
    low.includes('continue moving') ||
    low.includes('resume the robot') ||
    low.includes('continue the mission') ||
    low.includes('restart navigation')
  ) {
    return {
      id,
      rawPrompt: raw,
      action: 'resume_mission',
      intent: 'Resume Robot Navigation',
      confidence: 0.98,
      parameters: {},
      description: 'Resume autonomous robot navigation along planned path.',
      requiresApproval: false,
      impactSummary: 'Robot state: MOVING (Resuming mission)',
      proposedChanges: ['Set robot navigation state to MOVING', 'Continue along planned trajectory'],
      directResponse: 'Navigation resumed. Robot continuing mission along planned route.',
      parserMode: 'deterministic_fallback',
    };
  }

  // 12. START THE SIMULATION (Clock & Physics Active)
  // Examples: "Start the simulation.", "Run the simulation.", "Start sim."
  if (/\b(?:start|run|launch)\s+(?:the\s+)?(?:simulation|sim)\b/.test(low)) {
    return {
      id,
      rawPrompt: raw,
      action: 'set_simulation_state',
      intent: 'Start Simulation',
      confidence: 0.99,
      parameters: { simulationRunning: true },
      description: 'Start the simulation clock and physics engine.',
      requiresApproval: false,
      impactSummary: 'Simulation state change: RUNNING',
      proposedChanges: ['Set simulation clock to RUNNING', 'Enable active physics and sensor perception'],
      directResponse: 'Simulation started. Clock and physics engine active.',
      parserMode: 'deterministic_fallback',
    };
  }

  // 13. SET DIFFICULTY (Flexible Synonyms)
  if (
    /\b(?:tough|challenging|extreme|impossible|stress\s+test|harder|difficulty|hard\s+mode)\b/.test(low) ||
    ((low.includes('make') || low.includes('set') || low.includes('put') || low.includes('increase')) &&
      (low.includes('hard') || low.includes('tough') || low.includes('extreme') || low.includes('difficult') || low.includes('challenging') || low.includes('difficulty')))
  ) {
    let level: 'hard' | 'extreme' | 'normal' = 'extreme';
    if (low.includes('extreme') || low.includes('impossible') || low.includes('tough') || low.includes('challenging') || low.includes('stress') || low.includes('increase')) {
      level = 'extreme';
    } else if (low.includes('harder')) {
      const curr = ctx.currentDifficulty || 'normal';
      level = curr === 'hard' ? 'extreme' : 'hard';
    } else if (low.includes('hard') || low.includes('difficult')) {
      level = 'hard';
    } else if (low.includes('normal') || low.includes('easy') || low.includes('standard')) {
      level = 'normal';
    }

    return {
      id,
      rawPrompt: raw,
      action: 'set_difficulty',
      intent: `Set Simulation Difficulty to ${String(level || 'normal').toUpperCase()}`,
      confidence: 0.96,
      parameters: { difficulty: level },
      description: `Configure simulation for ${String(level || 'normal').toUpperCase()} testing stress conditions.`,
      requiresApproval: true,
      impactSummary: `Injects multiple moving hazards and closes critical transit corridors (${String(level || 'normal').toUpperCase()})`,
      proposedChanges: [
        `Set scenario difficulty profile to ${String(level || 'normal').toUpperCase()}`,
        'Spawn moving workers along primary aisles',
        'Place cargo hazards along central cross-transit arterial',
        'Close Aisle 2 center crossing to stress route replanning',
      ],
      directResponse: `Configured ${String(level || 'normal').toUpperCase()} difficulty scenario. Awaiting operator confirmation.`,
      parserMode: 'deterministic_fallback',
    };
  }

  // 14. START AUTONOMOUS MISSION & NAVIGATION PREFERENCES
  if (
    (/\b(?:start|begin|launch|engage|drive|navigate|go|run)\b/.test(low) &&
      /\b(?:robot|mission|navigation|autonomous|amr|course|path|route)\b/.test(low)) ||
    /\b(?:take\s+it\s+through|use\s+the|find\s+the)\s+(?:shortest|quickest|fastest|safe)\s+(?:path|route)\b/.test(low) ||
    /\bshortest\s+(?:safe\s+)?(?:path|route)\b/.test(low)
  ) {
    let pref: 'default' | 'shortest_safe_path' | 'alternative_route' = 'default';
    if (low.includes('shortest') || low.includes('quickest') || low.includes('fastest') || low.includes('direct')) {
      pref = 'shortest_safe_path';
    } else if (low.includes('avoid') || low.includes('alternative')) {
      pref = 'alternative_route';
    }

    const prefLabel = pref === 'shortest_safe_path' ? ' (Shortest Safe Route)' : pref === 'alternative_route' ? ' (Alternative Route)' : '';
    return {
      id,
      rawPrompt: raw,
      action: 'start_mission',
      intent: `Start Autonomous Mission${prefLabel}`,
      confidence: 0.96,
      parameters: { navigationPreference: pref },
      description: `Initiate A* pathfinding and autonomous waypoint pursuit to Bay 4 Delivery Drop-off using ${pref.replace(/_/g, ' ')}.`,
      requiresApproval: false,
      impactSummary: `AMR will compute A* route and begin autonomous driving (${pref.replace(/_/g, ' ')})`,
      proposedChanges: [
        `Calculate collision-free route from current pose to Bay 4 using ${pref.replace(/_/g, ' ')}`,
        'Strictly adhere to 0.54m obstacle inflation safety clearance and Rapier collision boundaries',
        'Engage differential-drive steering controller and 15-beam LiDAR obstacle avoidance',
      ],
      directResponse: `Autonomous mission started${prefLabel}. Navigating to Bay 4.`,
      parserMode: 'deterministic_fallback',
    };
  }

  // 11. CROWDED WAREHOUSE / MOVING WORKERS
  if (/\b(?:workers?|pedestrians?|persons?|people|crowd(?:ed)?)\b/.test(low)) {
    let count = 5;
    const countMatch = low.match(/\b(\d+)\b/);
    if (countMatch) {
      count = parseInt(countMatch[1], 10);
    } else {
      for (const [word, val] of Object.entries(WORD_TO_NUM)) {
        if (low.includes(word)) {
          count = val;
          break;
        }
      }
    }

    return {
      id,
      rawPrompt: raw,
      action: 'spawn_workers',
      intent: `Spawn ${count} Moving Workers`,
      confidence: 0.95,
      parameters: { count },
      description: `Inject ${count} autonomous warehouse workers patrolling major cross-aisles.`,
      requiresApproval: true,
      impactSummary: `Adds ${count} dynamic obstacles into physics and navigation grids`,
      proposedChanges: [
        `Spawn ${count} articulated 3D workers with high-visibility safety vests and hardhats`,
        'Register each worker in Rapier physics engine as kinematic colliders',
        'Synchronize moving coordinates into A* GridMap and LiDAR perception on every frame',
      ],
      directResponse: `Configured scenario with ${count} moving warehouse workers. Awaiting operator confirmation.`,
      parserMode: 'deterministic_fallback',
    };
  }

  // 12. UNBLOCK AISLE / REOPEN AISLE
  if (
    /\b(?:unblock(?:ed|ing)?|reopen(?:ed|ing)?|clear(?:ed|ing)?|remove(?:d|ing)?)\b/.test(low) &&
    /\b(?:aisles?|corridors?|lanes?|barricades?|blockages?|barriers?)\b/.test(low) &&
    !(/\b(?:all|dynamic)\b/.test(low) && low.includes('obstacle'))
  ) {
    const [aisleId, aisleName] = extractAisle(low);
    return {
      id,
      rawPrompt: raw,
      action: 'unblock_aisle',
      intent: `Unblock ${aisleName}`,
      confidence: 0.95,
      parameters: { aisleId, aisleName },
      description: `Remove barricade from ${aisleName} and reopen transit corridor.`,
      requiresApproval: true,
      impactSummary: `Restores passage through ${aisleName}`,
      proposedChanges: [
        `Remove physical barricade collider from ${aisleName}`,
        'Clear barrier cells from GridMap occupancy grid',
        'Allow AMR to utilize direct corridor for optimal pathfinding',
      ],
      directResponse: `Prepared removal of barricade from ${aisleName}. Awaiting operator confirmation.`,
      parserMode: 'deterministic_fallback',
    };
  }

  // 13. BLOCK AISLE
  if (
    !/\b(?:unblock|reopen|clear|remove)\b/.test(low) &&
    /\b(?:blocks?|blocking|close[sd]?|closing|barricades?|barricading|shuts?|shutting|seals?|sealing|inaccessible)\b/.test(low) &&
    /\b(?:aisles?|corridors?|lanes?)\b/.test(low)
  ) {
    let hasSpecificAisle = false;
    for (const k of Object.keys(AISLE_MAP)) {
      if (low.includes(k)) {
        hasSpecificAisle = true;
        break;
      }
    }
    if (!hasSpecificAisle) {
      return {
        id,
        rawPrompt: raw,
        action: 'clarification_needed',
        intent: 'Clarify Aisle Selection',
        confidence: 0.88,
        parameters: {},
        description: 'The operator requested blocking an aisle without specifying which one.',
        requiresApproval: false,
        impactSummary: 'No simulation changes',
        proposedChanges: [],
        clarificationQuestion: 'Which aisle would you like to block? You can specify Aisle 1, Aisle 2, Aisle 3, West Transit Arterial, or East Transit Arterial.',
        directResponse: 'Which aisle would you like to block? You can specify Aisle 1, Aisle 2, Aisle 3, West Transit Arterial, or East Transit Arterial.',
        parserMode: 'deterministic_fallback',
      };
    }

    const [aisleId, aisleName] = extractAisle(low);
    return {
      id,
      rawPrompt: raw,
      action: 'block_aisle',
      intent: `Block ${aisleName}`,
      confidence: 0.96,
      parameters: { aisleId, aisleName },
      description: `Erect heavy industrial barricade across ${aisleName}.`,
      requiresApproval: true,
      impactSummary: `Seals corridor ${aisleId} and forces autonomous rerouting`,
      proposedChanges: [
        `Spawn physical Rapier barricade collider across ${aisleName}`,
        'Render yellow/black hazard chevrons and flashing amber beacons',
        'Mark aisle cells as impassable in GridMap and trigger instant A* replan',
      ],
      directResponse: `Prepared barricade across ${aisleName}. Awaiting operator confirmation.`,
      parserMode: 'deterministic_fallback',
    };
  }

  // 14. CLEAR ALL DYNAMIC OBSTACLES
  if (
    /\b(?:clear|remove|delete|reset|clean\s+up)\b/.test(low) &&
    /\b(?:obstacles?|boxes|crates?|spheres?|objects?|hazards?)\b/.test(low) &&
    !/\b(?:aisles?|barriers?|barricades?)\b/.test(low)
  ) {
    return {
      id,
      rawPrompt: raw,
      action: 'clear_obstacles',
      intent: 'Clear All Dynamic Obstacles',
      confidence: 0.97,
      parameters: {},
      description: 'Remove all dynamically placed crates, spheres, and workers from the warehouse.',
      requiresApproval: true,
      impactSummary: 'Deletes all user-spawned obstacles from physics and navigation',
      proposedChanges: [
        'Remove all placed dynamic bodies from Rapier physics world',
        'Clear dynamic cells from A* GridMap',
        'Reopen previously obstructed corridors',
      ],
      directResponse: 'Prepared to clear all dynamic test obstacles. Awaiting operator confirmation.',
      parserMode: 'deterministic_fallback',
    };
  }

  // 15. AMBIGUOUS ACTION DETECTION
  const cleanStripped = low.replace(/[\.!\?]+$/g, '').trim();
  if (
    ['drop it', 'drop something', 'do something', 'change speed', 'change something', 'block it', 'make it different', 'put it'].includes(cleanStripped) ||
    /^\s*(?:drop|place|put)\s+(?:something|it)\s*[\.!\?]?\s*$/.test(low)
  ) {
    return {
      id,
      rawPrompt: raw,
      action: 'clarification_needed',
      intent: 'Ambiguous Instruction',
      confidence: 0.75,
      parameters: {},
      description: 'The instruction is too ambiguous to determine the exact simulation action.',
      requiresApproval: false,
      impactSummary: 'No simulation changes',
      proposedChanges: [],
      clarificationQuestion: "Could you please specify what action you would like to perform? For example: 'Place a box 3m ahead', 'Block aisle 2', or 'Set difficulty to extreme'.",
      directResponse: `I need a little more detail to execute '${raw}'. Would you like to spawn an obstacle ahead, block a specific aisle, or start an autonomous navigation mission?`,
      parserMode: 'deterministic_fallback',
    };
  }

  // 16. PLACE OBSTACLE / BOX / SPHERE
  if (
    /\b(?:places?|placing|drops?|dropping|spawns?|spawning|puts?|putting|creates?|creating|adds?|adding)\b/.test(low) &&
    /\b(?:box(?:es)?|crates?|obstacles?|spheres?|balls?|cubes?|hazards?|something|barriers?)\b/.test(low) &&
    !/\b(?:aisles?|workers?|pedestrians?|people)\b/.test(low)
  ) {
    const objType: 'cube' | 'sphere' = low.includes('sphere') || low.includes('ball') ? 'sphere' : 'cube';

    // Check explicit coordinates
    const coordMatch = raw.match(/[xX]\s*[:=]?\s*(-?\d+\.?\d*)\s*,?\s*[zZ]\s*[:=]?\s*(-?\d+\.?\d*)/);
    if (coordMatch) {
      const xVal = parseFloat(coordMatch[1]);
      const zVal = parseFloat(coordMatch[2]);

      if (xVal < WAREHOUSE_BOUNDS.minX || xVal > WAREHOUSE_BOUNDS.maxX || zVal < WAREHOUSE_BOUNDS.minZ || zVal > WAREHOUSE_BOUNDS.maxZ) {
        return {
          id,
          rawPrompt: raw,
          action: 'clarification_needed',
          intent: 'Out of Bounds Coordinates',
          confidence: 0.9,
          parameters: { position: [xVal, 0.4, zVal] },
          description: 'Requested obstacle coordinates fall outside warehouse boundaries.',
          requiresApproval: false,
          impactSummary: 'No simulation changes',
          proposedChanges: [],
          clarificationQuestion: `Coordinates [${xVal.toFixed(1)}, ${zVal.toFixed(1)}] are outside warehouse boundaries (${WAREHOUSE_BOUNDS.minX} to ${WAREHOUSE_BOUNDS.maxX} on X, ${WAREHOUSE_BOUNDS.minZ} to ${WAREHOUSE_BOUNDS.maxZ} on Z). Please specify coordinates within the warehouse.`,
          directResponse: `Coordinates [${xVal.toFixed(1)}, ${zVal.toFixed(1)}] are outside the warehouse boundaries. Please select coordinates within [${WAREHOUSE_BOUNDS.minX}m, ${WAREHOUSE_BOUNDS.maxX}m] on X and [${WAREHOUSE_BOUNDS.minZ}m, ${WAREHOUSE_BOUNDS.maxZ}m] on Z.`,
          parserMode: 'deterministic_fallback',
        };
      }

      const pos: [number, number, number] = [xVal, objType === 'cube' ? 0.4 : 0.5, zVal];
      return {
        id,
        rawPrompt: raw,
        action: 'spawn_obstacle',
        intent: `Place ${objType === 'cube' ? 'Cargo Box' : 'Safety Sphere'} at [${xVal.toFixed(1)}, ${zVal.toFixed(1)}]`,
        confidence: 0.96,
        parameters: { objectType: objType, position: pos },
        description: `Place a physical ${objType} at coordinates [${xVal.toFixed(1)}, ${zVal.toFixed(1)}].`,
        requiresApproval: true,
        impactSummary: `Spawns ${objType} with active collision and navigation inflation`,
        proposedChanges: [
          `Create dynamic ${objType} at world coordinates [${xVal.toFixed(1)}, 0.4, ${zVal.toFixed(1)}]`,
          'Add rigid body collider in Rapier physics',
          'Inflate obstacle radius in GridMap occupancy grid',
        ],
        directResponse: `Configured ${objType} placement at [${xVal.toFixed(1)}, ${zVal.toFixed(1)}]. Awaiting operator confirmation.`,
        parserMode: 'deterministic_fallback',
      };
    }

    // Check distance ahead
    let distAhead = 3.0;
    const distMatch = low.match(/(\d+\.?\d*)\s*(?:m|meter|metre)/);
    if (distMatch) {
      distAhead = parseFloat(distMatch[1]);
    } else {
      for (const [word, val] of Object.entries(WORD_TO_NUM)) {
        if (low.includes(`${word} metre`) || low.includes(`${word} meter`) || low.includes(`${word} m `) || low.includes(`${word} meters`)) {
          distAhead = val;
          break;
        }
      }
    }

    const [rx, , rz] = ctx.robotPose.position;
    const yaw = ctx.robotPose.rotation || 0;
    const tx = Number((rx + Math.sin(yaw) * distAhead).toFixed(2));
    const tz = Number((rz + Math.cos(yaw) * distAhead).toFixed(2));
    const pos: [number, number, number] = [tx, objType === 'cube' ? 0.4 : 0.5, tz];

    return {
      id,
      rawPrompt: raw,
      action: 'spawn_obstacle',
      intent: `Place ${objType === 'cube' ? 'Cargo Box' : 'Safety Sphere'} ${distAhead.toFixed(1)}m Ahead of Robot`,
      confidence: 0.96,
      parameters: {
        objectType: objType,
        position: pos,
        relativeToRobot: { distanceAhead: distAhead },
      },
      description: `Place a ${objType} ${distAhead.toFixed(1)} meters directly in the AMR forward path.`,
      requiresApproval: true,
      impactSummary: `Tests predictive braking and dynamic obstacle avoidance at ${distAhead.toFixed(1)}m`,
      proposedChanges: [
        `Calculate coordinate ${distAhead.toFixed(1)}m along robot heading vector -> [${tx}, ${tz}]`,
        `Spawn physical ${objType} with Rapier collision geometry`,
        'LiDAR sensor will detect obstacle and trigger reactive replanning/braking',
      ],
      directResponse: `Configured ${objType} placement ${distAhead.toFixed(1)}m ahead of the robot. Awaiting operator confirmation.`,
      parserMode: 'deterministic_fallback',
    };
  }

  // 17. DEFAULT UNRECOGNIZED FALLBACK
  return {
    id,
    rawPrompt: raw,
    action: 'unknown',
    intent: 'Unrecognized Instruction',
    confidence: 0.15,
    parameters: {},
    description: 'The command could not be matched to a supported simulation action.',
    requiresApproval: false,
    impactSummary: 'No simulation changes',
    proposedChanges: [],
    directResponse: `I did not recognize the command '${raw}'. Supported actions include:\n- 'Place a box three metres ahead of the robot'\n- 'Block the second aisle'\n- 'Make it tough and take it through the shortest path'\n- 'Create a crowded warehouse with five moving workers'\n- 'Make the simulation extremely difficult'\n- 'Take the shortest path' / 'Start the autonomous mission'\n- 'Pause the robot' / 'Resume the simulation'\n- 'Explain why the robot stopped'\n- 'Show me the latest collision and safety events'`,
    parserMode: 'deterministic_fallback',
  };
}

export function generateTelemetryExplanation(ctx: CommandParseContext): string {
  const lines: string[] = [];
  lines.push('🤖 **ROBOT TELEMETRY ROOT-CAUSE ANALYSIS:**');

  if (!ctx.isRunning) {
    lines.push('• **Simulation State**: The simulation clock is currently **PAUSED** by the operator.');
    return lines.join('\n');
  }

  if (ctx.robotStatus.isEmergencyStopped) {
    lines.push('• **Safety Stop**: Emergency Stop (E-Stop) is currently **ENGAGED**.');
    return lines.join('\n');
  }

  if (ctx.robotStatus.battery <= 0) {
    lines.push('• **Power Failure**: Robot battery pack is fully depleted (0.0%). Returned to dock or waiting for recharge.');
    return lines.join('\n');
  }

  if (ctx.navState === 'COMPLETED') {
    lines.push('• **Mission Status**: Destination reached! The AMR successfully arrived at its target delivery drop-off.');
    return lines.join('\n');
  }

  if (ctx.navState === 'IDLE') {
    lines.push('• **Mission Status**: AMR is in **STANDBY (IDLE)** mode. No active autonomous navigation route is running.');
    return lines.join('\n');
  }

  if (ctx.navState === 'FAILED') {
    const reason = ctx.diagnostics.failureExplanation || 'All valid corridors to the selected destination are obstructed.';
    lines.push(`• **Navigation Failure**: ${reason}`);
    return lines.join('\n');
  }

  if (ctx.sensorData.closestObstacle) {
    const dist = ctx.sensorData.forwardDist;
    const coords = ctx.diagnostics.obstaclePosition
      ? `[${ctx.diagnostics.obstaclePosition[0].toFixed(1)}, ${ctx.diagnostics.obstaclePosition[1].toFixed(1)}]`
      : 'directly ahead';
    const stopDist = ctx.diagnostics.stoppingDistance ?? (ctx.robotPose.linearVelocity ** 2 / 12.0);
    const risk = ctx.sensorData.riskLevel;
    const braking = ctx.diagnostics.brakingStatus || 'controlled_braking';

    lines.push(`• **Detected Threat**: '${ctx.sensorData.closestObstacle}' detected at coordinates ${coords}.`);
    lines.push(`• **Distance to Obstacle**: Forward clearance is **${dist.toFixed(2)}m**.`);
    lines.push(`• **Braking Horizon**: Required safe stopping distance ($d=v^2/2a$) is **${stopDist.toFixed(2)}m**.`);
    const safeRisk = String(risk || 'normal').toUpperCase();
    const safeBraking = String(braking || 'controlled_braking').replace(/_/g, ' ').toUpperCase();
    lines.push(`• **Risk Classification**: **${safeRisk}** (Braking status: ${safeBraking}).`);

    if (risk === 'critical' || braking === 'emergency_braking') {
      lines.push('• **Safety Action**: Proximity encroached stopping boundary! Emergency braking engaged (18.0 m/s²) to prevent collision.');
    } else {
      lines.push('• **Safety Action**: AMR is actively decelerating and executing an A* replan detour around the obstruction.');
    }
  } else {
    lines.push('• **LiDAR Perception**: Forward sensor cone is clear. Robot is currently holding or waiting for navigation commands.');
  }

  if (ctx.diagnostics.routeValidity === 'blocked') {
    lines.push('• **Route State**: Current navigation path is blocked by an obstruction. Automatic replanning is active.');
  }

  return lines.join('\n');
}

export function generateEventsSummary(ctx: CommandParseContext): string {
  const lines: string[] = [];
  lines.push('📊 **LATEST COLLISION & SAFETY EVENT REPORT:**');
  const collisions = ctx.robotStatus.collisionCount;
  const force = ctx.robotStatus.lastCollisionForce;

  lines.push(`• **Physical Collisions Recorded**: **${collisions}**`);
  if (collisions > 0) {
    lines.push(`• **Last Impact Force**: ${force.toFixed(1)} N`);
  }

  if (ctx.eventLog && ctx.eventLog.length > 0) {
    lines.push('\n**Recent Chronological Event Log:**');
    for (const ev of ctx.eventLog.slice(0, 6)) {
      lines.push(`  - ${ev}`);
    }
  } else {
    lines.push('• **Event Stream**: No recent safety anomalies or collision events recorded.');
  }

  return lines.join('\n');
}

export async function parseCommandWithBackend(
  prompt: string,
  ctx: CommandParseContext
): Promise<ParsedCommand> {
  const fallback = parseCommandLocally(prompt, ctx);

  try {
    const payload: CommandContextPayload = {
      prompt,
      context: {
        robot_position: ctx.robotPose.position,
        robot_yaw: ctx.robotPose.rotation,
        robot_speed: ctx.robotPose.linearVelocity,
        nav_state: ctx.navState,
        is_e_stopped: ctx.robotStatus.isEmergencyStopped,
        is_running: ctx.isRunning,
        closest_obstacle: ctx.sensorData.closestObstacle,
        obstacle_position: ctx.diagnostics.obstaclePosition,
        forward_clearance: ctx.sensorData.forwardDist,
        risk_level: ctx.sensorData.riskLevel,
        stopping_distance: ctx.diagnostics.stoppingDistance,
        braking_status: ctx.diagnostics.brakingStatus,
        route_validity: ctx.diagnostics.routeValidity,
        failure_explanation: ctx.diagnostics.failureExplanation,
        collision_count: ctx.robotStatus.collisionCount,
        last_collision_force: ctx.robotStatus.lastCollisionForce,
        recent_events: ctx.eventLog.slice(0, 6),
        current_difficulty: ctx.currentDifficulty,
        last_spawned_obstacle_id: ctx.lastSpawnedObstacleId,
        last_action_type: ctx.lastActionType,
        conversation_history: ctx.conversationHistory,
      },
    };

    const res = await fetch('http://127.0.0.1:8000/api/command/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      const data = await res.json();
      return {
        id: fallback.id,
        rawPrompt: prompt,
        action: data.action as CommandActionType,
        intent: data.intent,
        confidence: data.confidence,
        parameters: data.parameters,
        description: data.description,
        requiresApproval: data.requires_approval,
        impactSummary: data.impact_summary,
        proposedChanges: data.proposed_changes,
        subActions: data.sub_actions,
        isMultiIntent: data.is_multi_intent,
        clarificationQuestion: data.clarification_question,
        parserMode: data.parser_mode,
        directResponse: data.direct_response,
      };
    }
  } catch {
    // Backend unreachable, smoothly use local deterministic parser
  }

  return fallback;
}
