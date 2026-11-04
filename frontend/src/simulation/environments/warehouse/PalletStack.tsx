import React from 'react';
import { RigidBody, CuboidCollider } from '@react-three/rapier';

interface PalletStackProps {
  position: [number, number, number];
  rotation?: [number, number, number];
  tierCount?: number;
  boxColor?: string;
}

export const PalletStack: React.FC<PalletStackProps> = ({
  position,
  rotation = [0, 0, 0],
  tierCount = 2,
  boxColor = '#b45309',
}) => {
  const palletWidth = 1.2;
  const palletLength = 0.8;
  const palletHeight = 0.14;
  const tierHeight = 0.6;

  const totalHeight = palletHeight + tierCount * tierHeight;

  return (
    <group position={position} rotation={rotation}>
      {/* Static Physics Collider */}
      <RigidBody
        type="fixed"
        colliders={false}
        friction={0.8}
        restitution={0.05}
        name="PalletStack"
      >
        <CuboidCollider
          args={[palletWidth / 2, totalHeight / 2, palletLength / 2]}
          position={[0, totalHeight / 2, 0]}
        />
      </RigidBody>

      {/* Wooden Euro-Pallet Base */}
      <group position={[0, palletHeight / 2, 0]}>
        {/* Top Deck Boards */}
        {[-0.32, -0.16, 0, 0.16, 0.32].map((zPos, idx) => (
          <mesh key={`deck-${idx}`} position={[0, 0.05, zPos]} castShadow receiveShadow>
            <boxGeometry args={[palletWidth, 0.02, 0.12]} />
            <meshStandardMaterial color="#854d0e" roughness={0.9} />
          </mesh>
        ))}

        {/* 3 Stringer Blocks */}
        {[-0.52, 0, 0.52].map((xPos, idx) => (
          <group key={`stringer-${idx}`} position={[xPos, -0.01, 0]}>
            <mesh castShadow receiveShadow>
              <boxGeometry args={[0.1, 0.08, palletLength]} />
              <meshStandardMaterial color="#713f12" roughness={0.9} />
            </mesh>
          </group>
        ))}

        {/* Bottom Skid Boards */}
        {[-0.52, 0, 0.52].map((xPos, idx) => (
          <mesh key={`skid-${idx}`} position={[xPos, -0.06, 0]} receiveShadow>
            <boxGeometry args={[0.1, 0.02, palletLength]} />
            <meshStandardMaterial color="#854d0e" roughness={0.9} />
          </mesh>
        ))}
      </group>

      {/* Stacked Cargo Boxes on Pallet */}
      {Array.from({ length: tierCount }).map((_, tier) => {
        const yBase = palletHeight + tier * tierHeight;
        return (
          <group key={`tier-${tier}`} position={[0, yBase + tierHeight / 2, 0]}>
            {/* 4 Boxes arranged in a 2x2 grid per tier */}
            {[-0.26, 0.26].map((bx, xi) =>
              [-0.18, 0.18].map((bz, zi) => (
                <mesh
                  key={`box-${tier}-${xi}-${zi}`}
                  position={[bx, 0, bz]}
                  castShadow
                  receiveShadow
                >
                  <boxGeometry args={[0.48, tierHeight - 0.04, 0.32]} />
                  <meshStandardMaterial
                    color={boxColor}
                    roughness={0.75}
                    metalness={0.1}
                  />
                </mesh>
              ))
            )}
          </group>
        );
      })}
    </group>
  );
};
