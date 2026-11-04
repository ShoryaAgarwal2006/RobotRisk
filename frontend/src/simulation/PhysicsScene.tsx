import React from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Physics } from '@react-three/rapier';
import { CameraRig } from './CameraRig';
import { WarehouseScene } from './environments/warehouse/WarehouseScene';
import { InteractiveTestObjects } from './InteractiveTestObjects';
import { AisleBarrierVisualizer } from './environments/warehouse/AisleBarrierVisualizer';
import { FallingPalletHazard } from './FallingPalletHazard';
import { PlacementPreview } from './PlacementPreview';
import { RobotController } from './robot/RobotController';
import { useSimulationStore } from '../state/useSimulationStore';

const SimulationTicker: React.FC = () => {
  const tick = useSimulationStore((s) => s.tick);

  useFrame((_, delta) => {
    // Clamp delta to prevent massive step jumps when tab loses focus
    const clampedDelta = Math.min(delta, 0.1);
    tick(clampedDelta);
  });

  return null;
};

export const PhysicsScene: React.FC = () => {
  const isRunning = useSimulationStore((s) => s.isRunning);
  const placementMode = useSimulationStore((s) => s.placementMode);
  const selectObject = useSimulationStore((s) => s.selectObject);
  const confirmPlacement = useSimulationStore((s) => s.confirmPlacement);
  const isPlacementValid = useSimulationStore((s) => s.isPlacementValid);

  const handlePointerMissed = (event: MouseEvent) => {
    // If in placement mode and left clicked, confirm placement
    if (placementMode && event.button === 0 && isPlacementValid) {
      confirmPlacement();
      return;
    }

    // Deselect selected object when clicking empty canvas
    if (!placementMode && event.button === 0) {
      selectObject(null);
    }
  };

  return (
    <div
      className={`w-full h-full relative select-none ${
        placementMode ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing'
      }`}
      onContextMenu={(e) => e.preventDefault()}
    >
      <Canvas
        shadows
        camera={{ position: [-14.5, 5, -5], fov: 48 }}
        onPointerMissed={handlePointerMissed}
      >
        <color attach="background" args={['#050811']} />
        <fog attach="fog" args={['#050811', 25, 75]} />

        {/* Global Lights */}
        <ambientLight intensity={0.4} />
        <directionalLight
          position={[20, 35, 15]}
          intensity={1.2}
          castShadow
          shadow-mapSize-width={2048}
          shadow-mapSize-height={2048}
          shadow-camera-far={80}
          shadow-camera-left={-25}
          shadow-camera-right={25}
          shadow-camera-top={20}
          shadow-camera-bottom={-20}
          shadow-bias={-0.0005}
        />
        <pointLight position={[-15, 6, -11]} intensity={0.8} color="#00f0ff" />
        <pointLight position={[14, 6, 11]} intensity={0.8} color="#00ff88" />

        {/* Rapier Physics World */}
        <Physics gravity={[0, -9.81, 0]} paused={!isRunning}>
          <WarehouseScene />
          <InteractiveTestObjects />
          <AisleBarrierVisualizer />
          <FallingPalletHazard />
          <RobotController />
        </Physics>

        {/* Interactive Object Placement Preview */}
        <PlacementPreview />

        {/* Camera and Sim Clock */}
        <CameraRig />
        <SimulationTicker />
      </Canvas>
    </div>
  );
};
