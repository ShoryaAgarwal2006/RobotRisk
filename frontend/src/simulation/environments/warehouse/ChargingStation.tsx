import React from 'react';
import { RigidBody, CuboidCollider } from '@react-three/rapier';

interface ChargingStationProps {
  position: [number, number, number];
  rotation?: [number, number, number];
}

export const ChargingStation: React.FC<ChargingStationProps> = ({
  position,
  rotation = [0, 0, 0],
}) => {
  return (
    <group position={position} rotation={rotation}>
      {/* 1. Static Physics Collider for Charger Tower & Backstop */}
      <RigidBody
        type="fixed"
        colliders={false}
        friction={0.8}
        name="ChargingStation"
      >
        <CuboidCollider args={[0.6, 1.0, 0.2]} position={[0, 1.0, -0.4]} />
        {/* Left and Right docking bumper rails */}
        <CuboidCollider args={[0.06, 0.08, 0.5]} position={[-0.45, 0.08, 0.1]} />
        <CuboidCollider args={[0.06, 0.08, 0.5]} position={[0.45, 0.08, 0.1]} />
      </RigidBody>

      {/* 2. Visual Vertical Power Terminal Tower */}
      <group position={[0, 1.0, -0.4]}>
        {/* Main Cabinet */}
        <mesh castShadow receiveShadow>
          <boxGeometry args={[1.0, 1.8, 0.35]} />
          <meshStandardMaterial color="#0f172a" metalness={0.8} roughness={0.3} />
        </mesh>

        {/* High-voltage Cyan Accent Bevel */}
        <mesh position={[0, 0, 0.18]}>
          <boxGeometry args={[0.85, 1.6, 0.02]} />
          <meshStandardMaterial color="#1e293b" metalness={0.7} roughness={0.4} />
        </mesh>

        {/* Illuminated Charging Status Screen */}
        <mesh position={[0, 0.45, 0.192]}>
          <planeGeometry args={[0.65, 0.35]} />
          <meshBasicMaterial color="#0284c7" />
        </mesh>
        {/* Screen Text Line Bar */}
        <mesh position={[0, 0.45, 0.194]}>
          <planeGeometry args={[0.55, 0.04]} />
          <meshBasicMaterial color="#38bdf8" />
        </mesh>

        {/* Charging Contact Pad Plates */}
        <mesh position={[0, -0.4, 0.19]}>
          <boxGeometry args={[0.4, 0.15, 0.03]} />
          <meshStandardMaterial
            color="#e2e8f0"
            metalness={0.95}
            roughness={0.1}
            emissive="#00f0ff"
            emissiveIntensity={0.4}
          />
        </mesh>
        {/* High-power indicator LED */}
        <pointLight position={[0, 0.6, 0.3]} intensity={0.6} distance={3} color="#00f0ff" />
      </group>

      {/* 3. Floor Docking Guide Plate & Wheel Alignment Bumpers */}
      <group position={[0, 0.01, 0]}>
        {/* Floor Pad Graphic */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[1.2, 1.4]} />
          <meshBasicMaterial color="#00f0ff" opacity={0.2} transparent />
        </mesh>

        {/* Inner Target Cross */}
        <mesh position={[0, 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.08, 0.6]} />
          <meshBasicMaterial color="#00f0ff" />
        </mesh>
        <mesh position={[0, 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.6, 0.08]} />
          <meshBasicMaterial color="#00f0ff" />
        </mesh>

        {/* Physical Guide Rails (Yellow) */}
        <mesh position={[-0.45, 0.08, 0.1]} castShadow receiveShadow>
          <boxGeometry args={[0.08, 0.14, 1.0]} />
          <meshStandardMaterial color="#eab308" metalness={0.7} roughness={0.3} />
        </mesh>
        <mesh position={[0.45, 0.08, 0.1]} castShadow receiveShadow>
          <boxGeometry args={[0.08, 0.14, 1.0]} />
          <meshStandardMaterial color="#eab308" metalness={0.7} roughness={0.3} />
        </mesh>
      </group>
    </group>
  );
};
