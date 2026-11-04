import React, { useRef, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { RigidBody, CuboidCollider, RapierRigidBody } from '@react-three/rapier';
import * as THREE from 'three';
import { useSimulationStore } from '../../../state/useSimulationStore';
import { AisleBarrier } from '../../../types/simulation';
import { physicsMountRegistry } from '../../PhysicsMountRegistry';

interface AisleBarrierActorProps {
  barrier: AisleBarrier;
  transactionToken: string;
}

const AisleBarrierActor: React.FC<AisleBarrierActorProps> = ({ barrier, transactionToken }) => {
  const rbRef = useRef<RapierRigidBody>(null);
  const removeBarrier = useSimulationStore((s) => s.removeBarrier);
  const addLog = useSimulationStore((s) => s.addLog);

  // Animated beacon strobe
  const beaconLeftRef = useRef<THREE.PointLight>(null);
  const beaconRightRef = useRef<THREE.PointLight>(null);

  useEffect(() => {
    const rb = rbRef.current;
    if (rb && rb.isValid()) {
      physicsMountRegistry.register({
        entityId: barrier.id,
        transactionToken,
        rigidBody: rb,
      });
    }
    return () => {
      if (rb) {
        physicsMountRegistry.unregister({
          entityId: barrier.id,
          transactionToken,
          bodyHandle: rb.handle,
        });
      }
    };
  }, [barrier.id, transactionToken]);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime() * 4;
    const strobe = (Math.sin(t) + 1) / 2 > 0.5 ? 1.5 : 0.1;
    if (beaconLeftRef.current) beaconLeftRef.current.intensity = strobe;
    if (beaconRightRef.current) beaconRightRef.current.intensity = strobe;
  });

  const halfW = barrier.width / 2;
  const halfD = barrier.depth / 2;
  const halfH = barrier.height / 2;

  return (
    <group
      position={barrier.position}
      rotation={[0, barrier.rotation, 0]}
      onClick={(e) => {
        e.stopPropagation();
        removeBarrier(barrier.id);
        addLog(`[BARRIER] Operator clicked and removed barricade from ${barrier.name}`);
      }}
    >
      {/* 1. Static Rapier Rigid Body Collider (Physically impassable barrier) */}
      <RigidBody
        ref={rbRef}
        type="fixed"
        colliders={false}
        name={`AisleBarrier-${barrier.id}`}
        friction={0.8}
        restitution={0.0}
      >
        <CuboidCollider args={[halfW, halfH, halfD]} position={[0, 0, 0]} />
      </RigidBody>

      {/* 2. Visual 3D Barricade Assembly */}
      <group>
        {/* Heavy Concrete Ballast Bases (Left and Right) */}
        <mesh position={[-halfW + 0.35, -halfH + 0.15, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.6, 0.3, 0.7]} />
          <meshStandardMaterial color="#475569" roughness={0.9} />
        </mesh>
        <mesh position={[halfW - 0.35, -halfH + 0.15, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.6, 0.3, 0.7]} />
          <meshStandardMaterial color="#475569" roughness={0.9} />
        </mesh>

        {/* Steel Upright Posts */}
        <mesh position={[-halfW + 0.35, 0, 0]} castShadow>
          <cylinderGeometry args={[0.05, 0.05, barrier.height, 16]} />
          <meshStandardMaterial color="#cbd5e1" metalness={0.8} roughness={0.3} />
        </mesh>
        <mesh position={[halfW - 0.35, 0, 0]} castShadow>
          <cylinderGeometry args={[0.05, 0.05, barrier.height, 16]} />
          <meshStandardMaterial color="#cbd5e1" metalness={0.8} roughness={0.3} />
        </mesh>

        {/* High-Visibility Chevron Warning Board */}
        <mesh position={[0, 0.1, 0]} castShadow>
          <boxGeometry args={[barrier.width - 0.2, 0.7, 0.12]} />
          <meshStandardMaterial
            color="#eab308" // Safety yellow
            roughness={0.4}
            metalness={0.2}
          />
        </mesh>

        {/* Black Hazard Warning Stripes (Segmented) */}
        {[-1.0, -0.6, -0.2, 0.2, 0.6, 1.0].map((offset, idx) => (
          <mesh key={`stripe-${idx}`} position={[offset * (barrier.width / 2.8), 0.1, 0.07]}>
            <boxGeometry args={[0.16, 0.65, 0.02]} />
            <meshStandardMaterial color="#0f172a" roughness={0.5} />
          </mesh>
        ))}

        {/* Twin Amber Warning Beacons on Top */}
        <mesh position={[-halfW + 0.35, halfH + 0.1, 0]}>
          <cylinderGeometry args={[0.08, 0.08, 0.2, 16]} />
          <meshStandardMaterial
            color="#f59e0b"
            emissive="#f59e0b"
            emissiveIntensity={1.2}
            transparent
            opacity={0.9}
          />
        </mesh>
        <mesh position={[halfW - 0.35, halfH + 0.1, 0]}>
          <cylinderGeometry args={[0.08, 0.08, 0.2, 16]} />
          <meshStandardMaterial
            color="#f59e0b"
            emissive="#f59e0b"
            emissiveIntensity={1.2}
            transparent
            opacity={0.9}
          />
        </mesh>

        {/* Point Lights for Flashing Beacon Alert */}
        <pointLight
          ref={beaconLeftRef}
          position={[-halfW + 0.35, halfH + 0.3, 0]}
          color="#f59e0b"
          distance={5}
          intensity={1.0}
        />
        <pointLight
          ref={beaconRightRef}
          position={[halfW - 0.35, halfH + 0.3, 0]}
          color="#f59e0b"
          distance={5}
          intensity={1.0}
        />

        {/* Interactive Removal Hint Label */}
        <mesh position={[0, -0.4, 0.08]}>
          <planeGeometry args={[1.6, 0.2]} />
          <meshBasicMaterial color="#b91c1c" />
        </mesh>
      </group>
    </group>
  );
};

export const AisleBarrierVisualizer: React.FC = () => {
  const activeBarriers = useSimulationStore((s) => s.activeBarriers);
  const stagingTransactionToken = useSimulationStore((s) => s.stagingTransactionToken || 'INIT');

  return (
    <group>
      {activeBarriers.map((barrier) => (
        <AisleBarrierActor
          key={`${barrier.id}:${stagingTransactionToken}`}
          barrier={barrier}
          transactionToken={stagingTransactionToken}
        />
      ))}
    </group>
  );
};
