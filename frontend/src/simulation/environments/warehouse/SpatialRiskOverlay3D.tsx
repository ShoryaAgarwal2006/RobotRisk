import React, { useMemo, useState } from 'react';
import * as THREE from 'three';
import { useSimulationStore } from '../../../state/useSimulationStore';
import {
  spatialRiskService,
  SpatialIncident,
  SpatialCluster,
} from '../../../services/spatialRiskService';
import { flightRecorderService } from '../../../services/flightRecorder';

export const SpatialRiskOverlay3D: React.FC = () => {
  const isVisible = useSimulationStore((s) => s.isSpatialRiskOverlay3DVisible);
  const activeLayer = useSimulationStore((s) => s.spatialRiskActiveLayer);
  const setSpatialHeatmapOpen = useSimulationStore((s) => s.setSpatialHeatmapOpen);

  const [hoveredClusterId, setHoveredClusterId] = useState<string | null>(null);

  // Retrieve current active flight session incidents
  const currentSession = flightRecorderService.getCurrentSession();
  const pastSessions = flightRecorderService.getPastSessions();
  const activeSession = currentSession || pastSessions[0] || null;

  const incidents: SpatialIncident[] = useMemo(() => {
    if (!activeSession) return [];
    return spatialRiskService.extractIncidentsFromSession(activeSession);
  }, [activeSession, activeSession?.incidents?.length]);

  const filteredIncidents = useMemo(() => {
    return spatialRiskService.filterIncidentsByLayer(incidents, activeLayer);
  }, [incidents, activeLayer]);

  const clusters: SpatialCluster[] = useMemo(() => {
    return spatialRiskService.clusterIncidents(filteredIncidents, 1.2);
  }, [filteredIncidents]);

  if (!isVisible || filteredIncidents.length === 0) {
    return null;
  }

  const getColorForType = (type: string): string => {
    switch (type) {
      case 'COLLISION':
        return '#ef4444'; // Red
      case 'NEAR_MISS':
        return '#f59e0b'; // Amber
      case 'EMERGENCY_BRAKING':
        return '#a855f7'; // Purple
      case 'TTC_CRITICAL':
        return '#eab308'; // Yellow
      case 'TTC_WARNING':
        return '#06b6d4'; // Cyan
      default:
        return '#f97316';
    }
  };

  return (
    <group position={[0, 0.015, 0]}>
      {clusters.map((cluster) => {
        const [x, z] = cluster.center;
        const color = getColorForType(cluster.dominantType);
        const isHovered = hoveredClusterId === cluster.id;
        const radius = Math.min(2.5, 0.8 + cluster.count * 0.25);

        return (
          <group
            key={cluster.id}
            position={[x, 0, z]}
            onPointerOver={(e) => {
              e.stopPropagation();
              setHoveredClusterId(cluster.id);
            }}
            onPointerOut={(e) => {
              e.stopPropagation();
              setHoveredClusterId(null);
            }}
            onClick={(e) => {
              e.stopPropagation();
              setSpatialHeatmapOpen(true);
            }}
          >
            {/* 1. Outer Radial Glow Disk */}
            <mesh rotation={[-Math.PI / 2, 0, 0]}>
              <circleGeometry args={[radius, 32]} />
              <meshBasicMaterial
                color={color}
                transparent
                opacity={isHovered ? 0.55 : 0.35}
                depthWrite={false}
                side={THREE.DoubleSide}
              />
            </mesh>

            {/* 2. Concentric Alert Ring */}
            <mesh rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[radius * 0.75, radius * 0.85, 32]} />
              <meshBasicMaterial
                color={color}
                transparent
                opacity={isHovered ? 0.9 : 0.65}
                depthWrite={false}
                side={THREE.DoubleSide}
              />
            </mesh>

            {/* 3. Core Hotspot Pin */}
            <mesh rotation={[-Math.PI / 2, 0, 0]}>
              <circleGeometry args={[0.3, 16]} />
              <meshBasicMaterial
                color="#ffffff"
                transparent
                opacity={0.9}
                depthWrite={false}
                side={THREE.DoubleSide}
              />
            </mesh>

            {/* 4. Vertical Beacon Light Pillar on Hover or Collisions */}
            {(isHovered || cluster.dominantType === 'COLLISION') && (
              <mesh position={[0, 1.0, 0]}>
                <cylinderGeometry args={[0.04, 0.12, 2.0, 16]} />
                <meshBasicMaterial
                  color={color}
                  transparent
                  opacity={isHovered ? 0.8 : 0.4}
                  depthWrite={false}
                />
              </mesh>
            )}
          </group>
        );
      })}
    </group>
  );
};
