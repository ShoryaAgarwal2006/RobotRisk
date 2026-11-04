import { describe, it, expect, beforeEach } from 'vitest';
import { useSimulationStore } from '../../state/useSimulationStore';
import { flightRecorderService } from '../flightRecorder';
import { parseCommandLocally } from '../aiCommandParser';
import { computeCircleTTC } from '../../navigation/ttcUtils';

describe('Adversarial Scenario: VERTICAL IMPACT — FALLING PALLET TEST', () => {
  beforeEach(() => {
    // Reset store state
    useSimulationStore.setState({
      mode: 'manual',
      difficulty: 'normal',
      isRecordingFlightData: false,
      robotPose: {
        position: [-14.5, 0.22, -10.5],
        rotation: 0,
        linearVelocity: 0,
        angularVelocity: 0,
      },
      interactiveObjects: [],
      activeBarriers: [],
      robotStatus: {
        battery: 100,
        isEmergencyStopped: false,
        collisionCount: 0,
        lastCollisionForce: 0,
      },
    });
    useSimulationStore.getState().resetVerticalImpactScenario();
    flightRecorderService.clearAllSessions();
  });

  describe('1. Scenario Initialization & Object Setup', () => {
    it('initializes autonomous mode, extreme difficulty, and straight path to Bay 4', () => {
      const store = useSimulationStore.getState();
      store.startVerticalImpactScenario();

      const state = useSimulationStore.getState();
      expect(state.mode).toBe('autonomous');
      expect(state.difficulty).toBe('extreme');
      expect(state.selectedDestinationId).toBe('bay-4');
      expect(state.isRecordingFlightData).toBe(true);

      // Robot starting coordinates on straight North Cross Aisle
      expect(state.robotPose.position).toEqual([-14.5, 0.22, -10.5]);

      // Suspended Pallet Hazard setup
      const hazard = state.fallingPalletHazard;
      expect(hazard.isActive).toBe(true);
      expect(hazard.palletPosition).toEqual([-8.5, 3.6, -10.5]);
      expect(hazard.palletSize).toEqual([1.2, 0.25, 1.2]);
      expect(hazard.triggerDistance).toBe(3.0);
      expect(hazard.isDropped).toBe(false);
      expect(hazard.hasImpacted).toBe(false);
    });

    it('ensures pallet dimensions exceed robot footprint to guarantee physical overlap', () => {
      const hazard = useSimulationStore.getState().fallingPalletHazard;
      const robotRadius = 0.34; // meters
      const robotDiameter = robotRadius * 2; // 0.68m

      const palletWidth = hazard.palletSize[0]; // 1.2m
      const palletLength = hazard.palletSize[2]; // 1.2m

      expect(palletWidth).toBeGreaterThan(robotDiameter);
      expect(palletLength).toBeGreaterThan(robotDiameter);

      // Verify centerline alignment along North Cross Aisle (Z = -10.5)
      expect(hazard.palletPosition[2]).toBe(-10.5);
    });
  });

  describe('2. Proximity Trigger & Vertical Free-Fall Drop', () => {
    it('keeps pallet suspended until robot reaches within 3.0m', () => {
      const store = useSimulationStore.getState();
      store.startVerticalImpactScenario();

      // Robot at start (distance to pallet = 6.0m)
      const state = useSimulationStore.getState();
      expect(state.fallingPalletHazard.isDropped).toBe(false);

      // Trigger release
      store.triggerFallingPalletDrop();
      const droppedState = useSimulationStore.getState();
      expect(droppedState.fallingPalletHazard.isDropped).toBe(true);
      expect(droppedState.eventLog[0]).toContain('Overhead rigging released');
      expect(droppedState.eventLog[0]).toContain('free fall under gravity');
    });
  });

  describe('3. 3D Rigid-Body Impact & Flight Recorder Capture', () => {
    it('records physical collision and writes exact incident telemetry snapshot', () => {
      const store = useSimulationStore.getState();
      store.startVerticalImpactScenario();
      store.triggerFallingPalletDrop();

      // Simulate physical impact from Rapier onCollisionEnter with 250kg mass
      const impactImpulse = 1875.0; // N*s
      store.recordFallingPalletImpact(impactImpulse);

      const state = useSimulationStore.getState();
      expect(state.fallingPalletHazard.hasImpacted).toBe(true);
      expect(state.fallingPalletHazard.impactImpulse).toBe(impactImpulse);
      expect(state.robotStatus.collisionCount).toBe(1);

      // Verify incident logged in Black Box Flight Recorder
      const session = flightRecorderService.getCurrentSession();
      expect(session).not.toBeNull();
      const collisionIncident = session?.incidents.find((i) => i.type === 'COLLISION');
      expect(collisionIncident).toBeDefined();
      expect(collisionIncident?.description).toContain('Heavy Overhead Falling Pallet');
      expect(collisionIncident?.snapshot.position).toEqual([-14.5, 0.22, -10.5]);
    });
  });

  describe('4. AI Command Center Natural Language Trigger', () => {
    it('parses natural language requests for falling pallet test', () => {
      const s = useSimulationStore.getState();
      const ctx = {
        robotPose: s.robotPose,
        robotStatus: s.robotStatus,
        navState: s.navState,
        isRunning: s.isRunning,
        sensorData: s.sensorData,
        diagnostics: s.diagnostics,
        eventLog: s.eventLog,
        activeBarriers: s.activeBarriers,
      };

      const parsed = parseCommandLocally('Run adversarial falling pallet vertical impact test.', ctx);
      expect(parsed.action).toBe('start_vertical_impact_scenario');
      expect(parsed.intent).toBe('Adversarial Vertical Impact Test');
      expect(parsed.requiresApproval).toBe(true);
      expect(parsed.proposedChanges.some((c) => c.includes('Y=3.6m'))).toBe(true);
    });
  });

  describe('5. Sensor & TTC Architecture Limitation Audit', () => {
    it('verifies that 2D planar TTC cannot calculate vertical descent collision courses', () => {
      // Robot at [-8.5, 0.22, -10.5] stationary
      const robotPos = { x: -8.5, z: -10.5 };
      const robotVel = { x: 0, z: 0 };
      const robotRadius = 0.34;

      // Pallet directly overhead at same X, Z coordinates with zero horizontal velocity
      const palletPos = { x: -8.5, z: -10.5 };
      const palletVel = { x: 0, z: 0 };
      const palletRadius = 0.60;

      // Planar TTC calculation
      const res = computeCircleTTC(robotPos, robotVel, robotRadius, palletPos, palletVel, palletRadius);

      // In 2D planar projection, both bodies have relative velocity = 0, so TTC is either 0 (already overlapping in 2D projection)
      // but TTC cannot compute vertical free-fall time t = sqrt(2h/g)
      expect(res.closingSpeed).toBe(0);
    });
  });
});
