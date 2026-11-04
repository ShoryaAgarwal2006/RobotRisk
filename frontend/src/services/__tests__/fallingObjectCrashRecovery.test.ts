import { describe, it, expect, beforeEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { useSimulationStore } from '../../state/useSimulationStore';
import { flightRecorderService } from '../flightRecorder';
import { CollisionRecoveryModal } from '../../components/CollisionRecoveryModal';
import { AutonomousLabPanel } from '../../components/AutonomousLabPanel';

describe('Adversarial Scenario: Falling Object Crash & Restart Flow', () => {
  beforeEach(() => {
    flightRecorderService.clearAllSessions();

    useSimulationStore.setState({
      mode: 'autonomous',
      isRunning: true,
      difficulty: 'extreme',
      needsResetPose: false,
      targetResetPos: [-14.5, 0.22, -10.5],
      targetResetRot: 0,
      robotPose: {
        position: [-10.0, 0.22, -10.5],
        rotation: 0,
        linearVelocity: 2.5,
        angularVelocity: 0.1,
      },
      navState: 'MOVING',
      missionMetrics: {
        missionStatus: 'running',
        missionTime: 4.5,
        distanceTravelled: 4.5,
        obstaclesDetected: 0,
        replanCount: 0,
        timeStopped: 0,
        collisions: 0,
        nearMisses: 0,
      },
      fallingPalletHazard: {
        isActive: true,
        palletId: 'falling-pallet-1',
        palletPosition: [-8.5, 3.6, -10.5],
        palletSize: [1.2, 0.25, 1.2],
        triggerDistance: 3.0,
        isDropped: true,
        dropTime: 3.8,
        impactTime: null,
        hasImpacted: false,
        impactImpulse: null,
      },
      crashState: {
        hasCrashed: false,
        showConfirmationModal: false,
        incidentDetails: null,
      },
      isRecordingFlightData: true,
    });

    flightRecorderService.startRecording(0.0, true, 'operator', 'VERTICAL-CRASH-TEST');
  });

  // 1. Actual falling-object collision activates crash state
  it('1. Actual falling-object collision activates crash state', () => {
    const store = useSimulationStore.getState();
    const impactForce = 2150.0;

    // Simulate Rapier collision callback from falling pallet
    store.recordFallingPalletImpact(impactForce);

    const updated = useSimulationStore.getState();
    expect(updated.crashState.hasCrashed).toBe(true);
    expect(updated.crashState.showConfirmationModal).toBe(true);
    expect(updated.crashState.incidentDetails).not.toBeNull();
    expect(updated.crashState.incidentDetails?.objectName).toBe('Heavy Overhead Falling Pallet');
    expect(updated.crashState.incidentDetails?.impulse).toBe(impactForce);
    expect(updated.fallingPalletHazard.hasImpacted).toBe(true);
    expect(updated.fallingPalletHazard.impactImpulse).toBe(impactForce);
  });

  // 2. Crash pauses robot movement and autonomous navigation
  it('2. Crash pauses robot movement and autonomous navigation without teleporting robot', () => {
    const store = useSimulationStore.getState();
    const preImpactPos = [...store.robotPose.position];

    store.recordFallingPalletImpact(1850.0);

    const updated = useSimulationStore.getState();
    expect(updated.isRunning).toBe(false); // Simulation paused
    expect(updated.robotPose.linearVelocity).toBe(0); // Movement stopped
    expect(updated.robotPose.angularVelocity).toBe(0);
    expect(updated.navState).toBe('STOPPED'); // Navigation halted
    expect(updated.missionMetrics.missionStatus).toBe('failed');
    // Verify robot was NOT automatically teleported to start
    expect(updated.needsResetPose).toBe(false);
    expect(updated.robotPose.position).toEqual(preImpactPos);
  });

  // 3. Confirmation popup appears only once (duplicate collision suppression)
  it('3. Confirmation popup appears only once despite multiple contact callbacks', () => {
    const store = useSimulationStore.getState();

    // Trigger initial impact
    store.recordFallingPalletImpact(2000.0);
    expect(useSimulationStore.getState().crashState.showConfirmationModal).toBe(true);

    // Immediate duplicate contact events (e.g. bouncing collider frames)
    store.recordFallingPalletImpact(2200.0);
    store.recordCollision(2200.0, 'Heavy-Overhead-Cargo-Pallet');

    const updated = useSimulationStore.getState();
    expect(updated.crashState.showConfirmationModal).toBe(true);
    expect(updated.missionMetrics.collisions).toBe(1); // Not duplicated
  });

  // 4. Restart Mission resets robot and falling object to their initial states
  it('4. Restart Mission resets robot and falling object to their initial states', () => {
    const store = useSimulationStore.getState();
    store.recordFallingPalletImpact(2400.0);

    // User chooses "Restart Mission"
    store.restartMissionAfterCrash();

    const updated = useSimulationStore.getState();
    // Robot reset to base
    expect(updated.needsResetPose).toBe(true);
    expect(updated.targetResetPos).toEqual([-14.5, 0.22, -10.5]);
    expect(updated.robotPose.position).toEqual([-14.5, 0.22, -10.5]);
    expect(updated.robotPose.rotation).toBe(0);

    // Pallet restored to overhead suspended position
    expect(updated.fallingPalletHazard.isDropped).toBe(false);
    expect(updated.fallingPalletHazard.hasImpacted).toBe(false);
    expect(updated.fallingPalletHazard.palletPosition).toEqual([-8.5, 3.6, -10.5]);
    expect(updated.fallingPalletHazard.dropTime).toBeNull();
    expect(updated.fallingPalletHazard.impactTime).toBeNull();

    // Crash state cleared & fresh mission running
    expect(updated.crashState.hasCrashed).toBe(false);
    expect(updated.crashState.showConfirmationModal).toBe(false);
    expect(updated.crashState.incidentDetails).toBeNull();
    expect(updated.isRunning).toBe(true);
    expect(updated.selectedDestinationId).toBe('bay-4');
  });

  // 5. Continue Without Restart preserves the impact scene and keeps simulation paused
  it('5. Continue Without Restart preserves the impact scene and keeps simulation paused', () => {
    const store = useSimulationStore.getState();
    const impactPosition = [-9.2, 0.22, -10.5] as [number, number, number];
    useSimulationStore.setState({
      robotPose: {
        position: impactPosition,
        rotation: 0.05,
        linearVelocity: 1.5,
        angularVelocity: 0,
      },
    });

    store.recordFallingPalletImpact(2050.0);

    // User chooses "Continue Without Restart"
    store.continueWithoutRestart();

    const updated = useSimulationStore.getState();
    // Modal closed but crash state retained
    expect(updated.crashState.showConfirmationModal).toBe(false);
    expect(updated.crashState.hasCrashed).toBe(true);

    // Simulation remains strictly paused
    expect(updated.isRunning).toBe(false);
    expect(updated.navState).toBe('STOPPED');

    // Robot and pallet remain at actual crash coordinates (not reset or deleted)
    expect(updated.needsResetPose).toBe(false);
    expect(updated.robotPose.position).toEqual(impactPosition);
    expect(updated.fallingPalletHazard.hasImpacted).toBe(true);
    expect(updated.fallingPalletHazard.isDropped).toBe(true);
  });

  // 6. Right-panel Restart Mission button works after choosing Continue Without Restart
  it('6. Right-panel Restart Mission button works after choosing Continue Without Restart', () => {
    const store = useSimulationStore.getState();
    store.recordFallingPalletImpact(1900.0);

    // User closed popup with Continue Without Restart
    store.continueWithoutRestart();
    expect(useSimulationStore.getState().crashState.hasCrashed).toBe(true);

    // User inspects scene, then clicks RESTART MISSION in the right-side control panel
    store.restartMissionAfterCrash();

    const updated = useSimulationStore.getState();
    expect(updated.needsResetPose).toBe(true);
    expect(updated.targetResetPos).toEqual([-14.5, 0.22, -10.5]);
    expect(updated.fallingPalletHazard.isDropped).toBe(false);
    expect(updated.fallingPalletHazard.hasImpacted).toBe(false);
    expect(updated.crashState.hasCrashed).toBe(false);
    expect(updated.isRunning).toBe(true);
  });

  // 7. Flight Recorder retains the original collision incident after restart
  it('7. Flight Recorder retains the original collision incident after restart', () => {
    const store = useSimulationStore.getState();
    store.recordFallingPalletImpact(2300.0);

    const preRestartIncidents = flightRecorderService.getCurrentSession()?.incidents || [];
    expect(preRestartIncidents.length).toBeGreaterThan(0);
    const collisionIncident = preRestartIncidents.find((inc) => inc.type === 'COLLISION');
    expect(collisionIncident).toBeDefined();

    // Perform Restart Mission
    store.restartMissionAfterCrash();

    // Verify incident is not erased
    const postRestartIncidents = flightRecorderService.getCurrentSession()?.incidents || [];
    const preservedCollision = postRestartIncidents.find((inc) => inc.type === 'COLLISION');
    expect(preservedCollision).toBeDefined();
    expect(preservedCollision?.description).toContain('Heavy Overhead Falling Pallet');
  });

  // 8. Normal near-misses do not activate crash state
  it('8. Normal near-misses do not activate crash state', () => {
    const store = useSimulationStore.getState();

    // Trigger ordinary near-miss
    store.incrementNearMiss('Pedestrian near-miss in Aisle 2');

    const updated = useSimulationStore.getState();
    expect(updated.crashState.hasCrashed).toBe(false);
    expect(updated.crashState.showConfirmationModal).toBe(false);
    expect(updated.missionMetrics.nearMisses).toBe(1);
    expect(updated.isRunning).toBe(true); // Simulation continues running
  });

  // 9. UI Components Verification: Modal & Right-Side Panel HTML structure
  it('9. UI Components Verification: Modal and Right-Side Panel render correctly', () => {
    // When no crash: Modal returns null, Panel does not show RESTART MISSION
    useSimulationStore.setState({
      mode: 'autonomous',
      crashState: { hasCrashed: false, showConfirmationModal: false, incidentDetails: null },
    });
    const modalBefore = renderToString(React.createElement(CollisionRecoveryModal, { forceShow: false }));
    expect(modalBefore).toBe('');

    const panelBefore = renderToString(React.createElement(AutonomousLabPanel, { forceMode: 'autonomous' }));
    expect(panelBefore).not.toContain('COLLISION HALT ACTIVE');

    // When crash occurs: Modal renders with exact title, message, and action buttons
    useSimulationStore.setState({
      mode: 'autonomous',
      crashState: {
        hasCrashed: true,
        showConfirmationModal: true,
        incidentDetails: {
          objectName: 'Heavy Overhead Falling Pallet',
          impulse: 2450.0,
          time: 5.2,
          position: [-8.5, 0.22, -10.5],
        },
      },
    });

    const modalAfter = renderToString(React.createElement(CollisionRecoveryModal, { forceShow: true }));
    expect(modalAfter).toContain('ROBOT COLLISION DETECTED');
    expect(modalAfter).toContain('A falling object has struck the robot. The mission has been stopped for safety.');
    expect(modalAfter).toContain('Restart Mission');
    expect(modalAfter).toContain('Continue Without Restart');

    // When Continue Without Restart is chosen: Modal hides, but right panel shows persistent RESTART MISSION
    useSimulationStore.setState({
      mode: 'autonomous',
      crashState: {
        hasCrashed: true,
        showConfirmationModal: false,
        incidentDetails: {
          objectName: 'Heavy Overhead Falling Pallet',
          impulse: 2450.0,
          time: 5.2,
          position: [-8.5, 0.22, -10.5],
        },
      },
    });

    const modalDismissed = renderToString(React.createElement(CollisionRecoveryModal, { forceShow: false }));
    expect(modalDismissed).toBe('');

    const panelAfter = renderToString(React.createElement(AutonomousLabPanel, { forceMode: 'autonomous', forceCrashed: true }));
    expect(panelAfter).toContain('COLLISION HALT ACTIVE');
    expect(panelAfter).toContain('RESTART MISSION');
  });
});
