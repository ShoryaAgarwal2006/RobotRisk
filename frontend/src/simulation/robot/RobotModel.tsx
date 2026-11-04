import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface RobotModelProps {
  linearVelocity?: number;
  angularVelocity?: number;
  isEmergencyStopped?: boolean;
}

export const RobotModel: React.FC<RobotModelProps> = ({
  linearVelocity = 0,
  angularVelocity = 0,
  isEmergencyStopped = false,
}) => {
  const leftWheelRef = useRef<THREE.Group>(null);
  const rightWheelRef = useRef<THREE.Group>(null);
  const lidarRef = useRef<THREE.Group>(null);
  const beaconRef = useRef<THREE.Mesh>(null);

  const wheelRadius = 0.14;
  const trackWidth = 0.54;

  // Animate wheels and sensor turret on frame
  useFrame((_, delta) => {
    // Wheel rotation speed in rad/s: omega = v / r
    // For differential drive:
    // v_left = v - (trackWidth/2)*omega
    // v_right = v + (trackWidth/2)*omega
    const vLeft = linearVelocity - (trackWidth / 2) * angularVelocity;
    const vRight = linearVelocity + (trackWidth / 2) * angularVelocity;

    const rotLeft = (vLeft / wheelRadius) * delta;
    const rotRight = (vRight / wheelRadius) * delta;

    if (leftWheelRef.current) {
      leftWheelRef.current.rotation.x += rotLeft;
    }
    if (rightWheelRef.current) {
      rightWheelRef.current.rotation.x += rotRight;
    }

    // LiDAR rotates constantly unless emergency stopped
    if (lidarRef.current) {
      if (!isEmergencyStopped) {
        lidarRef.current.rotation.y += delta * 12.0; // 12 rad/s scan rate (~2 Hz)
      }
    }

    // Status Beacon pulse
    if (beaconRef.current) {
      const mat = beaconRef.current.material as THREE.MeshStandardMaterial;
      if (isEmergencyStopped) {
        const pulse = (Math.sin(Date.now() * 0.015) + 1) * 0.5;
        mat.emissive.setRGB(1.0 * pulse, 0.05, 0.05);
        mat.emissiveIntensity = 0.5 + pulse * 2.0;
      } else {
        mat.emissive.setRGB(0.0, 0.9, 0.8);
        mat.emissiveIntensity = 0.8;
      }
    }
  });

  return (
    <group>
      {/* 1. Main Industrial Chassis */}
      <group position={[0, 0.16, 0]}>
        {/* Main Base Body */}
        <mesh castShadow receiveShadow>
          <boxGeometry args={[0.52, 0.14, 0.72]} />
          <meshStandardMaterial
            color="#141d33"
            roughness={0.4}
            metalness={0.7}
          />
        </mesh>

        {/* Lower Protective Perimeter Bumper */}
        <mesh position={[0, -0.04, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.55, 0.06, 0.75]} />
          <meshStandardMaterial
            color="#070a13"
            roughness={0.8}
            metalness={0.2}
          />
        </mesh>

        {/* Top Deck Accent Plate (Safety Yellow / Cyber Cyan Trim) */}
        <mesh position={[0, 0.075, 0]} receiveShadow>
          <boxGeometry args={[0.46, 0.02, 0.64]} />
          <meshStandardMaterial
            color="#0d1322"
            roughness={0.3}
            metalness={0.8}
          />
        </mesh>

        {/* Distinct Forward Direction Arrow on Deck */}
        <group position={[0, 0.086, 0.05]}>
          {/* Shaft */}
          <mesh position={[0, 0, -0.06]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[0.06, 0.16]} />
            <meshBasicMaterial color="#00f0ff" />
          </mesh>
          {/* Arrowhead */}
          <mesh position={[0, 0, 0.08]} rotation={[-Math.PI / 2, 0, 0]}>
            <coneGeometry args={[0.08, 0.14, 3]} />
            <meshBasicMaterial color="#00f0ff" />
          </mesh>
        </group>

        {/* Side Hazard Warning Stripes */}
        <mesh position={[0.265, 0, 0]}>
          <boxGeometry args={[0.005, 0.06, 0.4]} />
          <meshStandardMaterial
            color="#ffaa00"
            roughness={0.5}
            emissive="#ffaa00"
            emissiveIntensity={0.2}
          />
        </mesh>
        <mesh position={[-0.265, 0, 0]}>
          <boxGeometry args={[0.005, 0.06, 0.4]} />
          <meshStandardMaterial
            color="#ffaa00"
            roughness={0.5}
            emissive="#ffaa00"
            emissiveIntensity={0.2}
          />
        </mesh>

        {/* Front Directional Headlights */}
        <mesh position={[0.16, 0.02, 0.362]} receiveShadow>
          <boxGeometry args={[0.08, 0.04, 0.01]} />
          <meshStandardMaterial
            color="#e0f2fe"
            emissive="#38bdf8"
            emissiveIntensity={1.5}
          />
        </mesh>
        <mesh position={[-0.16, 0.02, 0.362]} receiveShadow>
          <boxGeometry args={[0.08, 0.04, 0.01]} />
          <meshStandardMaterial
            color="#e0f2fe"
            emissive="#38bdf8"
            emissiveIntensity={1.5}
          />
        </mesh>
        {/* Subtle Forward Headlight Cones */}
        <pointLight
          position={[0, 0.05, 0.5]}
          intensity={0.8}
          distance={4}
          color="#38bdf8"
        />

        {/* Rear Brake / Status LEDs */}
        <mesh position={[0.16, 0.02, -0.362]}>
          <boxGeometry args={[0.08, 0.04, 0.01]} />
          <meshStandardMaterial
            color={isEmergencyStopped ? '#ef4444' : '#b91c1c'}
            emissive={isEmergencyStopped ? '#ef4444' : '#ef4444'}
            emissiveIntensity={isEmergencyStopped ? 2.5 : 0.6}
          />
        </mesh>
        <mesh position={[-0.16, 0.02, -0.362]}>
          <boxGeometry args={[0.08, 0.04, 0.01]} />
          <meshStandardMaterial
            color={isEmergencyStopped ? '#ef4444' : '#b91c1c'}
            emissive={isEmergencyStopped ? '#ef4444' : '#ef4444'}
            emissiveIntensity={isEmergencyStopped ? 2.5 : 0.6}
          />
        </mesh>
      </group>

      {/* 2. Top Sensor Turret & LiDAR Puck */}
      <group position={[0, 0.26, 0.12]}>
        {/* Sensor Mount Riser */}
        <mesh castShadow position={[0, 0, 0]}>
          <cylinderGeometry args={[0.08, 0.09, 0.06, 24]} />
          <meshStandardMaterial color="#0d1322" metalness={0.8} roughness={0.3} />
        </mesh>

        {/* Rotating LiDAR Puck */}
        <group ref={lidarRef} position={[0, 0.05, 0]}>
          <mesh castShadow>
            <cylinderGeometry args={[0.065, 0.065, 0.05, 24]} />
            <meshStandardMaterial color="#070a13" metalness={0.9} roughness={0.2} />
          </mesh>
          {/* LiDAR Laser Glass Emitter Band */}
          <mesh position={[0, 0, 0]}>
            <cylinderGeometry args={[0.067, 0.067, 0.018, 24]} />
            <meshStandardMaterial
              color="#00f0ff"
              emissive="#00f0ff"
              emissiveIntensity={1.8}
              transparent
              opacity={0.85}
            />
          </mesh>
          {/* Turret Optical Notch */}
          <mesh position={[0, 0, 0.06]}>
            <boxGeometry args={[0.015, 0.03, 0.015]} />
            <meshStandardMaterial color="#38bdf8" emissive="#38bdf8" emissiveIntensity={2.0} />
          </mesh>
        </group>
      </group>

      {/* 3. Safety Status Dome Beacon */}
      <group position={[0, 0.26, -0.2]}>
        <mesh position={[0, 0, 0]}>
          <cylinderGeometry args={[0.04, 0.045, 0.04, 16]} />
          <meshStandardMaterial color="#0d1322" metalness={0.7} />
        </mesh>
        <mesh ref={beaconRef} position={[0, 0.03, 0]}>
          <sphereGeometry args={[0.035, 16, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial
            color="#00f0ff"
            emissive="#00f0ff"
            emissiveIntensity={1.0}
            roughness={0.1}
          />
        </mesh>
      </group>

      {/* 4. Left Motorized Drive Wheel */}
      <group ref={leftWheelRef} position={[-0.28, 0.14, 0]}>
        {/* Tire */}
        <mesh castShadow rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[wheelRadius, wheelRadius, 0.06, 24]} />
          <meshStandardMaterial color="#0f172a" roughness={0.9} />
        </mesh>
        {/* Metallic Rim */}
        <mesh rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[wheelRadius * 0.65, wheelRadius * 0.65, 0.062, 16]} />
          <meshStandardMaterial color="#94a3b8" metalness={0.9} roughness={0.2} />
        </mesh>
        {/* Hub Cap Accent */}
        <mesh position={[-0.032, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[wheelRadius * 0.25, wheelRadius * 0.25, 0.01, 16]} />
          <meshStandardMaterial color="#00f0ff" emissive="#00f0ff" emissiveIntensity={0.6} />
        </mesh>
      </group>

      {/* 5. Right Motorized Drive Wheel */}
      <group ref={rightWheelRef} position={[0.28, 0.14, 0]}>
        {/* Tire */}
        <mesh castShadow rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[wheelRadius, wheelRadius, 0.06, 24]} />
          <meshStandardMaterial color="#0f172a" roughness={0.9} />
        </mesh>
        {/* Metallic Rim */}
        <mesh rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[wheelRadius * 0.65, wheelRadius * 0.65, 0.062, 16]} />
          <meshStandardMaterial color="#94a3b8" metalness={0.9} roughness={0.2} />
        </mesh>
        {/* Hub Cap Accent */}
        <mesh position={[0.032, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[wheelRadius * 0.25, wheelRadius * 0.25, 0.01, 16]} />
          <meshStandardMaterial color="#00f0ff" emissive="#00f0ff" emissiveIntensity={0.6} />
        </mesh>
      </group>

      {/* 6. Front Passive Caster Wheel */}
      <group position={[0, 0.06, 0.26]}>
        <mesh castShadow position={[0, 0.03, 0]}>
          <cylinderGeometry args={[0.035, 0.035, 0.04, 12]} />
          <meshStandardMaterial color="#334155" metalness={0.8} />
        </mesh>
        <mesh castShadow position={[0, 0, 0]}>
          <sphereGeometry args={[0.05, 16, 16]} />
          <meshStandardMaterial color="#64748b" metalness={0.8} roughness={0.3} />
        </mesh>
      </group>

      {/* 7. Rear Passive Caster Wheel */}
      <group position={[0, 0.06, -0.26]}>
        <mesh castShadow position={[0, 0.03, 0]}>
          <cylinderGeometry args={[0.035, 0.035, 0.04, 12]} />
          <meshStandardMaterial color="#334155" metalness={0.8} />
        </mesh>
        <mesh castShadow position={[0, 0, 0]}>
          <sphereGeometry args={[0.05, 16, 16]} />
          <meshStandardMaterial color="#64748b" metalness={0.8} roughness={0.3} />
        </mesh>
      </group>
    </group>
  );
};
