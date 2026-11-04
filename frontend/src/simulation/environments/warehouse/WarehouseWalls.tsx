import React from 'react';
import { RigidBody, CuboidCollider } from '@react-three/rapier';

interface WarehouseWallsProps {
  width: number;  // X span (e.g. 40)
  length: number; // Z span (e.g. 32)
  height: number; // Y span (e.g. 5.5)
}

export const WarehouseWalls: React.FC<WarehouseWallsProps> = ({
  width,
  length,
  height,
}) => {
  const wallThickness = 0.6;
  const halfW = width / 2;
  const halfL = length / 2;

  // Structural column locations along the grid
  const columnPositions: [number, number][] = [
    [-halfW + 0.5, -halfL + 0.5],
    [-halfW + 0.5, 0],
    [-halfW + 0.5, halfL - 0.5],
    [halfW - 0.5, -halfL + 0.5],
    [halfW - 0.5, 0],
    [halfW - 0.5, halfL - 0.5],
    [-halfW / 2, -halfL + 0.5],
    [0, -halfL + 0.5],
    [halfW / 2, -halfL + 0.5],
    [-halfW / 2, halfL - 0.5],
    [0, halfL - 0.5],
    [halfW / 2, halfL - 0.5],
  ];

  return (
    <group>
      {/* 1. Static Physics Colliders for 4 Perimeter Walls */}
      <RigidBody
        type="fixed"
        colliders={false}
        friction={0.6}
        restitution={0.05}
        name="WarehousePerimeterWalls"
      >
        {/* North Wall (-Z) */}
        <CuboidCollider
          args={[halfW, height / 2, wallThickness / 2]}
          position={[0, height / 2, -halfL - wallThickness / 2]}
        />
        {/* South Wall (+Z) */}
        <CuboidCollider
          args={[halfW, height / 2, wallThickness / 2]}
          position={[0, height / 2, halfL + wallThickness / 2]}
        />
        {/* West Wall (-X) */}
        <CuboidCollider
          args={[wallThickness / 2, height / 2, halfL]}
          position={[-halfW - wallThickness / 2, height / 2, 0]}
        />
        {/* East Wall (+X) */}
        <CuboidCollider
          args={[wallThickness / 2, height / 2, halfL]}
          position={[halfW + wallThickness / 2, height / 2, 0]}
        />
      </RigidBody>

      {/* 2. Visual Wall Meshes */}
      {/* North Wall */}
      <group position={[0, height / 2, -halfL]}>
        {/* Lower Concrete Foundation Base */}
        <mesh position={[0, -height / 2 + 0.5, 0]} receiveShadow>
          <boxGeometry args={[width, 1.0, 0.4]} />
          <meshStandardMaterial color="#1e293b" roughness={0.9} />
        </mesh>
        {/* Upper Siding Wall */}
        <mesh position={[0, 0.5, 0]} receiveShadow>
          <boxGeometry args={[width, height - 1.0, 0.3]} />
          <meshStandardMaterial color="#0f172a" roughness={0.6} metalness={0.4} />
        </mesh>
        {/* Accent Strip */}
        <mesh position={[0, 0, 0.16]}>
          <boxGeometry args={[width, 0.08, 0.02]} />
          <meshStandardMaterial color="#0284c7" emissive="#0284c7" emissiveIntensity={0.3} />
        </mesh>
      </group>

      {/* South Wall */}
      <group position={[0, height / 2, halfL]}>
        <mesh position={[0, -height / 2 + 0.5, 0]} receiveShadow>
          <boxGeometry args={[width, 1.0, 0.4]} />
          <meshStandardMaterial color="#1e293b" roughness={0.9} />
        </mesh>
        <mesh position={[0, 0.5, 0]} receiveShadow>
          <boxGeometry args={[width, height - 1.0, 0.3]} />
          <meshStandardMaterial color="#0f172a" roughness={0.6} metalness={0.4} />
        </mesh>
        <mesh position={[0, 0, -0.16]}>
          <boxGeometry args={[width, 0.08, 0.02]} />
          <meshStandardMaterial color="#0284c7" emissive="#0284c7" emissiveIntensity={0.3} />
        </mesh>
      </group>

      {/* West Wall (with Loading Bay Doors) */}
      <group position={[-halfW, height / 2, 0]}>
        <mesh position={[0, -height / 2 + 0.5, 0]} receiveShadow>
          <boxGeometry args={[0.4, 1.0, length]} />
          <meshStandardMaterial color="#1e293b" roughness={0.9} />
        </mesh>
        <mesh position={[0, 0.5, 0]} receiveShadow>
          <boxGeometry args={[0.3, height - 1.0, length]} />
          <meshStandardMaterial color="#0f172a" roughness={0.6} metalness={0.4} />
        </mesh>

        {/* Industrial Roll-up Bay Door 1 */}
        <mesh position={[0.16, -height / 2 + 1.6, -4]} castShadow receiveShadow>
          <boxGeometry args={[0.04, 3.2, 4.0]} />
          <meshStandardMaterial color="#334155" roughness={0.5} metalness={0.7} />
        </mesh>
        {/* Door 1 Frame */}
        <mesh position={[0.18, -height / 2 + 3.3, -4]}>
          <boxGeometry args={[0.08, 0.2, 4.4]} />
          <meshStandardMaterial color="#eab308" metalness={0.8} />
        </mesh>

        {/* Industrial Roll-up Bay Door 2 */}
        <mesh position={[0.16, -height / 2 + 1.6, 4]} castShadow receiveShadow>
          <boxGeometry args={[0.04, 3.2, 4.0]} />
          <meshStandardMaterial color="#334155" roughness={0.5} metalness={0.7} />
        </mesh>
        {/* Door 2 Frame */}
        <mesh position={[0.18, -height / 2 + 3.3, 4]}>
          <boxGeometry args={[0.08, 0.2, 4.4]} />
          <meshStandardMaterial color="#eab308" metalness={0.8} />
        </mesh>
      </group>

      {/* East Wall */}
      <group position={[halfW, height / 2, 0]}>
        <mesh position={[0, -height / 2 + 0.5, 0]} receiveShadow>
          <boxGeometry args={[0.4, 1.0, length]} />
          <meshStandardMaterial color="#1e293b" roughness={0.9} />
        </mesh>
        <mesh position={[0, 0.5, 0]} receiveShadow>
          <boxGeometry args={[0.3, height - 1.0, length]} />
          <meshStandardMaterial color="#0f172a" roughness={0.6} metalness={0.4} />
        </mesh>
      </group>

      {/* 3. Structural Steel Columns with Safety Yellow Guards */}
      {columnPositions.map(([cx, cz], idx) => (
        <group key={`col-${idx}`} position={[cx, height / 2, cz]}>
          {/* Main I-Beam/Box Column */}
          <mesh castShadow receiveShadow>
            <boxGeometry args={[0.4, height, 0.4]} />
            <meshStandardMaterial color="#1e293b" metalness={0.8} roughness={0.3} />
          </mesh>
          {/* Yellow Impact Bumper Base */}
          <mesh position={[0, -height / 2 + 0.45, 0]} castShadow>
            <boxGeometry args={[0.56, 0.9, 0.56]} />
            <meshStandardMaterial color="#eab308" metalness={0.6} roughness={0.4} />
          </mesh>
          {/* Static Collider for each Column */}
          <RigidBody
            type="fixed"
            colliders={false}
            name={`Column-${idx}`}
          >
            <CuboidCollider args={[0.28, height / 2, 0.28]} position={[0, 0, 0]} />
          </RigidBody>
        </group>
      ))}
    </group>
  );
};
