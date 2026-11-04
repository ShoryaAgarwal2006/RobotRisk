import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface DeliveryZoneProps {
  position: [number, number, number];
  radius?: number;
}

export const DeliveryZone: React.FC<DeliveryZoneProps> = ({
  position,
  radius = 2.2,
}) => {
  const beaconBeamRef = useRef<THREE.Mesh>(null);
  const ringRef = useRef<THREE.Group>(null);
  const lightRef = useRef<THREE.PointLight>(null);

  useFrame((_, delta) => {
    // Gentle rotation of the outer ring
    if (ringRef.current) {
      ringRef.current.rotation.z += delta * 0.4;
    }

    // Holographic beam pulsing intensity
    if (beaconBeamRef.current) {
      const pulse = (Math.sin(Date.now() * 0.003) + 1) * 0.5;
      const mat = beaconBeamRef.current.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.15 + pulse * 0.2;
    }

    if (lightRef.current) {
      const pulse = (Math.sin(Date.now() * 0.003) + 1) * 0.5;
      lightRef.current.intensity = 1.0 + pulse * 1.5;
    }
  });

  return (
    <group position={position}>
      {/* 1. Floor Target Markings */}
      <group position={[0, 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        {/* Outer Circular Boundary */}
        <mesh receiveShadow>
          <ringGeometry args={[radius - 0.08, radius, 48]} />
          <meshBasicMaterial color="#00ff88" />
        </mesh>

        {/* Rotating Segmented Ring */}
        <group ref={ringRef}>
          <mesh receiveShadow>
            <ringGeometry args={[radius * 0.72, radius * 0.78, 24]} />
            <meshBasicMaterial color="#00ff88" transparent opacity={0.6} />
          </mesh>
        </group>

        {/* Inner Bullseye Solid Pad */}
        <mesh receiveShadow>
          <circleGeometry args={[radius * 0.35, 32]} />
          <meshBasicMaterial color="#00ff88" transparent opacity={0.3} />
        </mesh>
        <mesh position={[0, 0, 0.002]} receiveShadow>
          <ringGeometry args={[radius * 0.32, radius * 0.35, 32]} />
          <meshBasicMaterial color="#00ff88" />
        </mesh>

        {/* 4 Cardinal Crosshair Marks */}
        {[-radius, radius].map((offset, idx) => (
          <mesh key={`cross-x-${idx}`} position={[offset * 0.5, 0, 0]}>
            <planeGeometry args={[0.4, 0.06]} />
            <meshBasicMaterial color="#00ff88" />
          </mesh>
        ))}
        {[-radius, radius].map((offset, idx) => (
          <mesh key={`cross-y-${idx}`} position={[0, offset * 0.5, 0]}>
            <planeGeometry args={[0.06, 0.4]} />
            <meshBasicMaterial color="#00ff88" />
          </mesh>
        ))}
      </group>

      {/* 2. Holographic Vertical Beacon Cylinder */}
      <mesh
        ref={beaconBeamRef}
        position={[0, 3.0, 0]}
      >
        <cylinderGeometry args={[radius * 0.6, radius * 0.9, 6.0, 32, 1, true]} />
        <meshBasicMaterial
          color="#00ff88"
          transparent
          opacity={0.2}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>

      {/* Core Vertical Light Pillar */}
      <mesh position={[0, 2.5, 0]}>
        <cylinderGeometry args={[0.05, 0.05, 5.0, 8]} />
        <meshBasicMaterial color="#a7f3d0" transparent opacity={0.6} />
      </mesh>

      {/* Point Light Casting Ambient Green Glow */}
      <pointLight
        ref={lightRef}
        position={[0, 1.2, 0]}
        color="#00ff88"
        intensity={2.0}
        distance={6}
      />

      {/* 3. High-Visibility Destination Overhead Banner */}
      <group position={[0, 3.8, 0]}>
        {/* Signboard Backing */}
        <mesh castShadow>
          <boxGeometry args={[3.2, 0.6, 0.1]} />
          <meshStandardMaterial color="#0f172a" metalness={0.8} roughness={0.3} />
        </mesh>
        {/* Sign Accent Frame */}
        <mesh position={[0, 0, 0.052]}>
          <planeGeometry args={[3.1, 0.5]} />
          <meshBasicMaterial color="#064e3b" />
        </mesh>
        {/* Delivery Text Bar */}
        <mesh position={[0, 0.05, 0.055]}>
          <planeGeometry args={[2.8, 0.12]} />
          <meshBasicMaterial color="#00ff88" />
        </mesh>
        <mesh position={[0, -0.1, 0.055]}>
          <planeGeometry args={[2.2, 0.08]} />
          <meshBasicMaterial color="#a7f3d0" />
        </mesh>
      </group>
    </group>
  );
};
