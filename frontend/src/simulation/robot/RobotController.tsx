import React, { useEffect, useRef, useState, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { RigidBody, CylinderCollider, RapierRigidBody, CollisionEnterPayload } from '@react-three/rapier';
import * as THREE from 'three';
import { useSimulationStore } from '../../state/useSimulationStore';
import { RobotModel } from './RobotModel';
import { GridMap } from '../../navigation/GridMap';
import { AStarFinder } from '../../navigation/AStarFinder';
import { NavigationController } from '../../navigation/NavigationController';
import { performSensorScan, SensorRayHit } from '../../navigation/sensorUtils';
import { TrajectoryPoint } from '../../navigation/LocalTrajectoryPlanner';
import { SensorVisualizer } from './SensorVisualizer';
import { PathVisualizer } from './PathVisualizer';
import { multiplayerService } from '../../services/multiplayerService';

export const RobotController: React.FC = () => {
  const rigidBodyRef = useRef<RapierRigidBody>(null);

  // Zustand State & Actions
  const mode = useSimulationStore((s) => s.mode);
  const isRunning = useSimulationStore((s) => s.isRunning);
  const currentTime = useSimulationStore((s) => s.currentTime);
  const robotConfig = useSimulationStore((s) => s.robotConfig);
  const robotStatus = useSimulationStore((s) => s.robotStatus);
  const robotPose = useSimulationStore((s) => s.robotPose);
  const needsResetPose = useSimulationStore((s) => s.needsResetPose);
  const targetResetPos = useSimulationStore((s) => s.targetResetPos);
  const targetResetRot = useSimulationStore((s) => s.targetResetRot);
  const poseResetEpoch = useSimulationStore((s) => s.poseResetEpoch);
  const acknowledgeResetPose = useSimulationStore((s) => s.acknowledgeResetPose);
  const updateRobotPose = useSimulationStore((s) => s.updateRobotPose);
  const recordCollision = useSimulationStore((s) => s.recordCollision);
  const toggleEmergencyStop = useSimulationStore((s) => s.toggleEmergencyStop);

  // Collaborative Multiplayer State
  const isMultiplayerActive = useSimulationStore((s) => s.isMultiplayerActive);
  const userRole = useSimulationStore((s) => s.userRole);
  const lastTelemetrySend = useRef<number>(0);

  // Autonomous Navigation State
  const navState = useSimulationStore((s) => s.navState);
  const plannedPath = useSimulationStore((s) => s.plannedPath);
  const currentWaypointIndex = useSimulationStore((s) => s.currentWaypointIndex);
  const selectedDestinationId = useSimulationStore((s) => s.selectedDestinationId);
  const destinations = useSimulationStore((s) => s.destinations);
  const actualTrajectory = useSimulationStore((s) => s.actualTrajectory);
  const triggerReplanCounter = useSimulationStore((s) => s.triggerReplanCounter);
  const interactiveObjects = useSimulationStore((s) => s.interactiveObjects);
  const activeBarriers = useSimulationStore((s) => s.activeBarriers);

  const setPlannedPath = useSimulationStore((s) => s.setPlannedPath);
  const updateWaypointIndex = useSimulationStore((s) => s.updateWaypointIndex);
  const updateNavState = useSimulationStore((s) => s.updateNavState);
  const updateSensorData = useSimulationStore((s) => s.updateSensorData);
  const appendTrajectoryPoint = useSimulationStore((s) => s.appendTrajectoryPoint);
  const incrementReplan = useSimulationStore((s) => s.incrementReplan);
  const incrementObstacleDetected = useSimulationStore((s) => s.incrementObstacleDetected);
  const updateDiagnostics = useSimulationStore((s) => s.updateDiagnostics);

  // Navigation Subsystems
  const gridMap = useMemo(() => new GridMap(), []);
  const aStarFinder = useMemo(() => new AStarFinder(gridMap), [gridMap]);
  const navController = useMemo(() => new NavigationController(), []);

  // Sensor rays for visualization
  const [visualRays, setVisualRays] = useState<SensorRayHit[]>([]);
  const [activeLocalTrajectory, setActiveLocalTrajectory] = useState<TrajectoryPoint[]>([]);
  const lastReplanCounterRef = useRef(triggerReplanCounter);

  // Active Velocities
  const currentLinearVel = useRef(0);
  const currentAngularVel = useRef(0);

  // Stall & Progress Tracking
  const lastProgressPose = useRef<[number, number]>([-14.5, -10.5]);
  const lastProgressTime = useRef<number>(0);
  const lastReopenCheckTime = useRef<number>(0);
  const lastCheckedObjCount = useRef<number>(0);
  const lastCheckedBarrierCount = useRef<number>(0);

  // Keyboard input tracking
  const keysPressed = useRef<{ [key: string]: boolean }>({});

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) {
        return;
      }

      // If multiplayer and user is not operator, block driving and emergency stop keys
      if (isMultiplayerActive && userRole !== 'operator') {
        return;
      }

      keysPressed.current[e.key.toLowerCase()] = true;
      keysPressed.current[e.code] = true;

      if (e.code === 'Space') {
        e.preventDefault();
        toggleEmergencyStop();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      keysPressed.current[e.key.toLowerCase()] = false;
      keysPressed.current[e.code] = false;
    };

    const handleBlur = () => {
      keysPressed.current = {};
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, [toggleEmergencyStop]);

  // Handle Collisions with physical obstacles
  const handleCollision = (payload: CollisionEnterPayload) => {
    const otherObj = payload.other.rigidBodyObject;
    const name = otherObj?.name || 'Obstacle';

    const v = Math.abs(currentLinearVel.current);
    const impulse = Math.max(10.0, v * 75.0);

    recordCollision(impulse, name);
  };

  const euler = useRef(new THREE.Euler(0, 0, 0, 'YXZ'));
  const quat = useRef(new THREE.Quaternion());
  const lastObstacleSeen = useRef(false);

  // Remote replica smooth interpolation state
  const replicaPos = useRef(new THREE.Vector3(-14.5, 0.22, -10.5));
  const replicaQuat = useRef(new THREE.Quaternion());
  const replicaInitialized = useRef(false);
  const lastIncomingDiagLog = useRef(0);
  const lastOutgoingDiagLog = useRef(0);

  useFrame((_, delta) => {
    const rb = rigidBodyRef.current;
    if (!rb) return;

    // In multiplayer non-operator role (e.g. Scenario Controller), mirror authoritative pose with smooth LERP/SLERP
    if (isMultiplayerActive && userRole !== 'operator') {
      const storeState = useSimulationStore.getState();
      const currentTargetPose = storeState.robotPose;
      const [px, py, pz] = currentTargetPose.position;
      const targetPos = new THREE.Vector3(px, py, pz);
      const targetQuat = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        currentTargetPose.rotation
      );

      // Snap immediately on first initialization or when jump is large (> 2.5m, e.g. reset/teleport)
      if (!replicaInitialized.current || replicaPos.current.distanceTo(targetPos) > 2.5) {
        replicaPos.current.copy(targetPos);
        replicaQuat.current.copy(targetQuat);
        replicaInitialized.current = true;
      } else {
        // Smooth interpolation eliminating network jitter and stutter
        const lerpFactor = Math.min(1.0, 18.0 * delta);
        replicaPos.current.lerp(targetPos, lerpFactor);
        replicaQuat.current.slerp(targetQuat, lerpFactor);
      }

      // Update kinematic physics body without fighting Rapier contact constraints
      if (typeof rb.setNextKinematicTranslation === 'function') {
        rb.setNextKinematicTranslation(replicaPos.current);
      }
      if (typeof rb.setNextKinematicRotation === 'function') {
        rb.setNextKinematicRotation(replicaQuat.current);
      }
      rb.setTranslation(replicaPos.current, true);
      rb.setRotation(replicaQuat.current, true);

      // Diagnostic Logging for Device B (every 1 second)
      const nowPerf = performance.now();
      if (nowPerf - lastIncomingDiagLog.current >= 1000) {
        lastIncomingDiagLog.current = nowPerf;
        console.log('[MULTI-DIAGNOSTIC][DEVICE B - CONTROLLER] Incoming telemetry:', {
          targetPos: [Number(px.toFixed(2)), Number(py.toFixed(2)), Number(pz.toFixed(2))],
          renderedPos: [
            Number(replicaPos.current.x.toFixed(2)),
            Number(replicaPos.current.y.toFixed(2)),
            Number(replicaPos.current.z.toFixed(2)),
          ],
          rotation: Number(currentTargetPose.rotation.toFixed(3)),
          linearVel: currentTargetPose.linearVelocity,
          timestamp: Date.now(),
        });
      }

      // Mirror velocities for wheel animation and beacon pulse
      currentLinearVel.current = currentTargetPose.linearVelocity ?? 0;
      currentAngularVel.current = currentTargetPose.angularVelocity ?? 0;

      // Synchronize dynamic obstacles & barriers into local replica GridMap
      gridMap.clearDynamicObstacles();
      interactiveObjects.forEach((obj) => {
        gridMap.addDynamicObstacle({
          id: obj.id,
          x: obj.position[0],
          z: obj.position[2],
          radius: (obj.size || 0.6) * 0.65,
        });
      });

      gridMap.clearBarriers();
      activeBarriers.forEach((barrier) => {
        gridMap.addBarrier(barrier);
      });

      // Perform local LiDAR sensor scan for visualization rays on Controller device
      euler.current.setFromQuaternion(replicaQuat.current, 'YXZ');
      const replicaYaw = euler.current.y;
      const replicaWorldPos: [number, number, number] = [
        replicaPos.current.x,
        replicaPos.current.y,
        replicaPos.current.z,
      ];
      const sensorScan = performSensorScan(
        replicaWorldPos,
        replicaYaw,
        gridMap,
        interactiveObjects,
        activeBarriers
      );
      setVisualRays(sensorScan.rays);

      return;
    }

    // 1. Handle Reset Pose signal
    if (needsResetPose) {
      rb.setTranslation({ x: targetResetPos[0], y: targetResetPos[1], z: targetResetPos[2] }, true);
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), targetResetRot);
      rb.setRotation(q, true);
      rb.setLinvel({ x: 0, y: 0, z: 0 }, true);
      rb.setAngvel({ x: 0, y: 0, z: 0 }, true);
      currentLinearVel.current = 0;
      currentAngularVel.current = 0;
      navController.clearPath();
      gridMap.clearTemporaryBlockages();
      lastProgressPose.current = [targetResetPos[0], targetResetPos[2]];
      lastProgressTime.current = currentTime;

      // Extract authoritative Rapier coordinates and acknowledge with epoch
      const actualT = rb.translation();
      const actualR = rb.rotation();
      quat.current.set(actualR.x, actualR.y, actualR.z, actualR.w);
      euler.current.setFromQuaternion(quat.current, 'YXZ');
      const actualYaw = euler.current.y;

      acknowledgeResetPose([actualT.x, actualT.y, actualT.z], actualYaw, poseResetEpoch);
      return;
    }

    // 2. Extract current pose from physics engine
    const t = rb.translation();
    const r = rb.rotation();
    quat.current.set(r.x, r.y, r.z, r.w);
    euler.current.setFromQuaternion(quat.current, 'YXZ');
    const yaw = euler.current.y;
    const robotWorldPos: [number, number, number] = [t.x, t.y, t.z];

    // 3. Synchronize dynamic obstacles & barriers into GridMap
    gridMap.clearDynamicObstacles();
    interactiveObjects.forEach((obj) => {
      gridMap.addDynamicObstacle({
        id: obj.id,
        x: obj.position[0],
        z: obj.position[2],
        radius: (obj.size || 0.6) * 0.65,
      });
    });

    gridMap.clearBarriers();
    activeBarriers.forEach((barrier) => {
      gridMap.addBarrier(barrier);
    });

    // 4. Perform LiDAR Sensor Ray Scan
    const sensorScan = performSensorScan(
      robotWorldPos,
      yaw,
      gridMap,
      interactiveObjects,
      activeBarriers
    );
    setVisualRays(sensorScan.rays);

    updateSensorData({
      forwardDist: sensorScan.forwardDist,
      leftDist: sensorScan.leftDist,
      rightDist: sensorScan.rightDist,
      riskLevel: sensorScan.riskLevel,
      closestObstacle: sensorScan.closestObstacleName,
      obstaclePosition: sensorScan.obstaclePosition,
    });

    // Broadcast live telemetry from host operator at 20 Hz (every 50ms)
    const nowPerf = performance.now();
    if (isMultiplayerActive && userRole === 'operator' && nowPerf - lastTelemetrySend.current >= 50) {
      lastTelemetrySend.current = nowPerf;
      multiplayerService.send('sim_telemetry', {
        robotPose: {
          position: robotWorldPos,
          rotation: yaw,
          linearVelocity: currentLinearVel.current,
          angularVelocity: currentAngularVel.current,
        },
        navState,
        plannedPath,
        currentWaypointIndex,
        sensorData: {
          forwardDist: sensorScan.forwardDist,
          leftDist: sensorScan.leftDist,
          rightDist: sensorScan.rightDist,
          riskLevel: sensorScan.riskLevel,
          closestObstacle: sensorScan.closestObstacleName,
          obstaclePosition: sensorScan.obstaclePosition,
        },
        missionMetrics: useSimulationStore.getState().missionMetrics,
        diagnostics: useSimulationStore.getState().diagnostics,
        currentTime,
        isRunning,
        difficulty: useSimulationStore.getState().difficulty,
      });

      // Diagnostic Logging for Device A (every 1 second)
      if (nowPerf - lastOutgoingDiagLog.current >= 1000) {
        lastOutgoingDiagLog.current = nowPerf;
        console.log('[MULTI-DIAGNOSTIC][DEVICE A - OPERATOR] Outgoing telemetry:', {
          pose: {
            position: [
              Number(robotWorldPos[0].toFixed(2)),
              Number(robotWorldPos[1].toFixed(2)),
              Number(robotWorldPos[2].toFixed(2)),
            ],
            rotation: Number(yaw.toFixed(3)),
            linearVelocity: Number(currentLinearVel.current.toFixed(2)),
            angularVelocity: Number(currentAngularVel.current.toFixed(2)),
          },
          sessionId: multiplayerService.getSessionId(),
          timestamp: Date.now(),
        });
      }
    }

    if (sensorScan.riskLevel !== 'clear') {
      if (!lastObstacleSeen.current) {
        incrementObstacleDetected();
        lastObstacleSeen.current = true;
      }
    } else {
      lastObstacleSeen.current = false;
    }

    // Check if new objects or barriers were placed that invalidate active path
    if (
      interactiveObjects.length !== lastCheckedObjCount.current ||
      activeBarriers.length !== lastCheckedBarrierCount.current
    ) {
      if (interactiveObjects.length < lastCheckedObjCount.current) {
        // Obstacle was removed: Clear temporary blockages so freed corridors reopen
        gridMap.clearTemporaryBlockages();
      }
      lastCheckedObjCount.current = interactiveObjects.length;
      lastCheckedBarrierCount.current = activeBarriers.length;

      if (mode === 'autonomous' && (navState === 'MOVING' || navState === 'AVOIDING')) {
        if (aStarFinder.isPathBlocked(plannedPath)) {
          // Active path was intersected by new obstacle, trigger immediate replan
          incrementReplan('Obstacle placed across active route');
        }
      }
    }

    if (!isRunning) {
      // Simulation paused
      rb.setLinvel({ x: 0, y: 0, z: 0 }, true);
      rb.setAngvel({ x: 0, y: 0, z: 0 }, true);
      updateRobotPose(robotWorldPos, yaw, 0, 0);
      return;
    }

    const isEStopped = robotStatus.isEmergencyStopped || robotStatus.battery <= 0;

    let targetV = 0;
    let targetOmega = 0;
    let isEmergencyBrake = false;

    // --- MODE A: GAME / MANUAL MODE ---
    if (mode === 'manual') {
      if (!isEStopped) {
        const keys = keysPressed.current;

        if (keys['w'] || keys['arrowup']) {
          targetV += robotConfig.maxLinearSpeed;
        }
        if (keys['s'] || keys['arrowdown']) {
          targetV -= robotConfig.maxLinearSpeed * 0.6;
        }
        if (keys['a'] || keys['arrowleft']) {
          targetOmega += robotConfig.maxAngularSpeed;
        }
        if (keys['d'] || keys['arrowright']) {
          targetOmega -= robotConfig.maxAngularSpeed;
        }
      }
    }
    // --- MODE B: AUTONOMOUS LAB MODE ---
    else if (mode === 'autonomous') {
      const activeDest =
        destinations.find((d) => d.id === selectedDestinationId) || destinations[0];
      const targetCoord: [number, number] = [
        activeDest.position[0],
        activeDest.position[2],
      ];

      // Handle Route Planning / Replanning trigger
      const replanRequested =
        triggerReplanCounter !== lastReplanCounterRef.current ||
        navState === 'PLANNING';

      if (replanRequested) {
        lastReplanCounterRef.current = triggerReplanCounter;
        const generatedPath = aStarFinder.findPath([t.x, t.z], targetCoord);
        const pathDiff = aStarFinder.pathsDiffer(generatedPath, plannedPath);

        if (generatedPath && generatedPath.length > 0) {
          navController.setPath(generatedPath, targetCoord);
          setPlannedPath(generatedPath);
          updateDiagnostics({
            routeDiffers: pathDiff,
            routeValidity: 'valid',
            failureExplanation: null,
          });
          lastProgressPose.current = [t.x, t.z];
          lastProgressTime.current = currentTime;
        } else {
          navController.clearPath();
          setPlannedPath([]);
          updateNavState('FAILED');
          updateDiagnostics({
            routeDiffers: false,
            routeValidity: 'blocked',
            failureExplanation: `Destination unreachable: All valid corridors to ${activeDest.name} are obstructed.`,
          });
        }
      }

      if (isEStopped) {
        targetV = 0;
        targetOmega = 0;
        if (navState === 'MOVING') {
          updateNavState('STOPPED');
        }
      } else if (navState === 'FAILED') {
        targetV = 0;
        targetOmega = 0;
        // Automatic Corridor Reopening Check:
        // If an obstacle was removed or worker moved, check if route to destination has reopened
        if (currentTime - lastReopenCheckTime.current > 0.8) {
          lastReopenCheckTime.current = currentTime;
          const recoveredPath = aStarFinder.findPath([t.x, t.z], targetCoord);
          if (recoveredPath && recoveredPath.length > 0) {
            navController.setPath(recoveredPath, targetCoord);
            setPlannedPath(recoveredPath);
            updateNavState('MOVING');
            updateDiagnostics({
              routeValidity: 'valid',
              failureExplanation: null,
            });
            lastProgressPose.current = [t.x, t.z];
            lastProgressTime.current = currentTime;
          }
        }
      } else if (navState === 'MOVING' || navState === 'AVOIDING') {
        // Compute control command from NavigationController with Layer B Local Trajectory Planner
        const navCmd = navController.computeControl(
          robotWorldPos,
          yaw,
          sensorScan,
          robotConfig.maxLinearSpeed,
          robotConfig.maxAngularSpeed,
          currentTime,
          Math.abs(currentLinearVel.current),
          robotConfig.linearAcceleration,
          gridMap,
          interactiveObjects,
          activeBarriers
        );

        targetV = navCmd.targetLinearVel;
        targetOmega = navCmd.targetAngularVel;
        isEmergencyBrake = navCmd.isEmergencyBraking;

        if (navCmd.localTrajectoryPoints && navCmd.localTrajectoryPoints.length > 0) {
          setActiveLocalTrajectory(navCmd.localTrajectoryPoints);
        } else if (navCmd.navState !== 'AVOIDING') {
          setActiveLocalTrajectory([]);
        }

        if (navCmd.navState !== navState) {
          updateNavState(navCmd.navState);
        }

        updateWaypointIndex(navCmd.currentWaypointIndex);

        // Determine braking status for diagnostics & HUD
        let brakingStatus: 'cruising' | 'controlled_braking' | 'emergency_braking' | 'stopped' = 'cruising';
        if (isEmergencyBrake) {
          brakingStatus = 'emergency_braking';
        } else if (targetV < currentLinearVel.current - 0.1) {
          brakingStatus = 'controlled_braking';
        } else if (Math.abs(currentLinearVel.current) < 0.05 && (navCmd.navState === 'COMPLETED' || navCmd.navState === 'STOPPED')) {
          brakingStatus = 'stopped';
        }

        updateDiagnostics({
          stoppingDistance: navCmd.stoppingDistance,
          availableClearance: navCmd.availableClearance,
          brakingStatus,
        });

        // Stuck / Stall Detector:
        // If robot hasn't made meaningful progress for > 2.6 seconds while in active mission
        const distFromLastProgress = Math.hypot(
          t.x - lastProgressPose.current[0],
          t.z - lastProgressPose.current[1]
        );

        if (distFromLastProgress > 0.25) {
          lastProgressPose.current = [t.x, t.z];
          lastProgressTime.current = currentTime;
        } else if (currentTime - lastProgressTime.current > 2.6) {
          // Robot is stalled: trigger Layer A global replan to find an alternative corridor
          const altRoute = aStarFinder.findPath([t.x, t.z], targetCoord);
          const diff = aStarFinder.pathsDiffer(altRoute, plannedPath);

          if (altRoute && altRoute.length > 0) {
            incrementReplan(
              `Stall recovery: Detour around obstacle at [${
                sensorScan.obstaclePosition
                  ? `${sensorScan.obstaclePosition[0].toFixed(1)}, ${sensorScan.obstaclePosition[1].toFixed(1)}`
                  : 'ahead'
              }]`
            );
            navController.setPath(altRoute, targetCoord);
            setPlannedPath(altRoute);
            updateDiagnostics({ routeDiffers: diff });
          } else {
            navController.clearPath();
            setPlannedPath([]);
            updateNavState('FAILED');
            updateDiagnostics({
              routeValidity: 'blocked',
              failureExplanation: `Destination unreachable: Robot blocked with no alternative corridor available.`,
            });
          }
          lastProgressTime.current = currentTime;
        }

        // Check if dynamic obstacle triggered replan from controller
        if (navCmd.needsReplan) {
          const replannedRoute = aStarFinder.findPath([t.x, t.z], targetCoord);
          const diff = aStarFinder.pathsDiffer(replannedRoute, plannedPath);

          if (replannedRoute && replannedRoute.length > 0) {
            incrementReplan(navCmd.replanReason || 'Obstacle on active route');
            navController.setPath(replannedRoute, targetCoord);
            setPlannedPath(replannedRoute);
            updateDiagnostics({
              routeDiffers: diff,
              routeValidity: 'valid',
              failureExplanation: null,
            });
          } else {
            navController.clearPath();
            setPlannedPath([]);
            updateNavState('FAILED');
            updateDiagnostics({
              routeValidity: 'blocked',
              failureExplanation: `Path blocked: ${navCmd.replanReason || 'Corridor closed'}. No safe bypass route exists.`,
            });
          }
        }

        // Record breadcrumb trajectory
        appendTrajectoryPoint(robotWorldPos);
      }
    }

    // Smooth Acceleration / Deceleration Integration
    // When emergency stopping (e.g. user E-stop) or emergency braking to avoid imminent collision:
    const effectiveLinAccel = (isEStopped || isEmergencyBrake)
      ? robotConfig.linearAcceleration * 3.0
      : robotConfig.linearAcceleration;

    const effectiveAngAccel = (isEStopped || isEmergencyBrake)
      ? robotConfig.angularAcceleration * 3.0
      : robotConfig.angularAcceleration;

    // Linear velocity clamping
    if (currentLinearVel.current < targetV) {
      currentLinearVel.current = Math.min(
        targetV,
        currentLinearVel.current + effectiveLinAccel * delta
      );
    } else if (currentLinearVel.current > targetV) {
      currentLinearVel.current = Math.max(
        targetV,
        currentLinearVel.current - effectiveLinAccel * delta
      );
    }

    // Angular velocity clamping
    if (currentAngularVel.current < targetOmega) {
      currentAngularVel.current = Math.min(
        targetOmega,
        currentAngularVel.current + effectiveAngAccel * delta
      );
    } else if (currentAngularVel.current > targetOmega) {
      currentAngularVel.current = Math.max(
        targetOmega,
        currentAngularVel.current - effectiveAngAccel * delta
      );
    }

    // Apply continuous differential-drive velocity vector
    const vx = currentLinearVel.current * Math.sin(yaw);
    const vz = currentLinearVel.current * Math.cos(yaw);
    const currentLinVel = rb.linvel();

    rb.setLinvel({ x: vx, y: currentLinVel.y, z: vz }, true);
    rb.setAngvel({ x: 0, y: currentAngularVel.current, z: 0 }, true);

    // Sync pose to Zustand store
    updateRobotPose(
      robotWorldPos,
      yaw,
      currentLinearVel.current,
      currentAngularVel.current
    );
  });

  return (
    <group>
      {/* 1. Dynamic Physics RigidBody (or Kinematic on remote replica) */}
      <RigidBody
        key={isMultiplayerActive && userRole !== 'operator' ? 'amr-replica-kinematic' : 'amr-operator-dynamic'}
        ref={rigidBodyRef}
        type={isMultiplayerActive && userRole !== 'operator' ? 'kinematicPosition' : 'dynamic'}
        colliders={false}
        enabledRotations={[false, true, false]}
        position={isMultiplayerActive && userRole !== 'operator' ? robotPose.position : [-14.5, 0.22, -10.5]}
        friction={0.05}
        restitution={0.0}
        linearDamping={1.5}
        angularDamping={2.0}
        canSleep={false}
        name="RobotRisk-AMR"
        onCollisionEnter={handleCollision}
      >
        {/* Primary Smooth-Sliding Cylindrical Hull Collider */}
        <CylinderCollider
          args={[0.12, 0.34]}
          position={[0, 0.14, 0]}
          friction={0.05}
          restitution={0.0}
        />

        {/* 3D Robot Mesh */}
        <RobotModel
          linearVelocity={currentLinearVel.current}
          angularVelocity={currentAngularVel.current}
          isEmergencyStopped={robotStatus.isEmergencyStopped}
        />
      </RigidBody>

      {/* 2. Visual Sensor Rays (LiDAR Detection Cone) */}
      <SensorVisualizer rays={visualRays} visible={true} />

      {/* 3. Visual Planned Route & Trajectory Ribbon */}
      <PathVisualizer
        plannedPath={plannedPath}
        currentWaypointIndex={currentWaypointIndex}
        actualTrajectory={actualTrajectory}
        localTrajectory={activeLocalTrajectory}
        visible={mode === 'autonomous'}
      />
    </group>
  );
};
