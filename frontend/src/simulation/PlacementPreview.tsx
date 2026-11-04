import React, { useEffect, useRef } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { useSimulationStore } from '../state/useSimulationStore';
import { GridMap } from '../navigation/GridMap';

export const PlacementPreview: React.FC = () => {
  const placementMode = useSimulationStore((s) => s.placementMode);
  const previewPosition = useSimulationStore((s) => s.previewPosition);
  const previewRotation = useSimulationStore((s) => s.previewRotation);
  const isPlacementValid = useSimulationStore((s) => s.isPlacementValid);
  const selectedAisleToBlock = useSimulationStore((s) => s.selectedAisleToBlock);
  const robotPose = useSimulationStore((s) => s.robotPose);

  const updatePlacementPreview = useSimulationStore((s) => s.updatePlacementPreview);
  const rotatePlacementPreview = useSimulationStore((s) => s.rotatePlacementPreview);
  const confirmPlacement = useSimulationStore((s) => s.confirmPlacement);
  const cancelPlacement = useSimulationStore((s) => s.cancelPlacement);

  const { raycaster, camera } = useThree();
  const groundPlane = useRef(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0));
  const planeIntersect = useRef(new THREE.Vector3());
  const gridMap = useRef(new GridMap());

  // Keyboard controls for placement: 'R' to rotate, 'Escape' to cancel, 'Enter' to place
  useEffect(() => {
    if (!placementMode) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'r' || e.key === 'R') {
        rotatePlacementPreview(Math.PI / 4);
      } else if (e.key === 'Escape') {
        cancelPlacement();
      } else if (e.key === 'Enter') {
        confirmPlacement();
      }
    };

    const handlePointerDown = (e: PointerEvent) => {
      if (e.button === 2) {
        // Right-click cancels placement
        cancelPlacement();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('pointerdown', handlePointerDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [placementMode, rotatePlacementPreview, cancelPlacement, confirmPlacement]);

  // Raycast mouse to ground plane on each frame
  useFrame(({ pointer }) => {
    if (!placementMode) return;

    // If placing a fixed aisle barrier, position is determined by aisle center, but rotation can be adjusted
    if (placementMode === 'barrier' && selectedAisleToBlock) {
      return;
    }

    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.ray.intersectPlane(groundPlane.current, planeIntersect.current);

    if (hit) {
      const rawX = hit.x;
      const rawZ = hit.z;

      // Clamp within warehouse interior
      const clampedX = Math.max(-18.5, Math.min(18.5, rawX));
      const clampedZ = Math.max(-14.5, Math.min(14.5, rawZ));
      const targetY = placementMode === 'box' ? 0.4 : 0.5;

      // Validate position:
      // 1. Distance to robot must be >= 1.1m (do not spawn on top of robot)
      const distToRobot = Math.hypot(
        clampedX - robotPose.position[0],
        clampedZ - robotPose.position[2]
      );
      const notOnRobot = distToRobot >= 1.1;

      // 2. Not inside static physical rack or wall
      const notInRack = !gridMap.current.isPhysicalObstacle(clampedX, clampedZ);

      const isValid = notOnRobot && notInRack;

      updatePlacementPreview([clampedX, targetY, clampedZ], isValid);
    }
  });

  if (!placementMode) return null;

  // Check if position is directly ahead of moving AMR within stopping distance
  const robotSpeed = Math.abs(robotPose.linearVelocity || 0);
  const decelRate = 6.0;
  const stoppingDist = (robotSpeed * robotSpeed) / (2 * decelRate) + 0.34 + 0.35;

  const dx = previewPosition[0] - robotPose.position[0];
  const dz = previewPosition[2] - robotPose.position[2];
  const distToAMR = Math.hypot(dx, dz);
  const yaw = robotPose.rotation || 0;
  const zLocal = Math.sin(yaw) * dx + Math.cos(yaw) * dz;
  const xLocal = Math.cos(yaw) * dx - Math.sin(yaw) * dz;
  const isAheadOfRobot = zLocal > 0 && Math.abs(xLocal) <= 0.85;

  const isWithinStoppingDist =
    robotSpeed > 0.3 && isAheadOfRobot && distToAMR < stoppingDist;

  const validColor = '#00f0ff';
  const invalidColor = '#ff3366';
  const cautionColor = '#f59e0b';

  const currentColor = !isPlacementValid
    ? invalidColor
    : isWithinStoppingDist
    ? cautionColor
    : validColor;

  return (
    <group
      position={previewPosition}
      rotation={[0, previewRotation, 0]}
      onClick={(e) => {
        e.stopPropagation();
        if (isPlacementValid) {
          confirmPlacement();
        }
      }}
    >
      {/* Floating Stopping Distance Warning */}
      {isWithinStoppingDist && (
        <Html center position={[0, 1.2, 0]} distanceFactor={14}>
          <div className="bg-amber-950/90 border border-amber-500 text-amber-200 text-[10px] font-mono px-2 py-1 rounded shadow-xl whitespace-nowrap pointer-events-none flex items-center space-x-1.5 animate-pulse">
            <span className="w-2 h-2 rounded-full bg-amber-400"></span>
            <span>WARNING: &lt; STOPPING DIST ({distToAMR.toFixed(1)}m &lt; {stoppingDist.toFixed(1)}m)</span>
          </div>
        </Html>
      )}

      {/* Ground Projection Ring Indicator */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -previewPosition[1] + 0.05, 0]}>
        <ringGeometry args={[0.6, 0.75, 32]} />
        <meshBasicMaterial
          color={currentColor}
          transparent
          opacity={0.8}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* 3D Geometry Preview */}
      {placementMode === 'box' && (
        <mesh castShadow>
          <boxGeometry args={[0.75, 0.75, 0.75]} />
          <meshStandardMaterial
            color={currentColor}
            transparent
            opacity={0.65}
            roughness={0.2}
            emissive={currentColor}
            emissiveIntensity={0.3}
            wireframe={!isPlacementValid}
          />
        </mesh>
      )}

      {placementMode === 'sphere' && (
        <mesh castShadow>
          <sphereGeometry args={[0.5, 32, 32]} />
          <meshStandardMaterial
            color={currentColor}
            transparent
            opacity={0.65}
            roughness={0.2}
            emissive={currentColor}
            emissiveIntensity={0.3}
            wireframe={!isPlacementValid}
          />
        </mesh>
      )}

      {placementMode === 'barrier' && (
        <group>
          {/* Barricade Frame */}
          <mesh position={[0, 0, 0]}>
            <boxGeometry args={[2.8, 1.4, 0.4]} />
            <meshStandardMaterial
              color={currentColor}
              transparent
              opacity={0.7}
              emissive={currentColor}
              emissiveIntensity={0.3}
            />
          </mesh>
        </group>
      )}
    </group>
  );
};
