import { describe, it, expect, beforeEach } from 'vitest';
import { parseCommandLocally, CommandParseContext } from '../aiCommandParser';
import { useSimulationStore } from '../../state/useSimulationStore';

describe('AI Command Center: Intent Recognition, Schema Validation & Approval Gate', () => {
  let mockContext: CommandParseContext;

  beforeEach(() => {
    // Reset simulation store
    const store = useSimulationStore.getState();
    store.clearInteractiveObjects();
    store.clearAllBarriers();
    store.clearChatMessages();
    useSimulationStore.setState({
      difficulty: 'normal',
      navState: 'IDLE',
      navigationPreference: 'default',
    });
    if (!store.isRunning) store.togglePlayPause();
    store.setMode('ai_command');

    mockContext = {
      robotPose: {
        position: [-14.5, 0.22, -10.5],
        rotation: 0, // Heading +Z
        linearVelocity: 0,
        angularVelocity: 0,
      },
      robotStatus: {
        battery: 98,
        isEmergencyStopped: false,
        collisionCount: 0,
        lastCollisionForce: 0,
      },
      navState: 'IDLE',
      isRunning: true,
      sensorData: {
        forwardDist: 5.5,
        leftDist: 2.5,
        rightDist: 2.5,
        riskLevel: 'clear',
        closestObstacle: null,
        obstaclePosition: null,
      },
      diagnostics: {
        currentWaypoint: null,
        currentWaypointIndex: 0,
        totalWaypoints: 0,
        lastMovedTime: 0,
        timeStopped: 0,
        obstaclePosition: null,
        obstacleName: null,
        routeValidity: 'valid',
        replanReason: 'System Ready',
        routeDiffers: false,
        failureExplanation: null,
        stoppingDistance: 0,
        availableClearance: 5.5,
        brakingStatus: 'cruising',
      },
      eventLog: ['[SYSTEM] System Ready'],
      activeBarriers: [],
    };
  });

  describe('Acceptance Command 1: "Place a box three metres ahead of the robot."', () => {
    it('parses relative distance ahead and enforces human-in-the-loop approval', () => {
      const parsed = parseCommandLocally('Place a box three metres ahead of the robot.', mockContext);

      expect(parsed.action).toBe('spawn_obstacle');
      expect(parsed.requiresApproval).toBe(true);
      expect(parsed.parameters.objectType).toBe('cube');
      expect(parsed.parameters.relativeToRobot?.distanceAhead).toBe(3.0);

      // Verify coordinate 3m ahead of [-14.5, -10.5] along yaw=0 (+Z forward):
      // Z should be -10.5 + 3.0 = -7.5
      expect(parsed.parameters.position).toBeDefined();
      expect(parsed.parameters.position![0]).toBeCloseTo(-14.5, 1);
      expect(parsed.parameters.position![2]).toBeCloseTo(-7.5, 1);
    });

    it('modifies the real 3D simulation only after user approval, and does NOT modify upon reject', async () => {
      const store = useSimulationStore.getState();
      expect(store.interactiveObjects.length).toBe(0);

      // Send command
      await store.sendChatMessage('Place a box three metres ahead of the robot.');
      const pending = useSimulationStore.getState().pendingCommand;
      expect(pending).not.toBeNull();
      expect(pending?.action).toBe('spawn_obstacle');

      // Before approval: zero objects in simulation
      expect(useSimulationStore.getState().interactiveObjects.length).toBe(0);

      // 1. Test Rejection: Simulation must NOT be modified
      store.rejectCommand(pending!.id);
      expect(useSimulationStore.getState().interactiveObjects.length).toBe(0);
      expect(useSimulationStore.getState().pendingCommand).toBeNull();

      // 2. Send again and Approve: Simulation MUST be modified
      await store.sendChatMessage('Place a box three metres ahead of the robot.');
      const pending2 = useSimulationStore.getState().pendingCommand;
      expect(pending2).not.toBeNull();

      store.approveCommand(pending2!.id);
      expect(useSimulationStore.getState().interactiveObjects.length).toBe(1);

      const placedBox = useSimulationStore.getState().interactiveObjects[0];
      expect(placedBox.type).toBe('cube');
      expect(placedBox.position[0]).toBeCloseTo(-14.5, 1);
      expect(placedBox.position[2]).toBeCloseTo(-7.5, 1);
    });
  });

  describe('Acceptance Command 2: "Block aisle two."', () => {
    it('parses aisle identification and requests operator approval before erecting barricade', () => {
      const parsed = parseCommandLocally('Block the entire second aisle.', mockContext);

      expect(parsed.action).toBe('block_aisle');
      expect(parsed.requiresApproval).toBe(true);
      expect(parsed.parameters.aisleId).toBe('aisle-2');
      expect(parsed.parameters.aisleName).toContain('Aisle 2');
    });

    it('erects physical barricade only after explicit operator approval', async () => {
      const store = useSimulationStore.getState();
      expect(store.activeBarriers.length).toBe(0);

      await store.sendChatMessage('Block aisle two.');
      const pending = useSimulationStore.getState().pendingCommand;
      expect(pending).not.toBeNull();
      expect(pending?.parameters.aisleId).toBe('aisle-2');

      // Reject first
      store.rejectCommand(pending!.id);
      expect(useSimulationStore.getState().activeBarriers.length).toBe(0);

      // Approve second
      await store.sendChatMessage('Block aisle two.');
      const pending2 = useSimulationStore.getState().pendingCommand;
      store.approveCommand(pending2!.id);

      expect(useSimulationStore.getState().activeBarriers.length).toBe(1);
      expect(useSimulationStore.getState().activeBarriers[0].aisleId).toBe('aisle-2');
    });
  });

  describe('Acceptance Command 3: "Remove the aisle blockage."', () => {
    it('identifies unblock action and clears barricade upon confirmation', async () => {
      const store = useSimulationStore.getState();
      // First place a barrier
      store.blockAisle('aisle-2');
      expect(useSimulationStore.getState().activeBarriers.length).toBe(1);

      const parsed = parseCommandLocally('Remove the aisle blockage.', mockContext);
      expect(parsed.action).toBe('unblock_aisle');
      expect(parsed.requiresApproval).toBe(true);

      await store.sendChatMessage('Remove the aisle blockage.');
      const pending = useSimulationStore.getState().pendingCommand;
      expect(pending).not.toBeNull();

      store.approveCommand(pending!.id);
      expect(useSimulationStore.getState().activeBarriers.length).toBe(0);
    });
  });

  describe('Acceptance Commands 4 & 5: "Pause the simulation." and "Resume the simulation."', () => {
    it('immediately pauses simulation clock without requiring intermediate approval', async () => {
      const store = useSimulationStore.getState();
      expect(store.isRunning).toBe(true);

      const parsedPause = parseCommandLocally('Pause the simulation.', mockContext);
      expect(parsedPause.action).toBe('set_simulation_state');
      expect(parsedPause.parameters.simulationRunning).toBe(false);
      expect(parsedPause.requiresApproval).toBe(false);

      await store.sendChatMessage('Pause the simulation.');
      expect(useSimulationStore.getState().isRunning).toBe(false);
    });

    it('immediately resumes simulation clock', async () => {
      const store = useSimulationStore.getState();
      useSimulationStore.setState({ isRunning: false });
      expect(useSimulationStore.getState().isRunning).toBe(false);

      const parsedResume = parseCommandLocally('Resume the simulation.', mockContext);
      expect(parsedResume.action).toBe('set_simulation_state');
      expect(parsedResume.parameters.simulationRunning).toBe(true);
      expect(parsedResume.requiresApproval).toBe(false);

      await store.sendChatMessage('Resume the simulation.');
      expect(useSimulationStore.getState().isRunning).toBe(true);
    });
  });

  describe('Acceptance Command 6: "Explain why the robot stopped."', () => {
    it('diagnoses stoppage reason using real-time telemetry without inventing facts', async () => {
      // Simulate robot stopped in front of obstacle
      const obstacleContext: CommandParseContext = {
        ...mockContext,
        isRunning: true,
        navState: 'AVOIDING',
        sensorData: {
          forwardDist: 0.82,
          leftDist: 1.8,
          rightDist: 1.8,
          riskLevel: 'critical',
          closestObstacle: 'User Cargo Box',
          obstaclePosition: [-14.5, -8.0],
        },
        diagnostics: {
          ...mockContext.diagnostics,
          obstaclePosition: [-14.5, -8.0],
          obstacleName: 'User Cargo Box',
          stoppingDistance: 0.52,
          availableClearance: 0.82,
          brakingStatus: 'emergency_braking',
          routeValidity: 'blocked',
          replanReason: 'Emergency brake: Obstacle at 0.8m',
        },
      };

      const parsed = parseCommandLocally('Explain why the robot stopped.', obstacleContext);
      expect(parsed.action).toBe('query_explanation');
      expect(parsed.requiresApproval).toBe(false);

      // Verify explanation in store
      useSimulationStore.setState({
        navState: 'AVOIDING',
        sensorData: obstacleContext.sensorData,
        diagnostics: obstacleContext.diagnostics,
      });

      await useSimulationStore.getState().sendChatMessage('Explain why the robot stopped.');
      const messages = useSimulationStore.getState().chatMessages;
      const lastAiMessage = messages[messages.length - 1];

      expect(lastAiMessage.sender).toBe('ai');
      expect(lastAiMessage.text).toContain('User Cargo Box');
      expect(lastAiMessage.text).toContain('0.82m');
      expect(lastAiMessage.text).toContain('CRITICAL');
      expect(lastAiMessage.text).toContain('Emergency braking engaged');
    });

    it('correctly reports when stopped due to operator pause or E-Stop', async () => {
      useSimulationStore.setState({ isRunning: false });
      await useSimulationStore.getState().sendChatMessage('Explain why the robot stopped.');

      const messages = useSimulationStore.getState().chatMessages;
      const lastAiMessage = messages[messages.length - 1];
      expect(lastAiMessage.text).toContain('PAUSED');
    });
  });

  describe('Additional Commands: Moving Workers, Extreme Difficulty & Event Log', () => {
    it('handles "Create a crowded warehouse with five moving workers."', async () => {
      const store = useSimulationStore.getState();
      expect(store.interactiveObjects.length).toBe(0);

      const parsed = parseCommandLocally('Create a crowded warehouse with five moving workers.', mockContext);
      expect(parsed.action).toBe('spawn_workers');
      expect(parsed.parameters.count).toBe(5);
      expect(parsed.requiresApproval).toBe(true);

      await store.sendChatMessage('Create a crowded warehouse with five moving workers.');
      const pending = useSimulationStore.getState().pendingCommand;
      store.approveCommand(pending!.id);

      const objects = useSimulationStore.getState().interactiveObjects;
      expect(objects.length).toBe(5);
      expect(objects.every((o) => o.type === 'worker')).toBe(true);
      expect(objects.every((o) => o.patrolStart && o.patrolEnd)).toBe(true);
    });

    it('handles "Make the simulation extremely difficult."', async () => {
      const store = useSimulationStore.getState();

      const parsed = parseCommandLocally('Make the simulation extremely difficult.', mockContext);
      expect(parsed.action).toBe('set_difficulty');
      expect(parsed.parameters.difficulty).toBe('extreme');

      await store.sendChatMessage('Make the simulation extremely difficult.');
      const pending = useSimulationStore.getState().pendingCommand;
      store.approveCommand(pending!.id);

      expect(useSimulationStore.getState().difficulty).toBe('extreme');
      // Extreme difficulty creates 5 workers, 2 crates, and blocks aisle 2
      expect(useSimulationStore.getState().interactiveObjects.length).toBe(7);
      expect(useSimulationStore.getState().activeBarriers.length).toBe(1);
    });

    it('handles "Show me the latest collision and safety events."', async () => {
      useSimulationStore.getState().recordCollision(25.0, 'Pallet Stack');
      await useSimulationStore.getState().sendChatMessage('Show me the latest collision and safety events.');

      const messages = useSimulationStore.getState().chatMessages;
      const lastAiMessage = messages[messages.length - 1];

      expect(lastAiMessage.text).toContain('Physical Collisions Recorded');
      expect(lastAiMessage.text).toContain('1');
    });
  });

  describe('Phase 3: Natural Language Synonyms & Varied Phrasings', () => {
    it('correctly maps difficulty synonyms to set_difficulty(extreme)', () => {
      const phrases = [
        'Make it tough.',
        'Increase the difficulty.',
        'Give the robot a really challenging mission.',
        'Put it in extreme mode.',
        'Make the warehouse extreme.',
      ];

      for (const phrase of phrases) {
        const parsed = parseCommandLocally(phrase, mockContext);
        expect(parsed.action).toBe('set_difficulty');
        expect(parsed.parameters.difficulty).toBe('extreme');
        expect(parsed.requiresApproval).toBe(true);
      }
    });

    it('correctly maps obstacle placement synonyms', () => {
      const phrases = [
        'Put a box in front of the robot.',
        'Drop something three metres ahead.',
        'Create an obstacle in its path.',
      ];

      for (const phrase of phrases) {
        const parsed = parseCommandLocally(phrase, mockContext);
        expect(parsed.action).toBe('spawn_obstacle');
        expect(parsed.parameters.position).toBeDefined();
        expect(parsed.requiresApproval).toBe(true);
      }
    });

    it('correctly maps aisle blocking synonyms', () => {
      const phrases = [
        'Close aisle two.',
        'Make aisle two inaccessible.',
        'Barricade aisle 2.',
        'Block aisle 2.',
      ];

      for (const phrase of phrases) {
        const parsed = parseCommandLocally(phrase, mockContext);
        expect(parsed.action).toBe('block_aisle');
        expect(parsed.parameters.aisleId).toBe('aisle-2');
        expect(parsed.requiresApproval).toBe(true);
      }
    });

    it('correctly maps shortest safe path navigation preference', () => {
      const phrases = [
        'Take the shortest path.',
        'Use the quickest route.',
        'Go through the shortest path.',
      ];

      for (const phrase of phrases) {
        const parsed = parseCommandLocally(phrase, mockContext);
        expect(parsed.action).toBe('start_mission');
        expect(parsed.parameters.navigationPreference).toBe('shortest_safe_path');
      }
    });
  });

  describe('Phase 3: Multi-Intent Commands & Sequential Workflow Orchestration', () => {
    it('parses "Make it tough and take it through the shortest path." into 2 sub-actions', () => {
      const parsed = parseCommandLocally(
        'Make it tough and take it through the shortest path.',
        mockContext
      );

      expect(parsed.isMultiIntent).toBe(true);
      expect(parsed.subActions).toBeDefined();
      expect(parsed.subActions?.length).toBe(2);

      // SubAction 1: Extreme difficulty
      const act1 = parsed.subActions![0];
      expect(act1.action).toBe('set_difficulty');
      expect(act1.parameters.difficulty).toBe('extreme');

      // SubAction 2: Start mission with shortest safe path
      const act2 = parsed.subActions![1];
      expect(act2.action).toBe('start_mission');
      expect(act2.parameters.navigationPreference).toBe('shortest_safe_path');
    });

    it('enforces single combined approval preview and executes sequentially upon approval', async () => {
      const store = useSimulationStore.getState();
      expect(store.difficulty).toBe('normal');
      expect(store.navState).toBe('IDLE');

      await store.sendChatMessage('Make it tough and take it through the shortest path.');

      const pending = useSimulationStore.getState().pendingCommand;
      expect(pending).not.toBeNull();
      expect(pending?.isMultiIntent).toBe(true);
      expect(pending?.subActions?.length).toBe(2);

      // Prior to operator approval: no changes applied
      expect(useSimulationStore.getState().difficulty).toBe('normal');
      expect(useSimulationStore.getState().navState).toBe('IDLE');

      // Operator APPROVES combined workflow
      store.approveCommand(pending!.id);

      // Verify sequential execution results:
      // 1. Difficulty set to extreme (which creates 5 workers, 2 crates, blocks aisle 2)
      expect(useSimulationStore.getState().difficulty).toBe('extreme');
      expect(useSimulationStore.getState().interactiveObjects.length).toBe(7);
      expect(useSimulationStore.getState().activeBarriers.length).toBe(1);

      // 2. Autonomous mission started with shortest_safe_path preference
      expect(useSimulationStore.getState().navigationPreference).toBe('shortest_safe_path');
      expect(useSimulationStore.getState().navState).toBe('PLANNING');

      // Verify chat message execution results
      const msgs = useSimulationStore.getState().chatMessages;
      const lastMsg = msgs[msgs.length - 1];
      expect(lastMsg.status).toBe('approved');
      expect(lastMsg.executionResult?.stepResults?.length).toBe(2);
      expect(lastMsg.executionResult?.stepResults?.[0].success).toBe(true);
      expect(lastMsg.executionResult?.stepResults?.[1].success).toBe(true);
    });

    it('parses and executes three-action composite workflow', async () => {
      const store = useSimulationStore.getState();

      const parsed = parseCommandLocally(
        'Create a crowded warehouse, block aisle two and start the robot.',
        mockContext
      );

      expect(parsed.isMultiIntent).toBe(true);
      expect(parsed.subActions?.length).toBe(3);
      expect(parsed.subActions![0].action).toBe('spawn_workers');
      expect(parsed.subActions![1].action).toBe('block_aisle');
      expect(parsed.subActions![2].action).toBe('start_mission');

      await store.sendChatMessage('Create a crowded warehouse, block aisle two and start the robot.');
      const pending = useSimulationStore.getState().pendingCommand;
      expect(pending?.subActions?.length).toBe(3);

      store.approveCommand(pending!.id);

      expect(useSimulationStore.getState().interactiveObjects.length).toBe(5);
      expect(useSimulationStore.getState().activeBarriers.length).toBe(1);
      expect(useSimulationStore.getState().navState).toBe('PLANNING');
    });
  });

  describe('Phase 3: Contextual References, Follow-up & Ambiguity Handling', () => {
    it('handles follow-up "Add two more" using previous action context', () => {
      const contextWithSpawnHistory: CommandParseContext = {
        ...mockContext,
        lastActionType: 'spawn_workers',
      };

      const parsed = parseCommandLocally('Add two more', contextWithSpawnHistory);
      expect(parsed.action).toBe('spawn_workers');
      expect(parsed.parameters.count).toBe(2);
    });

    it('handles follow-up "Remove that obstacle" targeting the last spawned object', () => {
      const contextWithObstacle: CommandParseContext = {
        ...mockContext,
        lastSpawnedObstacleId: 'box-dynamic-99',
      };

      const parsed = parseCommandLocally('Remove that obstacle', contextWithObstacle);
      expect(parsed.action).toBe('remove_target_obstacle');
      expect(parsed.parameters.targetObstacleId).toBe('box-dynamic-99');
    });

    it('handles follow-up "Try another route" and "Explain what happened"', () => {
      const parsedRoute = parseCommandLocally('Try another route', mockContext);
      expect(parsedRoute.action).toBe('replan_route');

      const parsedExplain = parseCommandLocally('Explain what happened', mockContext);
      expect(parsedExplain.action).toBe('query_explanation');
    });

    it('detects ambiguous command "Block the aisle" and requests clarification without executing', async () => {
      const parsed = parseCommandLocally('Block the aisle', mockContext);
      expect(parsed.action).toBe('clarification_needed');
      expect(parsed.requiresApproval).toBe(false);
      expect(parsed.clarificationQuestion).toContain('Which aisle');

      // Test in store
      const store = useSimulationStore.getState();
      await store.sendChatMessage('Block the aisle');

      // Must NOT require approval
      expect(useSimulationStore.getState().pendingCommand).toBeNull();
      const msgs = useSimulationStore.getState().chatMessages;
      const lastMsg = msgs[msgs.length - 1];
      expect(lastMsg.status).toBe('clarification_needed');
      expect(lastMsg.text).toContain('Which aisle');
    });

    it('detects ambiguous command "Drop something" and requests clarification', () => {
      const parsed = parseCommandLocally('Drop something', mockContext);
      expect(parsed.action).toBe('clarification_needed');
      expect(parsed.clarificationQuestion).toBeDefined();
      expect(parsed.requiresApproval).toBe(false);
    });

    it('rejects coordinates outside warehouse bounds and requests clarification', () => {
      const parsed = parseCommandLocally('Drop an obstacle at coordinates X 50, Z 80', mockContext);
      expect(parsed.action).toBe('clarification_needed');
      expect(parsed.requiresApproval).toBe(false);
      expect(parsed.clarificationQuestion?.toLowerCase()).toContain('outside warehouse boundaries');
    });
  });

  describe('Phase 4: Start, Pause, Resume, Emergency Stop Actual Simulation State Verification', () => {
    it('1. "Start the simulation." directly sets simulation clock running', async () => {
      const store = useSimulationStore.getState();
      useSimulationStore.setState({ isRunning: false });
      expect(useSimulationStore.getState().isRunning).toBe(false);

      await store.sendChatMessage('Start the simulation.');

      // Verify actual simulation state changed immediately without approval
      expect(useSimulationStore.getState().isRunning).toBe(true);
      expect(useSimulationStore.getState().pendingCommand).toBeNull();

      const msgs = useSimulationStore.getState().chatMessages;
      const lastMsg = msgs[msgs.length - 1];
      expect(lastMsg.status).toBe('executed');
      expect(lastMsg.executionResult?.success).toBe(true);
      expect(lastMsg.text).toContain('Simulation Resumed');
    });

    it('2. "Start autonomous navigation." invokes navigation engine and starts mission', async () => {
      const store = useSimulationStore.getState();
      useSimulationStore.setState({ navState: 'IDLE', isRunning: false });

      await store.sendChatMessage('Start autonomous navigation.');

      // Verify actual simulation state: simulation running, mission planning/active
      expect(useSimulationStore.getState().isRunning).toBe(true);
      expect(['PLANNING', 'MOVING']).toContain(useSimulationStore.getState().navState);
      expect(useSimulationStore.getState().missionMetrics.missionStatus).toBe('running');
      expect(useSimulationStore.getState().pendingCommand).toBeNull();

      const msgs = useSimulationStore.getState().chatMessages;
      const lastMsg = msgs[msgs.length - 1];
      expect(lastMsg.status).toBe('executed');
      expect(lastMsg.executionResult?.success).toBe(true);
      expect(lastMsg.text).toContain('Autonomous Navigation Started');
    });

    it('3. "Pause the simulation." pauses simulation clock and freezes movement while preserving route and destination', async () => {
      const store = useSimulationStore.getState();
      // Setup active mission with path and destination
      store.startMission('bay-4');
      store.setPlannedPath([[-14.5, -10.5], [-14.5, 0], [10, 0]]);
      expect(useSimulationStore.getState().isRunning).toBe(true);
      expect(useSimulationStore.getState().selectedDestinationId).toBe('bay-4');
      expect(useSimulationStore.getState().plannedPath.length).toBe(3);

      await store.sendChatMessage('Pause the simulation.');

      // Verify clock paused immediately
      expect(useSimulationStore.getState().isRunning).toBe(false);
      expect(useSimulationStore.getState().pendingCommand).toBeNull();

      // Verify route, destination, and position are preserved
      expect(useSimulationStore.getState().selectedDestinationId).toBe('bay-4');
      expect(useSimulationStore.getState().plannedPath.length).toBe(3);

      const msgs = useSimulationStore.getState().chatMessages;
      const lastMsg = msgs[msgs.length - 1];
      expect(lastMsg.status).toBe('executed');
      expect(lastMsg.executionResult?.success).toBe(true);
      expect(lastMsg.text).toContain('Simulation Paused');
    });

    it('4. "Resume the simulation." restores simulation clock and allows execution to continue', async () => {
      const store = useSimulationStore.getState();
      useSimulationStore.setState({ isRunning: false });
      expect(useSimulationStore.getState().isRunning).toBe(false);

      await store.sendChatMessage('Resume the simulation.');

      // Verify clock restored
      expect(useSimulationStore.getState().isRunning).toBe(true);
      expect(useSimulationStore.getState().pendingCommand).toBeNull();

      const msgs = useSimulationStore.getState().chatMessages;
      const lastMsg = msgs[msgs.length - 1];
      expect(lastMsg.status).toBe('executed');
      expect(lastMsg.executionResult?.success).toBe(true);
    });

    it('5. "Stop immediately." activates the existing emergency-stop mechanism', async () => {
      const store = useSimulationStore.getState();
      useSimulationStore.setState({
        robotStatus: {
          ...store.robotStatus,
          isEmergencyStopped: false,
        },
        navState: 'MOVING',
      });
      expect(useSimulationStore.getState().robotStatus.isEmergencyStopped).toBe(false);

      await store.sendChatMessage('Stop immediately.');

      // Verify emergency-stop engaged immediately
      expect(useSimulationStore.getState().robotStatus.isEmergencyStopped).toBe(true);
      expect(useSimulationStore.getState().navState).toBe('STOPPED');
      expect(useSimulationStore.getState().pendingCommand).toBeNull();

      const msgs = useSimulationStore.getState().chatMessages;
      const lastMsg = msgs[msgs.length - 1];
      expect(lastMsg.status).toBe('executed');
      expect(lastMsg.executionResult?.success).toBe(true);
      expect(lastMsg.text).toContain('EMERGENCY STOP ENGAGED');
    });

    it('6. "Pause the robot." pauses robot navigation while keeping simulation clock active and preserving route', async () => {
      const store = useSimulationStore.getState();
      store.startMission('bay-4');
      store.setPlannedPath([[-14.5, -10.5], [0, 0]]);
      expect(useSimulationStore.getState().isRunning).toBe(true);

      await store.sendChatMessage('Pause the robot.');

      // Verify robot paused, mission status paused, but simulation clock is still running!
      expect(useSimulationStore.getState().navState).toBe('STOPPED');
      expect(useSimulationStore.getState().missionMetrics.missionStatus).toBe('paused');
      expect(useSimulationStore.getState().isRunning).toBe(true);
      expect(useSimulationStore.getState().selectedDestinationId).toBe('bay-4');
      expect(useSimulationStore.getState().plannedPath.length).toBe(2);

      const msgs = useSimulationStore.getState().chatMessages;
      const lastMsg = msgs[msgs.length - 1];
      expect(lastMsg.status).toBe('executed');
      expect(lastMsg.text).toContain('Robot Paused');
    });

    it('7. "Resume the robot." restores navigation along planned route', async () => {
      const store = useSimulationStore.getState();
      store.startMission('bay-4');
      store.pauseMission();
      expect(useSimulationStore.getState().navState).toBe('STOPPED');

      await store.sendChatMessage('Resume the robot.');

      // Verify navigation restored to MOVING
      expect(useSimulationStore.getState().navState).toBe('MOVING');
      expect(useSimulationStore.getState().missionMetrics.missionStatus).toBe('running');
      expect(useSimulationStore.getState().isRunning).toBe(true);

      const msgs = useSimulationStore.getState().chatMessages;
      const lastMsg = msgs[msgs.length - 1];
      expect(lastMsg.status).toBe('executed');
      expect(lastMsg.text).toContain('Navigation Resumed');
    });
  });
});
