import { describe, it, expect, beforeEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import { useSimulationStore } from '../../state/useSimulationStore';
import { AICommandCenterPanel } from '../AICommandCenterPanel';
import { AutonomousLabPanel } from '../AutonomousLabPanel';
import { DiagnosticsPanel } from '../DiagnosticsPanel';
import { RobotHUD } from '../RobotHUD';
import { SimControls } from '../SimControls';

describe('UI Layout & AI Command Box Visibility', () => {
  beforeEach(() => {
    useSimulationStore.setState({
      mode: 'ai_command',
      isRunning: true,
      timeScale: 1.0,
      currentTime: 12.5,
      cameraView: 'follow',
      backendStatus: 'connected',
      backendInfo: {
        service: 'RobotRisk AI Backend',
        version: '0.1.0',
        status: 'ok',
        timestamp: new Date().toISOString(),
        active_modes: ['manual', 'autonomous', 'ai_command'],
        capabilities: {
          physics_engine: 'Rapier 3D',
          scenario_validation: true,
          failure_analysis: true,
          deterministic_fallback: true,
          human_in_the_loop_approval: true,
        },
      },
      chatMessages: [
        {
          id: 'msg-1',
          sender: 'user',
          text: 'Place a box three metres ahead of the robot.',
          timestamp: Date.now(),
        },
        {
          id: 'msg-2',
          sender: 'ai',
          text: 'I have prepared a box placement 3.0m ahead.',
          timestamp: Date.now(),
          status: 'pending_approval',
          parsedCommand: {
            id: 'cmd-1',
            rawPrompt: 'Place a box three metres ahead of the robot.',
            action: 'spawn_obstacle',
            confidence: 0.95,
            intent: 'Spawn dynamic obstacle',
            description: 'Spawn crate ahead',
            parameters: { relativeToRobot: { distanceAhead: 3.0 } },
            impactSummary: 'Will introduce a collision hazard',
            proposedChanges: ['Spawn 1 crate at [0, 3]'],
            requiresApproval: true,
          },
        },
      ],
      isAiThinking: false,
      interactiveObjects: [],
      eventLog: ['Simulation initialized'],
      robotPose: {
        position: [0, 0.22, 0],
        rotation: 0,
        linearVelocity: 0,
        angularVelocity: 0,
      },
      robotStatus: {
        battery: 100,
        isEmergencyStopped: false,
        collisionCount: 0,
        lastCollisionForce: 0,
      },
      diagnostics: {
        currentWaypoint: [0, 2],
        currentWaypointIndex: 0,
        totalWaypoints: 4,
        lastMovedTime: 0,
        timeStopped: 0,
        obstaclePosition: null,
        obstacleName: null,
        routeValidity: 'valid',
        replanReason: 'None',
        routeDiffers: false,
        failureExplanation: null,
      },
    });
  });

  it('renders AICommandCenterPanel with pinned input bar and scrollable history', () => {
    const html = renderToString(<AICommandCenterPanel forceMode="ai_command" />);

    // Outer panel must be positioned at top-20 bottom-6 right-6
    expect(html).toContain('data-testid="ai-command-panel"');
    expect(html).toContain('top-20');
    expect(html).toContain('bottom-6');
    expect(html).toContain('right-6');

    // Chat history must have independent scrolling (overflow-y-auto and min-h-0)
    expect(html).toContain('data-testid="ai-chat-history"');
    expect(html).toContain('overflow-y-auto');
    expect(html).toContain('min-h-0');

    // Chat input bar must be pinned to the bottom (shrink-0 sticky bottom-0 z-10)
    expect(html).toContain('data-testid="ai-command-form"');
    expect(html).toContain('shrink-0');
    expect(html).toContain('sticky');
    expect(html).toContain('bottom-0');
    expect(html).toContain('z-10');

    // Input field and send button must be rendered
    expect(html).toContain('data-testid="ai-command-input"');
    expect(html).toContain('data-testid="ai-command-send-button"');
    expect(html).toContain('aria-label="Simulation Command Input"');
    expect(html).toContain('aria-label="Send AI Command"');
  });

  it('does not render AICommandCenterPanel when not in ai_command mode', () => {
    const html = renderToString(<AICommandCenterPanel forceMode="manual" />);
    expect(html).toBe('');
  });

  it('renders AutonomousLabPanel with bounded height and scrollable body', () => {
    const html = renderToString(<AutonomousLabPanel forceMode="autonomous" />);

    expect(html).toContain('data-testid="autonomous-lab-panel"');
    expect(html).toContain('top-20');
    expect(html).toContain('bottom-6');
    expect(html).toContain('right-6');
    expect(html).toContain('max-h-[calc(100vh-6.5rem)]');
    expect(html).toContain('overflow-y-auto');
    expect(html).toContain('AUTONOMOUS LAB');
  });

  it('renders DiagnosticsPanel with Core Telemetry header and stats', () => {
    const html = renderToString(<DiagnosticsPanel />);
    expect(html).toContain('data-testid="core-telemetry-panel"');
    expect(html).toContain('CORE TELEMETRY');
    expect(html).toContain('RAPIER 3D');
  });

  it('renders RobotHUD with AMR Telemetry', () => {
    const html = renderToString(<RobotHUD />);
    expect(html).toContain('data-testid="robot-hud-panel"');
    expect(html).toContain('AMR TELEMETRY');
  });

  it('renders SimControls with responsive wrapping and max-width', () => {
    const html = renderToString(<SimControls />);
    expect(html).toContain('data-testid="sim-controls-panel"');
    expect(html).toContain('max-w-[calc(100vw-30rem)]');
    expect(html).toContain('flex-wrap');
    expect(html).toContain('RESET CAM');
    expect(html).toContain('+ BOX');
    expect(html).toContain('+ SPHERE');
    expect(html).toContain('+ FORKLIFT');
    expect(html).toContain('data-testid="spawn-forklift-btn"');
    expect(html).toContain('BLOCK AISLE');
  });
});
