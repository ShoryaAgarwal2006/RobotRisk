import React from 'react';
import { RigidBody, CuboidCollider } from '@react-three/rapier';

interface WarehouseFloorProps {
  width: number;
  length: number;
}

export const WarehouseFloor: React.FC<WarehouseFloorProps> = ({
  width,
  length,
}) => {
  return (
    <group>
      {/* 1. Static Floor RigidBody & Collider */}
      <RigidBody
        type="fixed"
        colliders={false}
        friction={0.85}
        restitution={0.05}
        name="WarehouseFloor"
      >
        <CuboidCollider
          args={[width / 2, 0.25, length / 2]}
          position={[0, -0.25, 0]}
        />
        {/* Visual Concrete Floor Mesh */}
        <mesh receiveShadow position={[0, -0.25, 0]}>
          <boxGeometry args={[width, 0.5, length]} />
          <meshStandardMaterial
            color="#0b1120"
            roughness={0.75}
            metalness={0.2}
          />
        </mesh>
      </RigidBody>

      {/* 2. Industrial Floor Markings & Painted Striping */}
      <group position={[0, 0.005, 0]}>
        {/* Subtle expansion joint grid lines across warehouse floor */}
        <gridHelper
          args={[Math.max(width, length), 20, '#1e293b', '#0f172a']}
          position={[0, 0.002, 0]}
        />

        {/* --- Main Navigation Arterials & Lanes (Safety Yellow Stripes) --- */}
        {/* West Arterial Lane Stripes (X = -13.0 & X = -16.0) */}
        <mesh position={[-13.0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[0.1, 24]} />
          <meshBasicMaterial color="#eab308" opacity={0.8} transparent />
        </mesh>
        <mesh position={[-16.0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[0.1, 24]} />
          <meshBasicMaterial color="#eab308" opacity={0.8} transparent />
        </mesh>

        {/* East Arterial Lane Stripes (X = 12.5 & X = 15.5) */}
        <mesh position={[12.5, 0, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[0.1, 24]} />
          <meshBasicMaterial color="#eab308" opacity={0.8} transparent />
        </mesh>
        <mesh position={[15.5, 0, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[0.1, 24]} />
          <meshBasicMaterial color="#eab308" opacity={0.8} transparent />
        </mesh>

        {/* North Cross-Aisle Lane (Z = -10.5) */}
        <mesh position={[0, 0, -9.0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[26, 0.1]} />
          <meshBasicMaterial color="#eab308" opacity={0.8} transparent />
        </mesh>
        <mesh position={[0, 0, -12.0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[26, 0.1]} />
          <meshBasicMaterial color="#eab308" opacity={0.8} transparent />
        </mesh>

        {/* South Cross-Aisle Lane (Z = 10.5) */}
        <mesh position={[0, 0, 9.0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[26, 0.1]} />
          <meshBasicMaterial color="#eab308" opacity={0.8} transparent />
        </mesh>
        <mesh position={[0, 0, 12.0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[26, 0.1]} />
          <meshBasicMaterial color="#eab308" opacity={0.8} transparent />
        </mesh>

        {/* Central Aisle Guide Tracks (Cyan guidance centerlines for AMR) */}
        {[-6.5, 0.0, 6.5].map((aisleX, idx) => (
          <group key={`centerline-${idx}`} position={[aisleX, 0, 0]}>
            {/* Dashed Centerline segments */}
            {Array.from({ length: 9 }).map((_, sIdx) => (
              <mesh
                key={`dash-${sIdx}`}
                position={[0, 0, -7.0 + sIdx * 1.75]}
                rotation={[-Math.PI / 2, 0, 0]}
              >
                <planeGeometry args={[0.08, 0.8]} />
                <meshBasicMaterial color="#0284c7" opacity={0.7} transparent />
              </mesh>
            ))}
          </group>
        ))}

        {/* Inbound Freight Loading Bay Staging Box (West Side) */}
        <group position={[-14.0, 0, 4.0]}>
          {/* Border Box */}
          <mesh position={[0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[4.5, 6.0]} />
            <meshBasicMaterial color="#ffaa00" opacity={0.06} transparent />
          </mesh>
          {/* Corner Marks */}
          {[-2.2, 2.2].map((cx, i) =>
            [-3.0, 3.0].map((cz, j) => (
              <mesh key={`corner-${i}-${j}`} position={[cx, 0, cz]} rotation={[-Math.PI / 2, 0, 0]}>
                <planeGeometry args={[0.6, 0.6]} />
                <meshBasicMaterial color="#eab308" opacity={0.5} transparent />
              </mesh>
            ))
          )}
        </group>

        {/* Pedestrian Crosswalk Hatching near Charging & Loading */}
        <group position={[-14.5, 0, -2.0]}>
          {[-1.2, -0.6, 0, 0.6, 1.2].map((zOffset, idx) => (
            <mesh key={`zebra-${idx}`} position={[0, 0, zOffset]} rotation={[-Math.PI / 2, 0, 0]}>
              <planeGeometry args={[2.4, 0.25]} />
              <meshBasicMaterial color="#f8fafc" opacity={0.35} transparent />
            </mesh>
          ))}
        </group>
      </group>
    </group>
  );
};
