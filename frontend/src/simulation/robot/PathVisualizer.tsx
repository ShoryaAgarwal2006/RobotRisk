import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { TrajectoryPoint } from '../../navigation/LocalTrajectoryPlanner';

interface PathVisualizerProps {
  plannedPath: Array<[number, number]>;
  currentWaypointIndex: number;
  actualTrajectory: Array<[number, number, number]>;
  localTrajectory?: TrajectoryPoint[];
  visible?: boolean;
}

export const PathVisualizer: React.FC<PathVisualizerProps> = ({
  plannedPath,
  currentWaypointIndex,
  actualTrajectory,
  localTrajectory = [],
  visible = true,
}) => {
  const waypointMarkerRef = useRef<THREE.Mesh>(null);

  // Generate 3D Line for Planned Route
  const pathGeometry = useMemo(() => {
    if (plannedPath.length < 2) return null;
    const points = plannedPath.map(([x, z]) => new THREE.Vector3(x, 0.04, z));
    return new THREE.BufferGeometry().setFromPoints(points);
  }, [plannedPath]);

  // Generate 3D Line for Actual Trajectory History
  const trajectoryGeometry = useMemo(() => {
    if (actualTrajectory.length < 2) return null;
    const points = actualTrajectory.map(([x, y, z]) => new THREE.Vector3(x, y + 0.02, z));
    return new THREE.BufferGeometry().setFromPoints(points);
  }, [actualTrajectory]);

  // Generate 3D Line for Active Layer B Local Avoidance Arc
  const localTrajGeometry = useMemo(() => {
    if (!localTrajectory || localTrajectory.length < 2) return null;
    const points = localTrajectory.map((pt) => new THREE.Vector3(pt.x, 0.06, pt.z));
    return new THREE.BufferGeometry().setFromPoints(points);
  }, [localTrajectory]);

  // Animate target waypoint pulse
  useFrame(() => {
    if (waypointMarkerRef.current) {
      const pulse = (Math.sin(Date.now() * 0.008) + 1) * 0.5;
      waypointMarkerRef.current.scale.set(1 + pulse * 0.3, 1 + pulse * 0.3, 1 + pulse * 0.3);
    }
  });

  if (!visible) return null;

  const activeWaypoint =
    currentWaypointIndex < plannedPath.length ? plannedPath[currentWaypointIndex] : null;

  return (
    <group>
      {/* 1. Planned Route Navigation Ribbon (Cyan / Teal) */}
      {pathGeometry && (
        <group>
          {/* Main glowing line */}
          {/* @ts-expect-error Three line primitive */}
          <line geometry={pathGeometry}>
            <lineBasicMaterial color="#00f0ff" linewidth={3} />
          </line>

          {/* Individual Waypoint Nodes on Route */}
          {plannedPath.map(([wx, wz], idx) => (
            <mesh key={`wp-node-${idx}`} position={[wx, 0.04, wz]} rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[0.08, 0.16, 16]} />
              <meshBasicMaterial
                color={idx < currentWaypointIndex ? '#334155' : '#00f0ff'}
                transparent
                opacity={0.8}
              />
            </mesh>
          ))}
        </group>
      )}

      {/* 2. Active Layer B Local Avoidance Arc Ribbon (Bright Emerald Neon) */}
      {localTrajGeometry && (
        <group>
          {/* @ts-expect-error Three line primitive */}
          <line geometry={localTrajGeometry}>
            <lineBasicMaterial color="#10b981" linewidth={4} />
          </line>
          {localTrajectory.map((pt, idx) => (
            <mesh key={`local-pt-${idx}`} position={[pt.x, 0.06, pt.z]} rotation={[-Math.PI / 2, 0, 0]}>
              <circleGeometry args={[0.04, 8]} />
              <meshBasicMaterial color="#34d399" />
            </mesh>
          ))}
        </group>
      )}

      {/* 3. Active Next Target Waypoint Marker (Pulsing Amber/Cyan) */}
      {activeWaypoint && (
        <group position={[activeWaypoint[0], 0.15, activeWaypoint[1]]}>
          {/* Vertical Target Beacon Beam */}
          <mesh ref={waypointMarkerRef}>
            <cylinderGeometry args={[0.12, 0.18, 0.4, 16]} />
            <meshStandardMaterial
              color="#ffaa00"
              emissive="#ffaa00"
              emissiveIntensity={1.2}
              transparent
              opacity={0.85}
            />
          </mesh>
          {/* Ground Target Ring */}
          <mesh position={[0, -0.1, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.25, 0.35, 24]} />
            <meshBasicMaterial color="#ffaa00" transparent opacity={0.7} />
          </mesh>
        </group>
      )}

      {/* 4. Actual Robot Trajectory Trail (Dotted/Subtle Neon) */}
      {trajectoryGeometry && (
        // @ts-expect-error Three line primitive
        <line geometry={trajectoryGeometry}>
          <lineBasicMaterial color="#a855f7" transparent opacity={0.6} linewidth={1} />
        </line>
      )}
    </group>
  );
};
