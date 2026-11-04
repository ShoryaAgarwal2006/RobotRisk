import React, { useRef, useState, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { RigidBody, CuboidCollider, RapierRigidBody } from '@react-three/rapier';
import { useSimulationStore } from '../state/useSimulationStore';

export const FallingPalletHazard: React.FC = () => {
  const hazard = useSimulationStore((s) => s.fallingPalletHazard);
  const robotPose = useSimulationStore((s) => s.robotPose);
  const isRunning = useSimulationStore((s) => s.isRunning);
  const triggerDrop = useSimulationStore((s) => s.triggerFallingPalletDrop);
  const recordImpact = useSimulationStore((s) => s.recordFallingPalletImpact);

  const rigidBodyRef = useRef<RapierRigidBody>(null);
  const [hasCollided, setHasCollided] = useState(false);

  // Reset collision flag & restore suspended physics state when hazard restarts
  useEffect(() => {
    if (!hazard.isDropped) {
      setHasCollided(false);
      const rb = rigidBodyRef.current;
      if (rb) {
        rb.setTranslation(
          { x: hazard.palletPosition[0], y: hazard.palletPosition[1], z: hazard.palletPosition[2] },
          true
        );
        rb.setLinvel({ x: 0, y: 0, z: 0 }, true);
        rb.setAngvel({ x: 0, y: 0, z: 0 }, true);
        rb.sleep();
      }
    }
  }, [hazard.isDropped, hazard.isActive, hazard.palletPosition]);

  useFrame(() => {
    if (!hazard.isActive || !isRunning) return;
    const rb = rigidBodyRef.current;
    if (!rb) return;

    if (!hazard.isDropped) {
      // Hold firmly suspended at ceiling rigging position
      rb.setTranslation(
        { x: hazard.palletPosition[0], y: hazard.palletPosition[1], z: hazard.palletPosition[2] },
        false
      );
      rb.setLinvel({ x: 0, y: 0, z: 0 }, false);
      rb.setAngvel({ x: 0, y: 0, z: 0 }, false);

      // Check proximity trigger: robot within 3.0m of pallet horizontal position
      const dx = robotPose.position[0] - hazard.palletPosition[0];
      const dz = robotPose.position[2] - hazard.palletPosition[2];
      const distHoriz = Math.hypot(dx, dz);

      if (distHoriz <= hazard.triggerDistance) {
        triggerDrop();
        rb.wakeUp();
      }
    }
  });

  if (!hazard.isActive) return null;

  const [px, py, pz] = hazard.palletPosition;
  const [width, height, depth] = hazard.palletSize;

  return (
    <group>
      {/* 1. Overhead Suspension Rigging & Steel Cables (Visible when suspended) */}
      {!hazard.isDropped && (
        <group>
          {/* Ceiling Crossbeam Anchor at Y=5.4m */}
          <mesh position={[px, 5.4, pz]} castShadow>
            <boxGeometry args={[1.6, 0.2, 0.3]} />
            <meshStandardMaterial color="#334155" metalness={0.8} roughness={0.3} />
          </mesh>
          {/* Warning Strobe on Anchor */}
          <pointLight position={[px, 5.2, pz]} color="#f59e0b" intensity={2.0} distance={6} />

          {/* 4 Steel Wire Suspension Cables from ceiling to 4 corners of pallet */}
          <lineSegments>
            <bufferGeometry>
              <float32BufferAttribute
                attach="attributes-position"
                args={[
                  new Float32Array([
                    // Corner 1: [-0.5, 5.4, -0.5] to [-0.5, py, -0.5]
                    px - 0.5, 5.4, pz - 0.5, px - 0.5, py + 0.12, pz - 0.5,
                    // Corner 2: [0.5, 5.4, -0.5] to [0.5, py, -0.5]
                    px + 0.5, 5.4, pz - 0.5, px + 0.5, py + 0.12, pz - 0.5,
                    // Corner 3: [-0.5, 5.4, 0.5] to [-0.5, py, 0.5]
                    px - 0.5, 5.4, pz + 0.5, px - 0.5, py + 0.12, pz + 0.5,
                    // Corner 4: [0.5, 5.4, 0.5] to [0.5, py, 0.5]
                    px + 0.5, 5.4, pz + 0.5, px + 0.5, py + 0.12, pz + 0.5,
                  ]),
                  3,
                ]}
              />
            </bufferGeometry>
            <lineBasicMaterial color="#94a3b8" />
          </lineSegments>
        </group>
      )}

      {/* 2. Physical 3D RigidBody Pallet */}
      <RigidBody
        ref={rigidBodyRef}
        type="dynamic"
        colliders={false}
        position={hazard.palletPosition}
        mass={250} // Heavy 250kg industrial load
        restitution={0.05} // Low bounciness, high impact absorption
        friction={0.8}
        canSleep={false}
        name="Heavy-Overhead-Cargo-Pallet"
        onCollisionEnter={(payload) => {
          const otherName = payload.other.rigidBodyObject?.name || '';
          if (otherName === 'RobotRisk-AMR' && !hasCollided) {
            setHasCollided(true);
            const vel = rigidBodyRef.current ? rigidBodyRef.current.linvel() : { x: 0, y: -7.5, z: 0 };
            const speed = Math.hypot(vel.x, vel.y, vel.z);
            const impulse = Math.max(150.0, 250 * speed); // Force in Newtons (F = m*v / dt or impulse)
            recordImpact(impulse);
          }
        }}
      >
        {/* Physical Cuboid Collider: half-extents covering entire pallet footprint */}
        <CuboidCollider
          args={[width / 2, height / 2, depth / 2]}
          position={[0, 0, 0]}
          restitution={0.05}
          friction={0.8}
        />

        {/* 3D Realistic Industrial Wooden Pallet Mesh */}
        <group>
          {/* Main Timber Body */}
          <mesh castShadow receiveShadow>
            <boxGeometry args={[width, height, depth]} />
            <meshStandardMaterial color="#854d0e" roughness={0.8} metalness={0.1} />
          </mesh>

          {/* Top Deck Slats (7 Wooden Planks) */}
          {[-0.5, -0.33, -0.17, 0, 0.17, 0.33, 0.5].map((zOffset, idx) => (
            <mesh key={`plank-${idx}`} position={[0, height / 2 + 0.015, zOffset]} castShadow>
              <boxGeometry args={[width - 0.02, 0.025, 0.12]} />
              <meshStandardMaterial color="#a16207" roughness={0.7} />
            </mesh>
          ))}

          {/* Bottom Skids (3 Stringers) */}
          {[-0.5, 0, 0.5].map((xOffset, idx) => (
            <mesh key={`skid-${idx}`} position={[xOffset, -height / 2 - 0.015, 0]} castShadow>
              <boxGeometry args={[0.12, 0.025, depth - 0.02]} />
              <meshStandardMaterial color="#713f12" roughness={0.9} />
            </mesh>
          ))}

          {/* Steel Corner Reinforcements */}
          {[
            [-width / 2, 0, -depth / 2],
            [width / 2, 0, -depth / 2],
            [-width / 2, 0, depth / 2],
            [width / 2, 0, depth / 2],
          ].map(([cx, cy, cz], idx) => (
            <mesh key={`bracket-${idx}`} position={[cx, cy, cz]}>
              <boxGeometry args={[0.08, height + 0.02, 0.08]} />
              <meshStandardMaterial color="#334155" metalness={0.9} roughness={0.2} />
            </mesh>
          ))}

          {/* Yellow/Black Safety Chevron Decals on 2 Sides */}
          <mesh position={[0, 0, depth / 2 + 0.005]}>
            <planeGeometry args={[width - 0.1, height * 0.7]} />
            <meshStandardMaterial color="#eab308" roughness={0.4} />
          </mesh>
          <mesh position={[0, 0, -depth / 2 - 0.005]} rotation={[0, Math.PI, 0]}>
            <planeGeometry args={[width - 0.1, height * 0.7]} />
            <meshStandardMaterial color="#eab308" roughness={0.4} />
          </mesh>

          {/* Flashing Amber Hazard Beacon atop pallet */}
          <mesh position={[0, height / 2 + 0.08, 0]}>
            <cylinderGeometry args={[0.06, 0.07, 0.1, 16]} />
            <meshStandardMaterial color="#f59e0b" emissive="#d97706" emissiveIntensity={0.8} />
          </mesh>
          <pointLight position={[0, height / 2 + 0.15, 0]} color="#f59e0b" intensity={1.5} distance={4} />
        </group>
      </RigidBody>
    </group>
  );
};
