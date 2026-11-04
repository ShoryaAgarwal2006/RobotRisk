import React from 'react';
import { RigidBody } from '@react-three/rapier';

export const Ground: React.FC = () => {
  const floorSize = 24;
  const wallHeight = 1.0;
  const wallThickness = 0.5;

  return (
    <group>
      {/* Main Floor Collider & Visual */}
      <RigidBody type="fixed" friction={0.8} restitution={0.2}>
        <mesh receiveShadow position={[0, -0.25, 0]}>
          <boxGeometry args={[floorSize, 0.5, floorSize]} />
          <meshStandardMaterial
            color="#0b1120"
            roughness={0.8}
            metalness={0.2}
          />
        </mesh>
      </RigidBody>

      {/* Cyber Grid Lines on Floor */}
      <gridHelper
        args={[floorSize, floorSize, '#00f0ff', '#1e2942']}
        position={[0, 0.005, 0]}
      />

      {/* Perimeter Bounding Curbs (Keep test objects on table) */}
      <RigidBody type="fixed" friction={0.6}>
        {/* North Wall */}
        <mesh position={[0, wallHeight / 2, -floorSize / 2]} receiveShadow castShadow>
          <boxGeometry args={[floorSize, wallHeight, wallThickness]} />
          <meshStandardMaterial color="#1e2942" roughness={0.5} />
        </mesh>
        {/* South Wall */}
        <mesh position={[0, wallHeight / 2, floorSize / 2]} receiveShadow castShadow>
          <boxGeometry args={[floorSize, wallHeight, wallThickness]} />
          <meshStandardMaterial color="#1e2942" roughness={0.5} />
        </mesh>
        {/* West Wall */}
        <mesh position={[-floorSize / 2, wallHeight / 2, 0]} receiveShadow castShadow>
          <boxGeometry args={[wallThickness, wallHeight, floorSize]} />
          <meshStandardMaterial color="#1e2942" roughness={0.5} />
        </mesh>
        {/* East Wall */}
        <mesh position={[floorSize / 2, wallHeight / 2, 0]} receiveShadow castShadow>
          <boxGeometry args={[wallThickness, wallHeight, floorSize]} />
          <meshStandardMaterial color="#1e2942" roughness={0.5} />
        </mesh>
      </RigidBody>

      {/* Center Target Platform Indicator (Precursor to Autonomous Lab Goal) */}
      <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[2.8, 3.0, 32]} />
        <meshBasicMaterial color="#00f0ff" opacity={0.4} transparent />
      </mesh>
      <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.9, 1.0, 32]} />
        <meshBasicMaterial color="#00f0ff" opacity={0.6} transparent />
      </mesh>
    </group>
  );
};
