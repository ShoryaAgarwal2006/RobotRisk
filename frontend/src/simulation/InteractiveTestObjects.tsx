import React, { useRef, useEffect } from 'react';
import { RigidBody, RapierRigidBody, CapsuleCollider, CuboidCollider } from '@react-three/rapier';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useSimulationStore } from '../state/useSimulationStore';
import { InteractiveObject } from '../types/simulation';
import { physicsMountRegistry } from './PhysicsMountRegistry';

interface WorkerProps {
  obj: InteractiveObject;
  isSelected: boolean;
  onSelect: () => void;
  transactionToken: string;
}

const WorkerActor: React.FC<WorkerProps> = ({ obj, isSelected, onSelect, transactionToken }) => {
  const rbRef = useRef<RapierRigidBody>(null);
  const quat = useRef(new THREE.Quaternion());
  const axisY = useRef(new THREE.Vector3(0, 1, 0));
  const registeredHandleRef = useRef<number | null>(null);

  useEffect(() => {
    const rb = rbRef.current;
    if (rb && rb.isValid()) {
      registeredHandleRef.current = rb.handle;
      physicsMountRegistry.register({
        entityId: obj.id,
        transactionToken,
        rigidBody: rb,
      });
    }
    return () => {
      if (registeredHandleRef.current !== null) {
        physicsMountRegistry.unregister({
          entityId: obj.id,
          transactionToken,
          bodyHandle: registeredHandleRef.current,
        });
        registeredHandleRef.current = null;
      }
    };
  }, [obj.id, transactionToken]);

  useFrame(() => {
    const rb = rbRef.current;
    if (!rb) return;

    if (rb.isValid() && registeredHandleRef.current === null) {
      registeredHandleRef.current = rb.handle;
      physicsMountRegistry.register({
        entityId: obj.id,
        transactionToken,
        rigidBody: rb,
      });
    }

    // Kinematic translation to current simulation coordinates
    rb.setNextKinematicTranslation({
      x: obj.position[0],
      y: obj.position[1],
      z: obj.position[2],
    });

    // Kinematic orientation facing patrol direction
    quat.current.setFromAxisAngle(axisY.current, obj.rotation || 0);
    rb.setNextKinematicRotation(quat.current);
  });

  return (
    <RigidBody
      ref={rbRef}
      type="kinematicPosition"
      colliders={false}
      position={obj.position}
      name={obj.name || 'Warehouse Worker'}
    >
      {/* Physical Collider: Capsule covering full human bounding cylinder */}
      <CapsuleCollider args={[0.5, 0.28]} position={[0, 0.1, 0]} />

      <group onClick={(e) => { e.stopPropagation(); onSelect(); }}>
        {/* 1. Legs (Navy Trousers) */}
        <mesh position={[-0.11, -0.32, 0]} castShadow>
          <cylinderGeometry args={[0.07, 0.08, 0.55, 12]} />
          <meshStandardMaterial color="#1e293b" roughness={0.7} />
        </mesh>
        <mesh position={[0.11, -0.32, 0]} castShadow>
          <cylinderGeometry args={[0.07, 0.08, 0.55, 12]} />
          <meshStandardMaterial color="#1e293b" roughness={0.7} />
        </mesh>

        {/* 2. Safety Boots (Black Steel-Toe) */}
        <mesh position={[-0.11, -0.58, 0.04]} castShadow>
          <boxGeometry args={[0.12, 0.1, 0.2]} />
          <meshStandardMaterial color="#0f172a" roughness={0.8} />
        </mesh>
        <mesh position={[0.11, -0.58, 0.04]} castShadow>
          <boxGeometry args={[0.12, 0.1, 0.2]} />
          <meshStandardMaterial color="#0f172a" roughness={0.8} />
        </mesh>

        {/* 3. Torso (High-Visibility Safety Orange Vest) */}
        <mesh position={[0, 0.12, 0]} castShadow>
          <boxGeometry args={[0.38, 0.45, 0.22]} />
          <meshStandardMaterial
            color="#f97316"
            roughness={0.4}
            emissive="#ea580c"
            emissiveIntensity={isSelected ? 0.5 : 0.2}
          />
        </mesh>

        {/* Reflective Safety Stripes on Vest (Silver/Neon Green) */}
        <mesh position={[0, 0.18, 0.115]}>
          <boxGeometry args={[0.36, 0.04, 0.01]} />
          <meshStandardMaterial color="#84cc16" emissive="#84cc16" emissiveIntensity={0.6} />
        </mesh>
        <mesh position={[0, 0.04, 0.115]}>
          <boxGeometry args={[0.36, 0.04, 0.01]} />
          <meshStandardMaterial color="#f1f5f9" emissive="#f1f5f9" emissiveIntensity={0.5} />
        </mesh>

        {/* 4. Head & Face */}
        <mesh position={[0, 0.46, 0]} castShadow>
          <sphereGeometry args={[0.12, 16, 16]} />
          <meshStandardMaterial color="#fed7aa" roughness={0.6} />
        </mesh>

        {/* 5. Industrial Safety Hardhat (Bright Yellow) */}
        <group position={[0, 0.53, 0]}>
          {/* Hardhat Dome */}
          <mesh castShadow>
            <sphereGeometry args={[0.14, 16, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshStandardMaterial color="#eab308" metalness={0.2} roughness={0.3} />
          </mesh>
          {/* Hardhat Brim */}
          <mesh position={[0, 0, 0.04]}>
            <cylinderGeometry args={[0.17, 0.17, 0.02, 16]} />
            <meshStandardMaterial color="#ca8a04" roughness={0.4} />
          </mesh>
        </group>

        {/* Selection Ring */}
        {isSelected && (
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.62, 0]}>
            <ringGeometry args={[0.4, 0.55, 32]} />
            <meshBasicMaterial color="#00f0ff" side={THREE.DoubleSide} transparent opacity={0.9} />
          </mesh>
        )}
      </group>
    </RigidBody>
  );
};

interface ForkliftProps {
  obj: InteractiveObject;
  isSelected: boolean;
  onSelect: () => void;
  transactionToken: string;
}

const ForkliftActor: React.FC<ForkliftProps> = ({ obj, isSelected, onSelect, transactionToken }) => {
  const rbRef = useRef<RapierRigidBody>(null);
  const quat = useRef(new THREE.Quaternion());
  const axisY = useRef(new THREE.Vector3(0, 1, 0));
  const beaconLightRef = useRef<THREE.PointLight>(null);
  const beaconMeshRef = useRef<THREE.Mesh>(null);
  const registeredHandleRef = useRef<number | null>(null);

  useEffect(() => {
    const rb = rbRef.current;
    if (rb && rb.isValid()) {
      registeredHandleRef.current = rb.handle;
      physicsMountRegistry.register({
        entityId: obj.id,
        transactionToken,
        rigidBody: rb,
      });
    }
    return () => {
      if (registeredHandleRef.current !== null) {
        physicsMountRegistry.unregister({
          entityId: obj.id,
          transactionToken,
          bodyHandle: registeredHandleRef.current,
        });
        registeredHandleRef.current = null;
      }
    };
  }, [obj.id, transactionToken]);

  useFrame((state) => {
    const rb = rbRef.current;
    if (!rb) return;

    if (rb.isValid() && registeredHandleRef.current === null) {
      registeredHandleRef.current = rb.handle;
      physicsMountRegistry.register({
        entityId: obj.id,
        transactionToken,
        rigidBody: rb,
      });
    }

    // Kinematic translation to authoritative simulation coordinates
    rb.setNextKinematicTranslation({
      x: obj.position[0],
      y: obj.position[1],
      z: obj.position[2],
    });

    // Kinematic orientation facing patrol direction
    quat.current.setFromAxisAngle(axisY.current, obj.rotation || 0);
    rb.setNextKinematicRotation(quat.current);

    // Strobe / rotation animation for amber warning beacon
    const time = state.clock.getElapsedTime();
    if (beaconLightRef.current) {
      beaconLightRef.current.intensity = 1.4 + Math.sin(time * 12.0) * 1.1;
    }
    if (beaconMeshRef.current) {
      beaconMeshRef.current.rotation.y = time * 8.0;
    }
  });

  return (
    <RigidBody
      ref={rbRef}
      type="kinematicPosition"
      colliders={false}
      position={obj.position}
      name={obj.name || 'Heavy Industrial Forklift'}
    >
      {/* 
        Physically aligned Rapier Colliders:
        1. Main Chassis, Counterweight & Protective Overhead Cage:
           Half-extents: W=0.50m (span 1.0m), H=0.95m (span 1.9m), L=0.70m (span 1.4m), offset [0, 0.95, -0.10]
        2. Low-Profile Front Forks & Mast Carriage:
           Half-extents: W=0.38m (span 0.76m), H=0.08m (span 0.16m), L=0.45m (span 0.9m), offset [0, 0.08, 1.05]
      */}
      <CuboidCollider args={[0.50, 0.95, 0.70]} position={[0, 0.95, -0.10]} />
      <CuboidCollider args={[0.38, 0.08, 0.45]} position={[0, 0.08, 1.05]} />

      <group onClick={(e) => { e.stopPropagation(); onSelect(); }}>
        {/* === 1. LOWER SKIRT & CHASSIS UNDERTRAY === */}
        <mesh position={[0, 0.12, -0.10]} castShadow>
          <boxGeometry args={[0.96, 0.14, 1.40]} />
          <meshStandardMaterial color="#0f172a" roughness={0.8} />
        </mesh>

        {/* === 2. INDUSTRIAL SAFETY YELLOW CHASSIS & COUNTERWEIGHT === */}
        {/* Main Body */}
        <mesh position={[0, 0.48, -0.05]} castShadow>
          <boxGeometry args={[0.92, 0.58, 1.15]} />
          <meshStandardMaterial
            color="#eab308"
            metalness={0.25}
            roughness={0.4}
            emissive={isSelected ? '#00f0ff' : '#ca8a04'}
            emissiveIntensity={isSelected ? 0.35 : 0.08}
          />
        </mesh>

        {/* Heavy Rear Counterweight with Rounded Chamfer */}
        <mesh position={[0, 0.52, -0.72]} castShadow>
          <boxGeometry args={[0.90, 0.62, 0.32]} />
          <meshStandardMaterial color="#ca8a04" metalness={0.4} roughness={0.5} />
        </mesh>

        {/* Diagonal Safety Hazard Stripes on Rear Counterweight */}
        {[-0.32, -0.16, 0, 0.16, 0.32].map((xOffset, idx) => (
          <mesh key={`stripe-${idx}`} position={[xOffset, 0.52, -0.885]}>
            <boxGeometry args={[0.07, 0.45, 0.01]} />
            <meshStandardMaterial color={idx % 2 === 0 ? '#0f172a' : '#facc15'} roughness={0.6} />
          </mesh>
        ))}

        {/* === 3. FOUR HEAVY INDUSTRIAL RUBBER WHEELS === */}
        {/* Front Drive Wheels */}
        {[-0.49, 0.49].map((xOffset, idx) => (
          <group key={`front-wheel-${idx}`} position={[xOffset, 0.26, 0.45]}>
            <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
              <cylinderGeometry args={[0.26, 0.26, 0.14, 16]} />
              <meshStandardMaterial color="#0f172a" roughness={0.9} />
            </mesh>
            <mesh rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[0.14, 0.14, 0.15, 12]} />
              <meshStandardMaterial color="#64748b" metalness={0.6} roughness={0.3} />
            </mesh>
          </group>
        ))}

        {/* Rear Steer Wheels */}
        {[-0.46, 0.46].map((xOffset, idx) => (
          <group key={`rear-wheel-${idx}`} position={[xOffset, 0.22, -0.65]}>
            <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
              <cylinderGeometry args={[0.22, 0.22, 0.12, 16]} />
              <meshStandardMaterial color="#0f172a" roughness={0.9} />
            </mesh>
            <mesh rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[0.11, 0.11, 0.13, 12]} />
              <meshStandardMaterial color="#64748b" metalness={0.6} roughness={0.3} />
            </mesh>
          </group>
        ))}

        {/* === 4. VERTICAL TELESCOPIC MAST & CARRIAGE === */}
        {/* Twin Vertical Steel I-Beam Mast Channels */}
        {[-0.34, 0.34].map((xOffset, idx) => (
          <mesh key={`mast-column-${idx}`} position={[xOffset, 1.05, 0.65]} castShadow>
            <boxGeometry args={[0.07, 1.95, 0.08]} />
            <meshStandardMaterial color="#334155" metalness={0.7} roughness={0.3} />
          </mesh>
        ))}

        {/* Horizontal Cross-Braces on Mast */}
        {[0.45, 1.15, 1.85].map((yOffset, idx) => (
          <mesh key={`mast-brace-${idx}`} position={[0, yOffset, 0.65]}>
            <boxGeometry args={[0.72, 0.05, 0.03]} />
            <meshStandardMaterial color="#1e293b" metalness={0.6} />
          </mesh>
        ))}

        {/* Central Hydraulic Lift Ram */}
        <mesh position={[0, 0.95, 0.62]}>
          <cylinderGeometry args={[0.035, 0.035, 1.75, 12]} />
          <meshStandardMaterial color="#94a3b8" metalness={0.9} roughness={0.1} />
        </mesh>

        {/* Fork Carriage Plate */}
        <mesh position={[0, 0.28, 0.70]} castShadow>
          <boxGeometry args={[0.82, 0.32, 0.04]} />
          <meshStandardMaterial color="#1e293b" metalness={0.5} roughness={0.6} />
        </mesh>

        {/* === 5. TWO FRONT STEEL FORKS (TINES) === */}
        {[-0.24, 0.24].map((xOffset, idx) => (
          <group key={`fork-tine-${idx}`}>
            {/* Vertical Shank clamped to Carriage */}
            <mesh position={[xOffset, 0.24, 0.73]} castShadow>
              <boxGeometry args={[0.08, 0.38, 0.035]} />
              <meshStandardMaterial color="#0f172a" metalness={0.8} roughness={0.3} />
            </mesh>
            {/* Horizontal Blade extending forward along floor */}
            <mesh position={[xOffset, 0.03, 1.18]} castShadow>
              <boxGeometry args={[0.08, 0.035, 0.88]} />
              <meshStandardMaterial color="#1e293b" metalness={0.8} roughness={0.2} />
            </mesh>
            {/* Tapered Fork Tip */}
            <mesh position={[xOffset, 0.025, 1.64]} castShadow>
              <boxGeometry args={[0.078, 0.02, 0.06]} />
              <meshStandardMaterial color="#334155" metalness={0.8} />
            </mesh>
          </group>
        ))}

        {/* === 6. DRIVER CABIN & PROTECTIVE OVERHEAD GUARD (FOPS/ROPS) === */}
        {[
          [-0.38, -0.55],
          [0.38, -0.55],
          [-0.38, 0.35],
          [0.38, 0.35],
        ].map(([px, pz], idx) => (
          <mesh key={`pillar-${idx}`} position={[px, 1.45, pz]} castShadow>
            <cylinderGeometry args={[0.03, 0.03, 1.35, 8]} />
            <meshStandardMaterial color="#1e293b" metalness={0.7} roughness={0.4} />
          </mesh>
        ))}

        {/* Overhead Steel Roof Guard */}
        <mesh position={[0, 2.12, -0.10]} castShadow>
          <boxGeometry args={[0.82, 0.04, 0.98]} />
          <meshStandardMaterial color="#0f172a" metalness={0.5} roughness={0.5} />
        </mesh>
        {[-0.30, -0.15, 0, 0.15, 0.30].map((zOffset, idx) => (
          <mesh key={`grille-slot-${idx}`} position={[0, 2.13, -0.10 + zOffset]}>
            <boxGeometry args={[0.72, 0.05, 0.06]} />
            <meshStandardMaterial color="#334155" metalness={0.6} />
          </mesh>
        ))}

        {/* Operator Seat */}
        <group position={[0, 0.78, -0.15]}>
          <mesh position={[0, 0, 0]}>
            <boxGeometry args={[0.42, 0.14, 0.38]} />
            <meshStandardMaterial color="#1e293b" roughness={0.9} />
          </mesh>
          <mesh position={[0, 0.22, -0.16]}>
            <boxGeometry args={[0.40, 0.32, 0.08]} />
            <meshStandardMaterial color="#0f172a" roughness={0.8} />
          </mesh>
        </group>

        {/* Steering Console & Wheel */}
        <group position={[0, 0.88, 0.20]} rotation={[-0.35, 0, 0]}>
          <mesh position={[0, 0, 0]}>
            <cylinderGeometry args={[0.03, 0.04, 0.32, 8]} />
            <meshStandardMaterial color="#334155" metalness={0.5} />
          </mesh>
          <mesh position={[0, 0.16, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.13, 0.02, 8, 16]} />
            <meshStandardMaterial color="#0f172a" roughness={0.7} />
          </mesh>
        </group>

        {/* Front Headlights */}
        {[-0.36, 0.36].map((xOffset, idx) => (
          <mesh key={`headlight-${idx}`} position={[xOffset, 0.80, 0.52]}>
            <boxGeometry args={[0.08, 0.08, 0.04]} />
            <meshStandardMaterial color="#f8fafc" emissive="#f8fafc" emissiveIntensity={0.8} />
          </mesh>
        ))}

        {/* === 7. ROTATING AMBER WARNING BEACON === */}
        <group position={[0, 2.18, -0.45]}>
          <mesh position={[0, 0, 0]}>
            <cylinderGeometry args={[0.06, 0.07, 0.04, 12]} />
            <meshStandardMaterial color="#1e293b" metalness={0.7} />
          </mesh>
          <mesh ref={beaconMeshRef} position={[0, 0.06, 0]}>
            <cylinderGeometry args={[0.05, 0.05, 0.09, 12]} />
            <meshStandardMaterial
              color="#f59e0b"
              emissive="#f59e0b"
              emissiveIntensity={1.8}
              transparent
              opacity={0.88}
              roughness={0.2}
            />
          </mesh>
          <pointLight
            ref={beaconLightRef}
            position={[0, 0.12, 0]}
            color="#f59e0b"
            intensity={2.2}
            distance={5.5}
            decay={2}
          />
        </group>

        {/* === 8. SELECTION HIGHLIGHT RING === */}
        {isSelected && (
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
            <ringGeometry args={[1.15, 1.35, 32]} />
            <meshBasicMaterial color="#00f0ff" side={THREE.DoubleSide} transparent opacity={0.9} />
          </mesh>
        )}
      </group>
    </RigidBody>
  );
};

interface DynamicHazardProps {
  obj: InteractiveObject;
  isSelected: boolean;
  onSelect: () => void;
  transactionToken: string;
}

const DynamicHazardActor: React.FC<DynamicHazardProps> = ({ obj, isSelected, onSelect, transactionToken }) => {
  const rbRef = useRef<RapierRigidBody>(null);
  const addLog = useSimulationStore((s) => s.addLog);
  const registeredHandleRef = useRef<number | null>(null);

  useEffect(() => {
    const rb = rbRef.current;
    if (rb && rb.isValid()) {
      registeredHandleRef.current = rb.handle;
      physicsMountRegistry.register({
        entityId: obj.id,
        transactionToken,
        rigidBody: rb,
      });
    }
    return () => {
      if (registeredHandleRef.current !== null) {
        physicsMountRegistry.unregister({
          entityId: obj.id,
          transactionToken,
          bodyHandle: registeredHandleRef.current,
        });
        registeredHandleRef.current = null;
      }
    };
  }, [obj.id, transactionToken]);

  useFrame(() => {
    const rb = rbRef.current;
    if (rb && rb.isValid() && registeredHandleRef.current === null) {
      registeredHandleRef.current = rb.handle;
      physicsMountRegistry.register({
        entityId: obj.id,
        transactionToken,
        rigidBody: rb,
      });
    }
  });

  return (
    <RigidBody
      ref={rbRef}
      key={obj.id}
      position={obj.position}
      rotation={obj.rotation ? [0, obj.rotation, 0] : undefined}
      colliders={obj.type === 'sphere' ? 'ball' : 'cuboid'}
      restitution={0.2}
      friction={0.6}
      name={obj.name || `Dynamic-${obj.type}`}
      onCollisionEnter={(payload) => {
        const other = payload.other.rigidBodyObject?.name || 'surface';
        if (other !== 'surface' && other !== 'Ground') {
          addLog(`[PHYSICS] ${obj.name || obj.type} collided with ${other}`);
        }
      }}
    >
      <group
        onClick={(e) => {
          e.stopPropagation();
          onSelect();
        }}
      >
        {obj.type === 'sphere' ? (
          <mesh castShadow receiveShadow>
            <sphereGeometry args={[obj.size, 32, 32]} />
            <meshStandardMaterial
              color={obj.color}
              roughness={0.25}
              metalness={0.5}
              emissive={isSelected ? '#00f0ff' : obj.color}
              emissiveIntensity={isSelected ? 0.6 : 0.2}
            />
          </mesh>
        ) : (
          <mesh castShadow receiveShadow>
            <boxGeometry args={[obj.size, obj.size, obj.size]} />
            <meshStandardMaterial
              color={obj.color}
              roughness={0.3}
              metalness={0.3}
              emissive={isSelected ? '#00f0ff' : obj.color}
              emissiveIntensity={isSelected ? 0.6 : 0.15}
            />
          </mesh>
        )}

        {/* Selection Ring */}
        {isSelected && (
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -obj.size / 2 + 0.05, 0]}>
            <ringGeometry args={[obj.size * 0.9, obj.size * 1.15, 32]} />
            <meshBasicMaterial color="#00f0ff" side={THREE.DoubleSide} transparent opacity={0.9} />
          </mesh>
        )}
      </group>
    </RigidBody>
  );
};

export const InteractiveTestObjects: React.FC = () => {
  const objects = useSimulationStore((s) => s.interactiveObjects);
  const selectedObjectId = useSimulationStore((s) => s.selectedObjectId);
  const selectObject = useSimulationStore((s) => s.selectObject);
  const addLog = useSimulationStore((s) => s.addLog);
  const stagingTransactionToken = useSimulationStore((s) => s.stagingTransactionToken || 'INIT');

  return (
    <group>
      {objects.map((obj) => {
        const isSelected = selectedObjectId === obj.id;
        const key = `${obj.id}:${stagingTransactionToken}`;

        // Custom Kinematic Actor for Moving Warehouse Workers
        if (obj.type === 'worker') {
          return (
            <WorkerActor
              key={key}
              obj={obj}
              isSelected={isSelected}
              transactionToken={stagingTransactionToken}
              onSelect={() => {
                selectObject(obj.id);
                addLog(`[SELECTION] Selected ${obj.name} at [${obj.position[0].toFixed(1)}, ${obj.position[2].toFixed(1)}]`);
              }}
            />
          );
        }

        // Custom Kinematic Actor for Heavy Industrial Forklifts
        if (obj.type === 'forklift') {
          return (
            <ForkliftActor
              key={key}
              obj={obj}
              isSelected={isSelected}
              transactionToken={stagingTransactionToken}
              onSelect={() => {
                selectObject(obj.id);
                addLog(`[SELECTION] Selected ${obj.name || 'Heavy Industrial Forklift'} at [${obj.position[0].toFixed(1)}, ${obj.position[2].toFixed(1)}]`);
              }}
            />
          );
        }

        // Standard Dynamic Rigidbody for Boxes and Spheres
        return (
          <DynamicHazardActor
            key={key}
            obj={obj}
            isSelected={isSelected}
            transactionToken={stagingTransactionToken}
            onSelect={() => {
              selectObject(obj.id);
              addLog(`[SELECTION] Selected ${obj.name || obj.type} at [${obj.position[0].toFixed(1)}, ${obj.position[2].toFixed(1)}]`);
            }}
          />
        );
      })}
    </group>
  );
};
