import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useSimulationStore } from '../../state/useSimulationStore';
import { PREDEFINED_CHALLENGES } from '../../simulation/challenges/challengeLibrary';
import { generateQrSvg } from '../../utils/qrGenerator';
import { multiplayerService } from '../multiplayerService';
import * as api from '../api';

vi.mock('../api', () => ({
  createSessionApi: vi.fn(),
  joinSessionApi: vi.fn(),
  fetchHealthCheck: vi.fn(),
}));

describe('Multiplayer Collaborative Simulation Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSimulationStore.setState({
      isMultiplayerActive: false,
      sessionId: null,
      clientId: null,
      userRole: 'operator',
      connectionStatus: 'disconnected',
      latencyMs: 0,
      participants: [],
      interactiveObjects: [],
      activeBarriers: [],
      difficulty: 'normal',
      eventLog: [],
      robotStatus: {
        battery: 100,
        isEmergencyStopped: false,
        collisionCount: 0,
        lastCollisionForce: 0,
      },
      navState: 'IDLE',
      triggerReplanCounter: 0,
    });
  });

  describe('Session Lifecycle', () => {
    it('creates a multiplayer session as host operator', async () => {
      vi.mocked(api.createSessionApi).mockResolvedValueOnce({
        sessionId: 'RR-TEST1',
        clientId: 'client-host-1',
        role: 'operator',
        hostRole: 'operator',
        joinUrl: 'http://127.0.0.1:5173/?session=RR-TEST1',
      });

      const spyConnect = vi.spyOn(multiplayerService, 'connect').mockImplementation(() => {});

      const sid = await useSimulationStore.getState().createMultiplayerSession('Test Host', 'operator');
      expect(sid).toBe('RR-TEST1');

      const state = useSimulationStore.getState();
      expect(state.isMultiplayerActive).toBe(true);
      expect(state.sessionId).toBe('RR-TEST1');
      expect(state.clientId).toBe('client-host-1');
      expect(state.userRole).toBe('operator');
      expect(state.participants.length).toBe(1);
      expect(state.participants[0].name).toBe('Test Host');
      expect(spyConnect).toHaveBeenCalled();
    });

    it('joins an existing multiplayer session as scenario controller', async () => {
      vi.mocked(api.joinSessionApi).mockResolvedValueOnce({
        sessionId: 'RR-TEST2',
        clientId: 'client-peer-2',
        role: 'controller',
        participants: [
          { clientId: 'client-host-1', role: 'operator', name: 'Host', isHost: true, connectedAt: 1000 },
          { clientId: 'client-peer-2', role: 'controller', name: 'Controller', isHost: false, connectedAt: 1050 },
        ],
        currentSnapshot: {
          difficulty: 'hard',
          interactive_objects: [{ id: 'snap-1', type: 'cube', position: [1, 0, 1] }],
        },
      });

      const spyConnect = vi.spyOn(multiplayerService, 'connect').mockImplementation(() => {});

      await useSimulationStore.getState().joinMultiplayerSession('RR-TEST2', 'Controller', 'controller');

      const state = useSimulationStore.getState();
      expect(state.isMultiplayerActive).toBe(true);
      expect(state.sessionId).toBe('RR-TEST2');
      expect(state.clientId).toBe('client-peer-2');
      expect(state.userRole).toBe('controller');
      expect(state.participants.length).toBe(2);
      expect(state.difficulty).toBe('hard');
      expect(state.interactiveObjects.length).toBe(1);
      expect(spyConnect).toHaveBeenCalled();
    });

    it('leaves a multiplayer session cleanly', () => {
      useSimulationStore.setState({
        isMultiplayerActive: true,
        sessionId: 'RR-LEAVE',
        clientId: 'client-1',
        userRole: 'controller',
        connectionStatus: 'connected',
        participants: [{ clientId: 'client-1', role: 'controller', name: 'User', isHost: false, connectedAt: 1 }],
      });

      const spyDisconnect = vi.spyOn(multiplayerService, 'disconnect').mockImplementation(() => {});

      useSimulationStore.getState().leaveMultiplayerSession();

      const state = useSimulationStore.getState();
      expect(state.isMultiplayerActive).toBe(false);
      expect(state.sessionId).toBeNull();
      expect(state.clientId).toBeNull();
      expect(state.connectionStatus).toBe('disconnected');
      expect(state.participants).toEqual([]);
      expect(spyDisconnect).toHaveBeenCalled();
    });
  });

  describe('Role-Based Authority & Permissions', () => {
    it('prohibits Scenario Controller from starting an autonomous mission', () => {
      useSimulationStore.setState({
        isMultiplayerActive: true,
        userRole: 'controller',
        navState: 'IDLE',
      });

      useSimulationStore.getState().startMission('bay-4');

      const state = useSimulationStore.getState();
      expect(state.navState).toBe('IDLE'); // Unchanged
      expect(state.eventLog[0]).toContain('Permission Denied');
    });

    it('prohibits Scenario Controller from toggling emergency stop', () => {
      useSimulationStore.setState({
        isMultiplayerActive: true,
        userRole: 'controller',
        robotStatus: {
          battery: 100,
          isEmergencyStopped: false,
          collisionCount: 0,
          lastCollisionForce: 0,
        },
      });

      useSimulationStore.getState().toggleEmergencyStop();

      const state = useSimulationStore.getState();
      expect(state.robotStatus.isEmergencyStopped).toBe(false); // Unchanged
      expect(state.eventLog[0]).toContain('Permission Denied');
    });

    it('allows Robot Operator to execute emergency stop and broadcast over multiplayer', () => {
      const spySend = vi.spyOn(multiplayerService, 'send').mockReturnValue(true);

      useSimulationStore.setState({
        isMultiplayerActive: true,
        userRole: 'operator',
        robotStatus: {
          battery: 100,
          isEmergencyStopped: false,
          collisionCount: 0,
          lastCollisionForce: 0,
        },
      });

      useSimulationStore.getState().toggleEmergencyStop();

      const state = useSimulationStore.getState();
      expect(state.robotStatus.isEmergencyStopped).toBe(true);
      expect(spySend).toHaveBeenCalledWith('emergency_stop', expect.objectContaining({
        isEmergencyStopped: true,
      }));
    });
  });

  describe('Multiplayer Message Handling', () => {
    it('handles sim_telemetry by updating state on controller device', () => {
      useSimulationStore.setState({
        isMultiplayerActive: true,
        userRole: 'controller',
      });

      const incomingTelemetry = {
        robotPose: {
          position: [3.5, 0.22, 4.8] as [number, number, number],
          rotation: 1.57,
          linearVelocity: 1.8,
          angularVelocity: 0.1,
        },
        navState: 'MOVING' as const,
        currentTime: 24.5,
        plannedPath: [[0, 0], [3, 4]] as Array<[number, number]>,
      };

      useSimulationStore.getState().handleMultiplayerMessage({
        type: 'sim_telemetry',
        sessionId: 'RR-TEST',
        clientId: 'host',
        role: 'operator',
        timestamp: Date.now(),
        payload: incomingTelemetry,
      });

      const state = useSimulationStore.getState();
      expect(state.robotPose.position).toEqual([3.5, 0.22, 4.8]);
      expect(state.navState).toBe('MOVING');
      expect(state.currentTime).toBe(24.5);
      expect(state.plannedPath).toEqual([[0, 0], [3, 4]]);
    });

    it('handles peer spawn_object message and increments replan counter', () => {
      const initialReplan = useSimulationStore.getState().triggerReplanCounter;

      useSimulationStore.getState().handleMultiplayerMessage({
        type: 'spawn_object',
        sessionId: 'RR-TEST',
        clientId: 'peer-controller',
        role: 'controller',
        timestamp: Date.now(),
        payload: {
          object: {
            id: 'peer-box-1',
            type: 'cube',
            position: [2.0, 0.4, 3.0],
            color: '#ff3366',
            size: 0.75,
            rotation: 0,
            name: 'Cargo Box',
          },
        },
      });

      const state = useSimulationStore.getState();
      expect(state.interactiveObjects.length).toBe(1);
      expect(state.interactiveObjects[0].id).toBe('peer-box-1');
      expect(state.triggerReplanCounter).toBe(initialReplan + 1);
    });

    it('handles peer block_aisle message by creating barrier', () => {
      useSimulationStore.getState().handleMultiplayerMessage({
        type: 'block_aisle',
        sessionId: 'RR-TEST',
        clientId: 'peer-controller',
        role: 'controller',
        timestamp: Date.now(),
        payload: {
          aisleId: 'aisle-2',
        },
      });

      const state = useSimulationStore.getState();
      expect(state.activeBarriers.length).toBe(1);
      expect(state.activeBarriers[0].aisleId).toBe('aisle-2');
    });

    it('handles peer remove_barrier message', () => {
      useSimulationStore.setState({
        activeBarriers: [
          {
            id: 'barrier-1',
            aisleId: 'aisle-2',
            name: 'Aisle 2',
            position: [0, 0, 0],
            width: 3,
            depth: 0.6,
            height: 1.5,
            rotation: 0,
          },
        ],
      });

      useSimulationStore.getState().handleMultiplayerMessage({
        type: 'remove_barrier',
        sessionId: 'RR-TEST',
        clientId: 'peer-controller',
        role: 'controller',
        timestamp: Date.now(),
        payload: {
          barrierId: 'barrier-1',
        },
      });

      const state = useSimulationStore.getState();
      expect(state.activeBarriers.length).toBe(0);
    });
  });

  describe('Predefined Challenge Library (9 Hazards)', () => {
    it('contains all 9 required predefined challenge profiles', () => {
      expect(PREDEFINED_CHALLENGES.length).toBe(9);

      const challengeIds = PREDEFINED_CHALLENGES.map((c) => c.id);
      expect(challengeIds).toContain('sudden_pedestrian_crossing');
      expect(challengeIds).toContain('falling_box');
      expect(challengeIds).toContain('blocked_aisle');
      expect(challengeIds).toContain('multiple_moving_workers');
      expect(challengeIds).toContain('unexpected_trolley');
      expect(challengeIds).toContain('multiple_simultaneous_hazards');
      expect(challengeIds).toContain('impossible_mission_normal');
      expect(challengeIds).toContain('impossible_mission_hard');
      expect(challengeIds).toContain('impossible_mission_extreme');
    });

    it('executes sudden pedestrian crossing challenge', () => {
      useSimulationStore.getState().executeChallengeLocally('sudden_pedestrian_crossing');
      const state = useSimulationStore.getState();
      expect(state.interactiveObjects.length).toBe(1);
      expect(state.interactiveObjects[0].type).toBe('worker');
    });

    it('executes falling cargo box challenge in robot path', () => {
      useSimulationStore.getState().executeChallengeLocally('falling_box');
      const state = useSimulationStore.getState();
      expect(state.interactiveObjects.length).toBe(1);
      expect(state.interactiveObjects[0].type).toBe('cube');
    });

    it('executes blocked aisle 2 challenge', () => {
      useSimulationStore.getState().executeChallengeLocally('blocked_aisle');
      const state = useSimulationStore.getState();
      expect(state.activeBarriers.length).toBe(1);
      expect(state.activeBarriers[0].aisleId).toBe('aisle-2');
    });

    it('executes multiple simultaneous hazards catastrophe challenge', () => {
      useSimulationStore.getState().executeChallengeLocally('multiple_simultaneous_hazards');
      const state = useSimulationStore.getState();
      expect(state.activeBarriers.length).toBe(1); // Barricade
      expect(state.interactiveObjects.length).toBe(3); // 1 box + 2 workers
    });

    it('executes impossible mission extreme challenge', () => {
      useSimulationStore.getState().executeChallengeLocally('impossible_mission_extreme');
      const state = useSimulationStore.getState();
      expect(state.difficulty).toBe('extreme');
      expect(state.activeBarriers.length).toBe(1); // Barricade aisle 2
      expect(state.interactiveObjects.length).toBe(7); // 5 workers + 2 crates
    });
  });

  describe('Zero-Dependency SVG QR Code Generator', () => {
    it('generates a valid SVG markup string containing rect elements', () => {
      const testUrl = 'http://127.0.0.1:5173/?session=RR-ABCD&role=controller';
      const svg = generateQrSvg(testUrl, 6);

      expect(typeof svg).toBe('string');
      expect(svg).toContain('<svg');
      expect(svg).toContain('</svg>');
      expect(svg).toContain('<rect');
      expect(svg).toContain('fill="#00f0ff"');
    });
  });

  describe('Regression: Robust Session Creation & Join string safety (toUpperCase protection)', () => {
    it('creates session safely when backend response has role but no hostRole (exact bug scenario)', async () => {
      // Backend returned role: 'operator', but previously frontend read res.hostRole which was undefined
      vi.mocked(api.createSessionApi).mockResolvedValueOnce({
        sessionId: 'RR-9K2L',
        clientId: 'client-host-real',
        role: 'operator',
        joinUrl: 'http://127.0.0.1:5173/?session=RR-9K2L',
      } as any);

      vi.spyOn(multiplayerService, 'connect').mockImplementation(() => {});

      // This previously crashed with: TypeError: Cannot read properties of undefined (reading 'toUpperCase')
      const sid = await useSimulationStore.getState().createMultiplayerSession('Real Host', 'operator');
      expect(sid).toBe('RR-9K2L');

      const state = useSimulationStore.getState();
      expect(state.userRole).toBe('operator');
      expect(state.sessionId).toBe('RR-9K2L');
      expect(state.eventLog[0]).toContain('[MULTIPLAYER] Created Session RR-9K2L as OPERATOR');
    });

    it('creates session safely when backend response has completely missing role and hostRole', async () => {
      vi.mocked(api.createSessionApi).mockResolvedValueOnce({
        sessionId: 'RR-FALLBK',
        clientId: 'client-fb',
        joinUrl: 'http://127.0.0.1:5173/?session=RR-FALLBK',
      } as any);

      vi.spyOn(multiplayerService, 'connect').mockImplementation(() => {});

      const sid = await useSimulationStore.getState().createMultiplayerSession('Fallback Host', 'operator');
      expect(sid).toBe('RR-FALLBK');

      const state = useSimulationStore.getState();
      expect(state.userRole).toBe('operator');
      expect(state.eventLog[0]).toContain('as OPERATOR');
    });

    it('joins session safely when backend returns sessionInfo.participants instead of root participants', async () => {
      vi.mocked(api.joinSessionApi).mockResolvedValueOnce({
        sessionId: 'RR-9K2L',
        clientId: 'client-ctrl-real',
        role: 'controller',
        wsUrl: '/ws/session/RR-9K2L/client-ctrl-real',
        sessionInfo: {
          sessionId: 'RR-9K2L',
          hostClientId: 'client-host-real',
          createdAt: Date.now(),
          participants: [
            { clientId: 'client-host-real', role: 'operator', name: 'Real Host', isHost: true, connectedAt: 100 },
            { clientId: 'client-ctrl-real', role: 'controller', name: 'Scenario Controller', isHost: false, connectedAt: 105 },
          ],
          isRunning: true,
          difficulty: 'normal',
          activeObstacleCount: 0,
          activeBarrierCount: 0,
        },
      } as any);

      vi.spyOn(multiplayerService, 'connect').mockImplementation(() => {});

      await useSimulationStore.getState().joinMultiplayerSession('RR-9K2L', 'Scenario Controller', 'controller');

      const state = useSimulationStore.getState();
      expect(state.userRole).toBe('controller');
      expect(state.participants.length).toBe(2);
      expect(state.eventLog[0]).toContain('[MULTIPLAYER] Joined Session RR-9K2L as CONTROLLER');
    });

    it('rejects empty or whitespace room code on join without crashing', async () => {
      await expect(useSimulationStore.getState().joinMultiplayerSession('')).rejects.toThrow(
        'Please enter a valid 6-character room code.'
      );
      await expect(useSimulationStore.getState().joinMultiplayerSession('   ')).rejects.toThrow(
        'Please enter a valid 6-character room code.'
      );
    });

    it('handles peer_joined WebSocket packet safely even when joined role is undefined', () => {
      useSimulationStore.setState({
        eventLog: [],
        participants: [],
      });

      // Send peer_joined with malformed participant lacking role
      useSimulationStore.getState().handleMultiplayerMessage({
        type: 'peer_joined',
        sessionId: 'RR-SAFE',
        clientId: 'peer-x',
        role: 'controller',
        timestamp: Date.now(),
        payload: {
          participant: {
            clientId: 'peer-x',
            name: 'Mystery Peer',
          } as any,
        },
      });

      const state = useSimulationStore.getState();
      expect(state.eventLog[0]).toContain('Mystery Peer joined as PEER');
    });

    it('handles session_welcome WebSocket packet and updates userRole and connectionStatus', () => {
      useSimulationStore.setState({
        connectionStatus: 'connecting',
        userRole: 'observer',
      });

      useSimulationStore.getState().handleMultiplayerMessage({
        type: 'session_welcome',
        sessionId: 'RR-WELCOME',
        clientId: 'my-client',
        role: 'operator',
        timestamp: Date.now(),
        payload: {
          participants: [
            { clientId: 'my-client', role: 'operator', name: 'Operator', isHost: true, connectedAt: 100 },
          ],
        },
      });

      const state = useSimulationStore.getState();
      expect(state.connectionStatus).toBe('connected');
      expect(state.userRole).toBe('operator');
      expect(state.participants.length).toBe(1);
    });
  });

  describe('Phase 5.2 Mandatory Collaborative Tests (A through G)', () => {
    it('Test A: verifies incoming telemetry updates Controller pose without wiping local obstacles', () => {
      useSimulationStore.setState({
        isMultiplayerActive: true,
        userRole: 'controller',
        interactiveObjects: [
          {
            id: 'ctrl-box-1',
            type: 'cube',
            position: [2.0, 0.4, 3.0],
            color: '#ff3366',
            size: 0.75,
            name: 'Controller Box',
          },
        ],
      });

      // Host sends live telemetry without any objects in it
      useSimulationStore.getState().handleMultiplayerMessage({
        type: 'sim_telemetry',
        sessionId: 'RR-SYNC',
        clientId: 'host-op',
        role: 'operator',
        timestamp: Date.now(),
        payload: {
          robotPose: {
            position: [-10.0, 0.22, 5.0],
            rotation: 2.1,
            linearVelocity: 1.4,
            angularVelocity: 0.05,
          },
          navState: 'MOVING',
          currentWaypointIndex: 2,
        },
      });

      const state = useSimulationStore.getState();
      expect(state.robotPose.position).toEqual([-10.0, 0.22, 5.0]);
      expect(state.robotPose.rotation).toBe(2.1);
      // Crucial: Controller's obstacle was NOT wiped by incoming telemetry!
      expect(state.interactiveObjects.length).toBe(1);
      expect(state.interactiveObjects[0].id).toBe('ctrl-box-1');
    });

    it('Test B: verifies obstacle spawning and worker spawning broadcast over multiplayer', () => {
      const spySend = vi.spyOn(multiplayerService, 'send').mockReturnValue(true);
      useSimulationStore.setState({
        isMultiplayerActive: true,
        userRole: 'controller',
      });

      // Spawn dynamic crate
      useSimulationStore.getState().spawnInteractiveObject('cube', [1.5, 0.4, 2.5]);
      expect(spySend).toHaveBeenCalledWith('spawn_object', expect.objectContaining({
        object: expect.objectContaining({
          type: 'cube',
          position: [1.5, 0.4, 2.5],
        }),
      }));

      // Spawn moving worker
      useSimulationStore.getState().spawnWorker([0.0, 0.75, 1.0], [0.0, -2.0], [0.0, 2.0], 1.2);
      expect(spySend).toHaveBeenCalledWith('spawn_object', expect.objectContaining({
        object: expect.objectContaining({
          type: 'worker',
          patrolSpeed: 1.2,
        }),
      }));
    });

    it('Test C: verifies Controller triggering challenge broadcasts and synchronizes across session', () => {
      const spySend = vi.spyOn(multiplayerService, 'send').mockReturnValue(true);
      useSimulationStore.setState({
        isMultiplayerActive: true,
        userRole: 'controller',
      });

      useSimulationStore.getState().triggerPredefinedChallenge('falling_box');
      expect(spySend).toHaveBeenCalledWith('trigger_challenge', expect.objectContaining({
        challengeId: 'falling_box',
      }));

      // When server/host responds with challenge_triggered containing the objects:
      useSimulationStore.getState().handleMultiplayerMessage({
        type: 'challenge_triggered',
        sessionId: 'RR-CH',
        clientId: 'server',
        role: 'operator',
        timestamp: Date.now(),
        payload: {
          challengeId: 'falling_box',
          challengeName: 'Falling Payload Box',
          interactiveObjects: [
            {
              id: 'box-ch-1',
              type: 'cube',
              position: [-14.5, 0.4, -7.0],
              name: 'Falling Box',
            },
          ],
        },
      });

      const state = useSimulationStore.getState();
      expect(state.interactiveObjects.length).toBe(1);
      expect(state.interactiveObjects[0].id).toBe('box-ch-1');
    });

    it('Test D: verifies AI Command Center execution synchronizes environmental actions', () => {
      const spySend = vi.spyOn(multiplayerService, 'send').mockReturnValue(true);
      useSimulationStore.setState({
        isMultiplayerActive: true,
        userRole: 'controller',
        activeBarriers: [],
      });

      useSimulationStore.getState().blockAisle('aisle-2');
      expect(spySend).toHaveBeenCalledWith('block_aisle', expect.objectContaining({
        aisleId: 'aisle-2',
      }));

      const state = useSimulationStore.getState();
      expect(state.activeBarriers.length).toBe(1);
      expect(state.activeBarriers[0].aisleId).toBe('aisle-2');
    });

    it('Test E: verifies Controller role prohibits manual teleop, emergency stop, and reset pose', () => {
      useSimulationStore.setState({
        isMultiplayerActive: true,
        userRole: 'controller',
        robotPose: {
          position: [-10, 0.22, 5],
          rotation: 1.0,
          linearVelocity: 0,
          angularVelocity: 0,
        },
      });

      // Attempt reset pose
      useSimulationStore.getState().resetRobotPose();
      expect(useSimulationStore.getState().robotPose.position).toEqual([-10, 0.22, 5]); // Unchanged
      expect(useSimulationStore.getState().eventLog[0]).toMatch(/permission denied/i);

      // Attempt emergency stop
      useSimulationStore.getState().toggleEmergencyStop();
      expect(useSimulationStore.getState().robotStatus.isEmergencyStopped).toBe(false); // Unchanged
      expect(useSimulationStore.getState().eventLog[0]).toMatch(/permission denied/i);
    });

    it('Test F: verifies session_welcome with snapshot restores full collaborative state', () => {
      useSimulationStore.setState({
        interactiveObjects: [],
        activeBarriers: [],
        difficulty: 'normal',
      });

      useSimulationStore.getState().handleMultiplayerMessage({
        type: 'session_welcome',
        sessionId: 'RR-RESTORE',
        clientId: 'reconnect-ctrl',
        role: 'controller',
        timestamp: Date.now(),
        payload: {
          snapshot: {
            difficulty: 'extreme',
            is_running: true,
            robot_pose: {
              position: [4.0, 0.22, -2.0],
              rotation: 0.8,
              linearVelocity: 1.1,
              angularVelocity: 0.0,
            },
            interactive_objects: [
              { id: 'restored-box-1', type: 'cube', position: [0, 0.4, 0], name: 'Restored Box' },
            ],
            active_barriers: [
              { id: 'barrier-2', aisleId: 'aisle-2', name: 'Aisle 2', position: [0, 0.75, 0], width: 3, depth: 0.6, height: 1.5, rotation: 0 },
            ],
          },
        },
      });

      const state = useSimulationStore.getState();
      expect(state.difficulty).toBe('extreme');
      expect(state.robotPose.position).toEqual([4.0, 0.22, -2.0]);
      expect(state.interactiveObjects.length).toBe(1);
      expect(state.interactiveObjects[0].id).toBe('restored-box-1');
      expect(state.activeBarriers.length).toBe(1);
      expect(state.activeBarriers[0].aisleId).toBe('aisle-2');
    });

    it('Test G: verifies simulation clock update synchronization between devices', () => {
      useSimulationStore.setState({
        isRunning: true,
      });

      useSimulationStore.getState().handleMultiplayerMessage({
        type: 'simulation_clock_update',
        sessionId: 'RR-CLOCK',
        clientId: 'peer',
        role: 'controller',
        timestamp: Date.now(),
        payload: {
          isRunning: false,
        },
      });

      expect(useSimulationStore.getState().isRunning).toBe(false);

      useSimulationStore.getState().handleMultiplayerMessage({
        type: 'set_clock_state',
        sessionId: 'RR-CLOCK',
        clientId: 'peer',
        role: 'operator',
        timestamp: Date.now(),
        payload: {
          isRunning: true,
        },
      });

      expect(useSimulationStore.getState().isRunning).toBe(true);
    });
  });

  describe('Phase 5.2 Verification: Live Robot Movement & Interpolation Pipeline', () => {
    it('Test A: Host moves robot forward -> Controller receives updated position', () => {
      useSimulationStore.setState({
        isMultiplayerActive: true,
        userRole: 'controller',
        robotPose: {
          position: [-14.5, 0.22, -10.5],
          rotation: 0.0,
          linearVelocity: 0.0,
          angularVelocity: 0.0,
        },
      });

      // Host moves robot forward along trajectory
      useSimulationStore.getState().handleMultiplayerMessage({
        type: 'sim_telemetry',
        sessionId: 'RR-VERIFY',
        clientId: 'host-operator',
        role: 'operator',
        timestamp: Date.now(),
        payload: {
          robotPose: {
            position: [-12.0, 0.22, -8.0],
            rotation: 0.0,
            linearVelocity: 2.0,
            angularVelocity: 0.0,
          },
          navState: 'MOVING',
          currentWaypointIndex: 1,
        },
      });

      const state = useSimulationStore.getState();
      expect(state.robotPose.position).toEqual([-12.0, 0.22, -8.0]);
      expect(state.robotPose.linearVelocity).toBe(2.0);
      expect(state.navState).toBe('MOVING');
    });

    it('Test B: Host rotates robot -> Controller receives updated rotation', () => {
      useSimulationStore.setState({
        isMultiplayerActive: true,
        userRole: 'controller',
        robotPose: {
          position: [-12.0, 0.22, -8.0],
          rotation: 0.0,
          linearVelocity: 2.0,
          angularVelocity: 0.0,
        },
      });

      // Host turns robot to angle 1.5708 rad (90 deg)
      useSimulationStore.getState().handleMultiplayerMessage({
        type: 'sim_telemetry',
        sessionId: 'RR-VERIFY',
        clientId: 'host-operator',
        role: 'operator',
        timestamp: Date.now(),
        payload: {
          robotPose: {
            position: [-12.0, 0.22, -8.0],
            rotation: 1.5708,
            linearVelocity: 0.5,
            angularVelocity: 1.2,
          },
          navState: 'MOVING',
        },
      });

      const state = useSimulationStore.getState();
      expect(state.robotPose.rotation).toBeCloseTo(1.5708, 3);
      expect(state.robotPose.angularVelocity).toBe(1.2);
    });

    it('Test C: Host stops -> Controller sees robot stop', () => {
      useSimulationStore.setState({
        isMultiplayerActive: true,
        userRole: 'controller',
        robotPose: {
          position: [-10.0, 0.22, -5.0],
          rotation: 1.5708,
          linearVelocity: 2.0,
          angularVelocity: 0.5,
        },
        navState: 'MOVING',
      });

      // Host stops robot (0 velocity, IDLE state)
      useSimulationStore.getState().handleMultiplayerMessage({
        type: 'sim_telemetry',
        sessionId: 'RR-VERIFY',
        clientId: 'host-operator',
        role: 'operator',
        timestamp: Date.now(),
        payload: {
          robotPose: {
            position: [-10.0, 0.22, -5.0],
            rotation: 1.5708,
            linearVelocity: 0.0,
            angularVelocity: 0.0,
          },
          navState: 'IDLE',
        },
      });

      const state = useSimulationStore.getState();
      expect(state.robotPose.linearVelocity).toBe(0.0);
      expect(state.robotPose.angularVelocity).toBe(0.0);
      expect(state.navState).toBe('IDLE');
    });

    it('Test D: Controller cannot send unauthorized robot movement commands', () => {
      const initialPos: [number, number, number] = [-10.0, 0.22, -5.0];
      useSimulationStore.setState({
        isMultiplayerActive: true,
        userRole: 'controller',
        robotPose: {
          position: initialPos,
          rotation: 0.0,
          linearVelocity: 0.0,
          angularVelocity: 0.0,
        },
        robotStatus: {
          battery: 100,
          isEmergencyStopped: false,
          collisionCount: 0,
          lastCollisionForce: 0,
        },
      });

      // Attempt Reset Pose
      useSimulationStore.getState().resetRobotPose();
      expect(useSimulationStore.getState().robotPose.position).toEqual(initialPos);
      expect(useSimulationStore.getState().eventLog[0]).toMatch(/permission denied/i);

      // Attempt Emergency Stop toggle
      useSimulationStore.getState().toggleEmergencyStop();
      expect(useSimulationStore.getState().robotStatus.isEmergencyStopped).toBe(false);
      expect(useSimulationStore.getState().eventLog[0]).toMatch(/permission denied/i);

      // Attempt Emergency Stop direct set
      useSimulationStore.getState().setEmergencyStop(true);
      expect(useSimulationStore.getState().robotStatus.isEmergencyStopped).toBe(false);
      expect(useSimulationStore.getState().eventLog[0]).toMatch(/permission denied/i);
    });

    it('Test E: Obstacle injection still works during robot movement', () => {
      const spySend = vi.spyOn(multiplayerService, 'send').mockReturnValue(true);
      useSimulationStore.setState({
        isMultiplayerActive: true,
        userRole: 'controller',
        interactiveObjects: [],
        robotPose: {
          position: [-12.0, 0.22, -8.0],
          rotation: 0.0,
          linearVelocity: 1.5,
          angularVelocity: 0.0,
        },
      });

      // Controller injects dynamic crate
      useSimulationStore.getState().spawnInteractiveObject('cube', [-5.0, 0.4, 2.0]);
      expect(spySend).toHaveBeenCalledWith('spawn_object', expect.objectContaining({
        object: expect.objectContaining({
          type: 'cube',
          position: [-5.0, 0.4, 2.0],
        }),
      }));
      expect(useSimulationStore.getState().interactiveObjects.length).toBe(1);

      // Host continues streaming movement telemetry while robot moves
      useSimulationStore.getState().handleMultiplayerMessage({
        type: 'sim_telemetry',
        sessionId: 'RR-VERIFY',
        clientId: 'host-operator',
        role: 'operator',
        timestamp: Date.now(),
        payload: {
          robotPose: {
            position: [-10.5, 0.22, -6.5],
            rotation: 0.1,
            linearVelocity: 1.8,
            angularVelocity: 0.02,
          },
          navState: 'MOVING',
        },
      });

      const state = useSimulationStore.getState();
      expect(state.robotPose.position).toEqual([-10.5, 0.22, -6.5]);
      // Controller's dynamic obstacle is preserved and not erased
      expect(state.interactiveObjects.length).toBe(1);
      expect(state.interactiveObjects[0].position).toEqual([-5.0, 0.4, 2.0]);
    });

    it('Test F: Reconnection restores latest robot position', () => {
      useSimulationStore.setState({
        isMultiplayerActive: false,
        robotPose: {
          position: [-14.5, 0.22, -10.5],
          rotation: 0.0,
          linearVelocity: 0.0,
          angularVelocity: 0.0,
        },
        interactiveObjects: [],
      });

      // Controller joins or reconnects to session and receives full authoritative snapshot
      useSimulationStore.getState().handleMultiplayerMessage({
        type: 'session_welcome',
        sessionId: 'RR-RECONN',
        clientId: 'client-reconn',
        role: 'controller',
        timestamp: Date.now(),
        payload: {
          sessionInfo: {
            sessionId: 'RR-RECONN',
            hostClientId: 'host-1',
            createdAt: Date.now(),
            participants: [],
            isRunning: true,
            difficulty: 'hard',
            activeObstacleCount: 2,
            activeBarrierCount: 0,
          },
          snapshot: {
            difficulty: 'hard',
            is_running: true,
            robot_pose: {
              position: [5.5, 0.22, 2.3],
              rotation: 3.1415,
              linearVelocity: 1.5,
              angularVelocity: 0.0,
            },
            interactive_objects: [
              { id: 'reconn-box-1', type: 'cube', position: [2.0, 0.4, 1.0], color: '#ff3366', size: 0.75, name: 'Active Box' },
            ],
            active_barriers: [],
          },
        },
      });

      const state = useSimulationStore.getState();
      expect(state.robotPose.position).toEqual([5.5, 0.22, 2.3]);
      expect(state.robotPose.rotation).toBeCloseTo(3.1415, 3);
      expect(state.robotPose.linearVelocity).toBe(1.5);
      expect(state.interactiveObjects.length).toBe(1);
      expect(state.interactiveObjects[0].id).toBe('reconn-box-1');
      expect(state.difficulty).toBe('hard');
    });
  });
});
