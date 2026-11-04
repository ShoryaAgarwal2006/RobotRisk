import React, { useMemo } from 'react';
import { RigidBody, CuboidCollider } from '@react-three/rapier';

interface StorageRackProps {
  position: [number, number, number];
  rotation?: [number, number, number];
  length?: number; // Along Z axis
  depth?: number;  // Along X axis
  height?: number; // Along Y axis
  shelves?: number;
  seed?: number;
}

export const StorageRack: React.FC<StorageRackProps> = ({
  position,
  rotation = [0, 0, 0],
  length = 6.5,
  depth = 1.4,
  height = 4.2,
  shelves = 3,
  seed = 42,
}) => {
  const uprightThickness = 0.08;
  const beamHeight = 0.08;
  const beamWidth = 0.04;

  // Generate deterministic cargo on shelves
  const cargoBoxes = useMemo(() => {
    const boxes: Array<{
      pos: [number, number, number];
      size: [number, number, number];
      color: string;
    }> = [];

    const colors = [
      '#b45309', // Kraft brown cardboard
      '#d97706', // Light carton
      '#78350f', // Dark heavy parcel
      '#0369a1', // Industrial plastic blue bin
      '#0284c7', // Cyan tote
      '#eab308', // Safety yellow crate
      '#334155', // Slate storage tub
    ];

    let rng = seed;
    const random = () => {
      rng = (rng * 9301 + 49297) % 233280;
      return rng / 233280;
    };

    // Shelves from bottom tier (0.2m) to top
    const shelfYPositions = [0.15];
    for (let s = 1; s <= shelves; s++) {
      shelfYPositions.push(0.15 + s * ((height - 0.3) / shelves));
    }

    shelfYPositions.forEach((shelfY) => {
      const numSections = Math.floor(length / 1.5);

      for (let sec = 0; sec < numSections; sec++) {
        if (random() > 0.15) {
          const zBase = -length / 2 + (sec + 0.5) * (length / numSections);
          const boxCount = 1 + Math.floor(random() * 2);

          for (let b = 0; b < boxCount; b++) {
            const bWidth = 0.35 + random() * 0.25;
            const bHeight = 0.28 + random() * 0.35;
            const bDepth = 0.4 + random() * 0.4;

            const offsetX = (random() - 0.5) * (depth - bDepth - 0.1);
            const offsetZ = (random() - 0.5) * 0.3;

            boxes.push({
              pos: [
                offsetX,
                shelfY + bHeight / 2 + beamHeight / 2,
                zBase + offsetZ,
              ],
              size: [bDepth, bHeight, bWidth],
              color: colors[Math.floor(random() * colors.length)],
            });
          }
        }
      }
    });

    return boxes;
  }, [length, depth, height, shelves, seed]);

  return (
    <group position={position} rotation={rotation}>
      {/* 1. Static Physics Collider for Entire Rack Bank (Low friction allows smooth glancing) */}
      <RigidBody
        type="fixed"
        colliders={false}
        friction={0.1}
        restitution={0.0}
        name="StorageRack"
      >
        <CuboidCollider
          args={[depth / 2, height / 2, length / 2]}
          position={[0, height / 2, 0]}
        />
      </RigidBody>

      {/* 2. Visual Structural Geometry */}
      <group>
        {/* Steel Uprights (Columns) */}
        {[-length / 2, -length / 6, length / 6, length / 2].map((zPos, idx) => (
          <group key={`upright-pair-${idx}`} position={[0, height / 2, zPos]}>
            {/* Left Post */}
            <mesh position={[-depth / 2 + uprightThickness / 2, 0, 0]} castShadow>
              <boxGeometry args={[uprightThickness, height, uprightThickness]} />
              <meshStandardMaterial color="#1e3a5f" metalness={0.8} roughness={0.3} />
            </mesh>
            {/* Right Post */}
            <mesh position={[depth / 2 - uprightThickness / 2, 0, 0]} castShadow>
              <boxGeometry args={[uprightThickness, height, uprightThickness]} />
              <meshStandardMaterial color="#1e3a5f" metalness={0.8} roughness={0.3} />
            </mesh>
            {/* Cross bracing between posts */}
            <mesh position={[0, 0, 0]}>
              <boxGeometry args={[depth - uprightThickness * 2, 0.04, 0.02]} />
              <meshStandardMaterial color="#334155" metalness={0.7} />
            </mesh>
          </group>
        ))}

        {/* Horizontal Load Beams & Shelf Decking (Safety Orange) */}
        {/* Ground Tier (0.15m) + Intermediate Shelves */}
        {[0.15, 1.45, 2.75, 4.05].map((shelfY, idx) => (
          <group key={`shelf-${idx}`} position={[0, shelfY, 0]}>
            {/* Front Longitudinal Orange Beam */}
            <mesh position={[depth / 2 - beamWidth / 2, 0, 0]} castShadow>
              <boxGeometry args={[beamWidth, beamHeight, length]} />
              <meshStandardMaterial color="#ea580c" metalness={0.6} roughness={0.4} />
            </mesh>
            {/* Back Longitudinal Orange Beam */}
            <mesh position={[-depth / 2 + beamWidth / 2, 0, 0]} castShadow>
              <boxGeometry args={[beamWidth, beamHeight, length]} />
              <meshStandardMaterial color="#ea580c" metalness={0.6} roughness={0.4} />
            </mesh>
            {/* Shelf Decking Platform */}
            <mesh position={[0, beamHeight / 4, 0]} receiveShadow>
              <boxGeometry args={[depth - 0.08, 0.02, length - 0.08]} />
              <meshStandardMaterial color="#334155" roughness={0.8} metalness={0.4} />
            </mesh>
          </group>
        ))}

        {/* Cargo Crates & Bins Placed on Shelves */}
        {cargoBoxes.map((box, bIdx) => (
          <mesh
            key={`cargo-${bIdx}`}
            position={box.pos}
            castShadow
            receiveShadow
          >
            <boxGeometry args={box.size} />
            <meshStandardMaterial
              color={box.color}
              roughness={0.7}
              metalness={0.2}
            />
          </mesh>
        ))}

        {/* Protective Floor Corner Guards (Yellow) - Contained within rack profile */}
        {[-length / 2 + 0.04, length / 2 - 0.04].map((zEnd, cIdx) => (
          <mesh
            key={`corner-guard-${cIdx}`}
            position={[0, 0.15, zEnd]}
            castShadow
          >
            <boxGeometry args={[depth, 0.3, 0.06]} />
            <meshStandardMaterial
              color="#eab308"
              roughness={0.4}
              metalness={0.6}
            />
          </mesh>
        ))}
      </group>
    </group>
  );
};
