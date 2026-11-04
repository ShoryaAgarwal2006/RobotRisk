import React from 'react';
import { SensorRayHit } from '../../navigation/sensorUtils';
import * as THREE from 'three';

interface SensorVisualizerProps {
  rays: SensorRayHit[];
  visible?: boolean;
}

export const SensorVisualizer: React.FC<SensorVisualizerProps> = ({
  rays,
  visible = true,
}) => {
  if (!visible || rays.length === 0) return null;

  return (
    <group>
      {rays.map((ray) => {
        const points = [
          new THREE.Vector3(...ray.origin),
          new THREE.Vector3(...ray.hitPoint),
        ];
        const lineGeo = new THREE.BufferGeometry().setFromPoints(points);

        let rayColor = '#00f0ff'; // Cyan (clear)
        if (ray.hasHit) {
          if (ray.distance < 1.3) {
            rayColor = '#ff3366'; // Red (critical)
          } else if (ray.distance < 2.8) {
            rayColor = '#ffaa00'; // Amber (caution)
          } else {
            rayColor = '#00ff88'; // Green (contact beyond danger zone)
          }
        }

        return (
          <group key={`sensor-ray-${ray.id}`}>
            {/* Sensor Ray Line */}
            {/* @ts-expect-error Three line primitive */}
            <line geometry={lineGeo}>
              <lineBasicMaterial
                color={rayColor}
                transparent
                opacity={ray.hasHit ? 0.85 : 0.25}
                linewidth={1}
              />
            </line>

            {/* Hit Contact Point Sphere */}
            {ray.hasHit && (
              <mesh position={ray.hitPoint}>
                <sphereGeometry args={[0.05, 12, 12]} />
                <meshBasicMaterial color={rayColor} />
              </mesh>
            )}
          </group>
        );
      })}
    </group>
  );
};
