import React, { useEffect, useRef } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import { useSimulationStore } from '../state/useSimulationStore';

export const CameraRig: React.FC = () => {
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const cameraView = useSimulationStore((s) => s.cameraView);
  const robotPose = useSimulationStore((s) => s.robotPose);
  const cameraResetTrigger = useSimulationStore((s) => s.cameraResetTrigger);
  const { camera } = useThree();

  const prevRobotPos = useRef(new THREE.Vector3(...robotPose.position));
  const isTransitioning = useRef(false);
  const transitionTargetPos = useRef(new THREE.Vector3());
  const transitionCamPos = useRef(new THREE.Vector3());

  // Function to align camera behind robot
  const alignBehindRobot = () => {
    const [rx, ry, rz] = robotPose.position;
    const yaw = robotPose.rotation;

    const followDistance = 4.5;
    const cameraHeight = 2.4;

    const desiredX = rx - Math.sin(yaw) * followDistance;
    const desiredZ = rz - Math.cos(yaw) * followDistance;
    const desiredY = ry + cameraHeight;

    transitionCamPos.current.set(desiredX, desiredY, desiredZ);
    transitionTargetPos.current.set(rx, ry + 0.4, rz);
    isTransitioning.current = true;
  };

  // Function to set up top-down view
  const alignTopDown = () => {
    transitionCamPos.current.set(0, 32, 0.01);
    transitionTargetPos.current.set(0, 0, 0);
    isTransitioning.current = true;
  };

  // Function to set up free orbit view
  const alignFreeOrbit = () => {
    const [rx, ry, rz] = robotPose.position;
    transitionCamPos.current.set(rx + 8, ry + 7, rz + 8);
    transitionTargetPos.current.set(rx, ry + 0.5, rz);
    isTransitioning.current = true;
  };

  // React to mode change
  useEffect(() => {
    if (cameraView === 'follow') {
      alignBehindRobot();
    } else if (cameraView === 'top_down') {
      alignTopDown();
    } else if (cameraView === 'orbit') {
      alignFreeOrbit();
    }
  }, [cameraView]);

  // React to manual Reset Camera button click
  useEffect(() => {
    if (cameraResetTrigger === 0) return;

    if (cameraView === 'follow') {
      alignBehindRobot();
    } else if (cameraView === 'top_down') {
      alignTopDown();
    } else if (cameraView === 'orbit') {
      alignFreeOrbit();
    }
  }, [cameraResetTrigger]);

  useFrame((_, delta) => {
    const controls = controlsRef.current;
    if (!controls) return;

    const [rx, ry, rz] = robotPose.position;

    // Handle smooth interpolation transitions
    if (isTransitioning.current) {
      const step = Math.min(1.0, delta * 5.0);
      camera.position.lerp(transitionCamPos.current, step);
      controls.target.lerp(transitionTargetPos.current, step);
      controls.update();

      if (
        camera.position.distanceTo(transitionCamPos.current) < 0.08 &&
        controls.target.distanceTo(transitionTargetPos.current) < 0.08
      ) {
        camera.position.copy(transitionCamPos.current);
        controls.target.copy(transitionTargetPos.current);
        isTransitioning.current = false;
      }
      prevRobotPos.current.set(rx, ry, rz);
      return;
    }

    // In FOLLOW mode:
    // Move the orbit target and camera along with the robot's world movement delta!
    // This allows the user to freely orbit/zoom/pan, and that relative orientation
    // is preserved as the robot moves through aisles!
    if (cameraView === 'follow') {
      const deltaX = rx - prevRobotPos.current.x;
      const deltaY = ry - prevRobotPos.current.y;
      const deltaZ = rz - prevRobotPos.current.z;

      if (Math.abs(deltaX) > 0.0001 || Math.abs(deltaY) > 0.0001 || Math.abs(deltaZ) > 0.0001) {
        camera.position.x += deltaX;
        camera.position.y += deltaY;
        camera.position.z += deltaZ;

        controls.target.x += deltaX;
        controls.target.y += deltaY;
        controls.target.z += deltaZ;
        controls.update();
      }
    }

    prevRobotPos.current.set(rx, ry, rz);
  });

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enabled={true}
      enableDamping
      dampingFactor={0.08}
      minDistance={1.8}
      maxDistance={55}
      minPolarAngle={0.05} // Prevent camera from flipping over top pole
      maxPolarAngle={Math.PI / 2 - 0.05} // Prevent camera from dropping below the floor
      rotateSpeed={0.8}
      zoomSpeed={1.0}
      panSpeed={0.8}
    />
  );
};
