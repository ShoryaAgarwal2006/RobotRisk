import React, { useState } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  Box,
  Eye,
  Layers,
  Trash2,
  Video,
  RefreshCw,
  ShieldAlert,
  X,
  CheckCircle2,
  AlertOctagon,
  ChevronDown,
  Truck,
} from 'lucide-react';
import { useSimulationStore } from '../state/useSimulationStore';
import { CameraView } from '../types/simulation';
import { WAREHOUSE_CONFIG } from '../simulation/environments/warehouseConfig';

export const SimControls: React.FC = () => {
  const isRunning = useSimulationStore((s) => s.isRunning);
  const timeScale = useSimulationStore((s) => s.timeScale);
  const cameraView = useSimulationStore((s) => s.cameraView);
  const togglePlayPause = useSimulationStore((s) => s.togglePlayPause);
  const setTimeScale = useSimulationStore((s) => s.setTimeScale);
  const resetSimulation = useSimulationStore((s) => s.resetSimulation);
  const setCameraView = useSimulationStore((s) => s.setCameraView);
  const triggerResetCamera = useSimulationStore((s) => s.triggerResetCamera);

  // Placement mode state
  const placementMode = useSimulationStore((s) => s.placementMode);
  const previewPosition = useSimulationStore((s) => s.previewPosition);
  const previewRotation = useSimulationStore((s) => s.previewRotation);
  const isPlacementValid = useSimulationStore((s) => s.isPlacementValid);
  const setPlacementMode = useSimulationStore((s) => s.setPlacementMode);
  const rotatePlacementPreview = useSimulationStore((s) => s.rotatePlacementPreview);
  const confirmPlacement = useSimulationStore((s) => s.confirmPlacement);
  const cancelPlacement = useSimulationStore((s) => s.cancelPlacement);

  // Objects & Barriers state
  const interactiveObjects = useSimulationStore((s) => s.interactiveObjects);
  const selectedObjectId = useSimulationStore((s) => s.selectedObjectId);
  const deleteSelectedObject = useSimulationStore((s) => s.deleteSelectedObject);
  const clearInteractiveObjects = useSimulationStore((s) => s.clearInteractiveObjects);
  const spawnForklift = useSimulationStore((s) => s.spawnForklift);

  const activeBarriers = useSimulationStore((s) => s.activeBarriers);
  const blockAisle = useSimulationStore((s) => s.blockAisle);
  const removeBarrier = useSimulationStore((s) => s.removeBarrier);
  const clearAllBarriers = useSimulationStore((s) => s.clearAllBarriers);

  const [showAisleMenu, setShowAisleMenu] = useState(false);
  const [showForkliftMenu, setShowForkliftMenu] = useState(false);

  const getCameraLabel = (view: CameraView) => {
    switch (view) {
      case 'follow':
        return 'Follow (3rd Person)';
      case 'orbit':
        return 'Free Orbit';
      case 'top_down':
        return 'Top-Down';
    }
  };

  const selectedObj = interactiveObjects.find((o) => o.id === selectedObjectId);

  return (
    <div
      data-testid="sim-controls-panel"
      className="absolute bottom-6 left-6 z-20 flex flex-col space-y-2 select-none font-mono max-w-[calc(100vw-30rem)] pointer-events-auto"
    >
      {/* 1. Active Placement Mode Floating Indicator */}
      {placementMode && (
        <div className="p-3 rounded-xl bg-[#090d19]/95 backdrop-blur-md border border-cyan-500/80 shadow-2xl shadow-cyan-950/60 space-y-1.5 animate-in fade-in slide-in-from-bottom-2 duration-200">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center space-x-2">
              <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-ping" />
              <span className="font-extrabold text-cyan-300 uppercase tracking-wider">
                {placementMode === 'box'
                  ? 'PLACING CARGO CRATE'
                  : placementMode === 'sphere'
                  ? 'PLACING TEST SPHERE'
                  : 'PLACING AISLE BARRICADE'}
              </span>
            </div>
            <button
              onClick={cancelPlacement}
              className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-rose-400 transition-colors"
              title="Cancel Placement [Esc]"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex items-center space-x-3 text-[11px] text-slate-300 pt-0.5">
            <span>
              Target: <strong className="text-cyan-400">[{previewPosition[0].toFixed(1)}, {previewPosition[2].toFixed(1)}]</strong>
            </span>
            <span>
              Rot: <strong className="text-slate-200">{Math.round((previewRotation * 180) / Math.PI)}°</strong>
            </span>
            <span
              className={`px-1.5 py-0.2 rounded text-[10px] font-bold uppercase flex items-center space-x-1 ${
                isPlacementValid
                  ? 'bg-emerald-950 text-emerald-300 border border-emerald-700'
                  : 'bg-rose-950 text-rose-300 border border-rose-700'
              }`}
            >
              {isPlacementValid ? (
                <>
                  <CheckCircle2 className="w-3 h-3" />
                  <span>VALID SPOT</span>
                </>
              ) : (
                <>
                  <AlertOctagon className="w-3 h-3" />
                  <span>OBSTRUCTED</span>
                </>
              )}
            </span>
          </div>

          <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1 border-t border-[#1e2942]/60">
            <div className="flex items-center space-x-2">
              <button
                onClick={() => rotatePlacementPreview(Math.PI / 4)}
                className="px-2 py-0.5 rounded bg-[#141d33] hover:bg-cyan-950 text-cyan-300 border border-[#1e2942] transition-colors"
              >
                [R] Rotate 45°
              </button>
              <button
                onClick={confirmPlacement}
                disabled={!isPlacementValid}
                className="px-2.5 py-0.5 rounded bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white font-bold transition-colors"
              >
                Click to Confirm
              </button>
            </div>
            <span className="text-slate-500">[Esc / Right-Click] Cancel</span>
          </div>
        </div>
      )}

      {/* 2. Selected Object Action Pill */}
      {selectedObj && !placementMode && (
        <div className="flex items-center justify-between p-2 rounded-xl bg-[#090d19]/95 backdrop-blur-md border border-cyan-700/60 shadow-xl text-xs space-x-3">
          <div className="flex items-center space-x-2">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: selectedObj.color }} />
            <span className="text-slate-200 font-bold">{selectedObj.name || selectedObj.type}</span>
            <span className="text-[10px] text-slate-400">
              [{selectedObj.position[0].toFixed(1)}, {selectedObj.position[2].toFixed(1)}]
            </span>
          </div>
          <button
            onClick={deleteSelectedObject}
            className="flex items-center space-x-1 px-2 py-0.5 rounded bg-rose-950/80 hover:bg-rose-900 text-rose-300 border border-rose-800 text-[11px] transition-colors"
            title="Delete this placed obstacle"
          >
            <Trash2 className="w-3 h-3" />
            <span>DELETE</span>
          </button>
        </div>
      )}

      {/* 3. Aisle Blocking Menu Dropdown */}
      {showAisleMenu && (
        <div className="p-3 rounded-xl bg-[#090d19]/95 backdrop-blur-md border border-amber-600/70 shadow-2xl space-y-2 w-80">
          <div className="flex items-center justify-between border-b border-[#1e2942] pb-1.5 text-xs">
            <div className="flex items-center space-x-1.5 text-amber-400 font-bold">
              <ShieldAlert className="w-4 h-4" />
              <span>BLOCK CORRIDOR / AISLE</span>
            </div>
            <button
              onClick={() => setShowAisleMenu(false)}
              className="text-slate-400 hover:text-slate-200"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
            {WAREHOUSE_CONFIG.aisles.map((aisle) => {
              const activeBarrier = activeBarriers.find((b) => b.aisleId === aisle.id);

              return (
                <div
                  key={aisle.id}
                  className="flex items-center justify-between p-1.5 rounded bg-[#141d33] border border-[#1e2942] text-[11px]"
                >
                  <span className="text-slate-200 truncate pr-2">{aisle.name}</span>
                  {activeBarrier ? (
                    <button
                      onClick={() => removeBarrier(activeBarrier.id)}
                      className="px-2 py-0.5 rounded bg-rose-950 text-rose-300 border border-rose-800 hover:bg-rose-900 text-[10px] font-bold"
                    >
                      UNBLOCK
                    </button>
                  ) : (
                    <button
                      onClick={() => {
                        blockAisle(aisle.id);
                        setShowAisleMenu(false);
                      }}
                      className="px-2 py-0.5 rounded bg-amber-600 hover:bg-amber-500 text-white text-[10px] font-bold"
                    >
                      BLOCK
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {activeBarriers.length > 0 && (
            <button
              onClick={() => {
                clearAllBarriers();
                setShowAisleMenu(false);
              }}
              className="w-full py-1 text-center text-[10px] font-bold text-rose-400 hover:text-rose-300 border-t border-[#1e2942] pt-1"
            >
              CLEAR ALL ({activeBarriers.length}) BARRIERS
            </button>
          )}
        </div>
      )}

      {/* 3B. Forklift Spawn Preset Menu Dropdown */}
      {showForkliftMenu && (
        <div className="p-3 rounded-xl bg-[#090d19]/95 backdrop-blur-md border border-amber-500/80 shadow-2xl space-y-2 w-84 animate-in fade-in slide-in-from-bottom-2 duration-150">
          <div className="flex items-center justify-between border-b border-[#1e2942] pb-1.5 text-xs">
            <div className="flex items-center space-x-1.5 text-amber-400 font-bold">
              <Truck className="w-4 h-4" />
              <span>SPAWN INDUSTRIAL FORKLIFT</span>
            </div>
            <button
              onClick={() => setShowForkliftMenu(false)}
              className="text-slate-400 hover:text-slate-200"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="text-[10px] text-slate-400">
            Select a warehouse corridor to deploy a physically simulated forklift actor:
          </div>

          <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
            {[
              {
                name: 'West Transit Arterial (Directly Ahead of Robot)',
                desc: 'Patrol: [-14.5, -8.0] ↔ [-14.5, 3.0] • 1.4 m/s',
                pos: [-14.5, 0.0, -4.0] as [number, number, number],
                start: [-14.5, -8.0] as [number, number],
                end: [-14.5, 3.0] as [number, number],
              },
              {
                name: 'Aisle 1 (Bay A-B Corridor)',
                desc: 'Patrol: [-6.5, -8.0] ↔ [-6.5, 6.0] • 1.4 m/s',
                pos: [-6.5, 0.0, 0.0] as [number, number, number],
                start: [-6.5, -8.0] as [number, number],
                end: [-6.5, 6.0] as [number, number],
              },
              {
                name: 'Aisle 2 (Center Transit Corridor)',
                desc: 'Patrol: [0.0, -8.0] ↔ [0.0, 7.0] • 1.4 m/s',
                pos: [0.0, 0.0, 0.0] as [number, number, number],
                start: [0.0, -8.0] as [number, number],
                end: [0.0, 7.0] as [number, number],
              },
              {
                name: 'Aisle 3 (Bay C-D Corridor)',
                desc: 'Patrol: [6.5, -8.0] ↔ [6.5, 6.0] • 1.4 m/s',
                pos: [6.5, 0.0, 0.0] as [number, number, number],
                start: [6.5, -8.0] as [number, number],
                end: [6.5, 6.0] as [number, number],
              },
              {
                name: 'North Cross Aisle (Intersection Hazard)',
                desc: 'Patrol: [-10.0, -10.5] ↔ [10.0, -10.5] • 1.4 m/s',
                pos: [0.0, 0.0, -10.5] as [number, number, number],
                start: [-10.0, -10.5] as [number, number],
                end: [10.0, -10.5] as [number, number],
              },
            ].map((preset, idx) => (
              <button
                key={idx}
                onClick={() => {
                  spawnForklift(
                    preset.pos,
                    preset.start,
                    preset.end,
                    1.4,
                    `Heavy Industrial Forklift 0${idx + 1}`
                  );
                  setShowForkliftMenu(false);
                }}
                className="w-full text-left p-2 rounded-lg bg-[#141d33] hover:bg-amber-950/60 border border-[#1e2942] hover:border-amber-600/60 text-[11px] transition-colors group"
              >
                <div className="font-bold text-slate-200 group-hover:text-amber-300 transition-colors">
                  {preset.name}
                </div>
                <div className="text-[10px] text-amber-400/80 font-mono mt-0.5">
                  {preset.desc}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 4. Simulation Playback & Speed Controls */}
      <div className="flex items-center p-2 rounded-xl bg-[#0d1322]/90 backdrop-blur-md border border-[#1e2942] space-x-2 shadow-xl">
        <button
          onClick={togglePlayPause}
          className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold tracking-wide transition-all ${
            isRunning
              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30'
              : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/30'
          }`}
          title="Toggle Simulation Play/Pause [P]"
        >
          {isRunning ? (
            <>
              <Pause className="w-3.5 h-3.5" />
              <span>PAUSE</span>
            </>
          ) : (
            <>
              <Play className="w-3.5 h-3.5" />
              <span>RUN</span>
            </>
          )}
        </button>

        <div className="flex items-center bg-[#141d33] rounded-lg p-0.5 border border-[#1e2942]">
          {[0.5, 1.0, 2.0].map((scale) => (
            <button
              key={scale}
              onClick={() => setTimeScale(scale)}
              className={`px-2 py-1 text-[11px] rounded ${
                timeScale === scale
                  ? 'bg-cyan-500/30 text-cyan-300 font-bold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {scale}x
            </button>
          ))}
        </div>

        <button
          onClick={resetSimulation}
          className="p-1.5 rounded-lg bg-[#141d33] hover:bg-[#1e2942] text-slate-300 hover:text-cyan-300 border border-[#1e2942] transition-colors"
          title="Reset Simulation Clock (t=0)"
        >
          <RotateCcw className="w-4 h-4" />
        </button>
      </div>

      {/* 5. Camera View, Angle Reset & Interactive Placement Dock */}
      <div className="flex flex-col space-y-1.5 p-2 rounded-xl bg-[#0d1322]/90 backdrop-blur-md border border-[#1e2942] shadow-xl">
        <div className="flex flex-wrap items-center gap-1.5">
          {/* Camera View Mode Toggle */}
          <div className="flex items-center bg-[#141d33] rounded-lg p-0.5 border border-[#1e2942]">
            {(['follow', 'orbit', 'top_down'] as CameraView[]).map((view) => (
              <button
                key={view}
                onClick={() => setCameraView(view)}
                className={`flex items-center space-x-1 px-2.5 py-1 text-[11px] rounded capitalize transition-all ${
                  cameraView === view
                    ? 'bg-cyan-500/30 text-cyan-300 font-bold border border-cyan-500/50'
                    : 'text-slate-400 hover:text-slate-200 border border-transparent'
                }`}
                title={`Switch to ${getCameraLabel(view)} mode`}
              >
                <Eye className="w-3 h-3" />
                <span>{view.replace('_', ' ')}</span>
              </button>
            ))}
          </div>

          <button
            onClick={triggerResetCamera}
            className="flex items-center space-x-1 px-2 py-1 rounded-lg bg-[#141d33] hover:bg-cyan-950/60 text-slate-300 hover:text-cyan-300 border border-[#1e2942] text-[11px] transition-colors"
            title="Reset Camera angle and re-center view"
          >
            <RefreshCw className="w-3 h-3 text-cyan-400" />
            <span>RESET CAM</span>
          </button>

          <div className="h-4 w-px bg-[#1e2942]" />

          {/* Interactive Obstacle Placement Buttons */}
          <button
            onClick={() => setPlacementMode(placementMode === 'box' ? null : 'box')}
            className={`flex items-center space-x-1 px-2 py-1 rounded-lg border text-[11px] transition-colors ${
              placementMode === 'box'
                ? 'bg-cyan-600 text-white border-cyan-400 font-bold'
                : 'bg-cyan-950/40 hover:bg-cyan-900/60 text-cyan-300 border-cyan-800/50'
            }`}
            title="Click to place a cargo crate obstacle at precise coordinates"
          >
            <Box className="w-3 h-3" />
            <span>+ BOX</span>
          </button>

          <button
            onClick={() => setPlacementMode(placementMode === 'sphere' ? null : 'sphere')}
            className={`flex items-center space-x-1 px-2 py-1 rounded-lg border text-[11px] transition-colors ${
              placementMode === 'sphere'
                ? 'bg-rose-600 text-white border-rose-400 font-bold'
                : 'bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border-rose-800/50'
            }`}
            title="Click to place a dynamic sphere obstacle at precise coordinates"
          >
            <Layers className="w-3 h-3" />
            <span>+ SPHERE</span>
          </button>

          {/* Industrial Forklift Actor Spawn Control */}
          <div className="relative inline-flex items-center">
            <button
              data-testid="spawn-forklift-btn"
              onClick={() => {
                const currentForklifts = interactiveObjects.filter((o) => o.type === 'forklift');
                if (currentForklifts.length === 0) {
                  // 1. Primary Corridor: directly in front of the AMR [-14.5, 0.22, -10.5] in default camera view
                  spawnForklift(
                    [-14.5, 0.0, -4.0],
                    [-14.5, -8.0],
                    [-14.5, 3.0],
                    1.4,
                    'Heavy Industrial Forklift 01'
                  );
                } else if (currentForklifts.length === 1) {
                  // 2. Aisle 1 (Bay A-B Corridor)
                  spawnForklift(
                    [-6.5, 0.0, 0.0],
                    [-6.5, -8.0],
                    [-6.5, 6.0],
                    1.4,
                    'Heavy Industrial Forklift 02'
                  );
                } else if (currentForklifts.length === 2) {
                  // 3. North Cross Corridor (Perpendicular Hazard)
                  spawnForklift(
                    [0.0, 0.0, -10.5],
                    [-10.0, -10.5],
                    [10.0, -10.5],
                    1.4,
                    'Heavy Industrial Forklift 03'
                  );
                } else {
                  // 4. Aisle 2 (Center Transit Corridor)
                  spawnForklift(
                    [0.0, 0.0, 0.0],
                    [0.0, -8.0],
                    [0.0, 7.0],
                    1.4,
                    `Heavy Industrial Forklift 0${currentForklifts.length + 1}`
                  );
                }
              }}
              className={`flex items-center space-x-1 px-2.5 py-1 rounded-l-lg border text-[11px] transition-colors ${
                interactiveObjects.some((o) => o.type === 'forklift')
                  ? 'bg-amber-500/25 text-amber-300 border-amber-500/60 font-bold hover:bg-amber-500/35'
                  : 'bg-amber-950/40 hover:bg-amber-900/60 text-amber-300 border-amber-800/50'
              }`}
              title="Spawn an industrial yellow forklift actor with rotating beacon and physical patrol (Click to spawn ahead of AMR)"
            >
              <Truck className="w-3.5 h-3.5 text-amber-400" />
              <span>+ FORKLIFT</span>
              {interactiveObjects.filter((o) => o.type === 'forklift').length > 0 && (
                <span className="ml-1 px-1 rounded-full bg-amber-950 text-amber-300 border border-amber-700 text-[9px]">
                  {interactiveObjects.filter((o) => o.type === 'forklift').length}
                </span>
              )}
            </button>
            <button
              data-testid="spawn-forklift-menu-btn"
              onClick={() => setShowForkliftMenu(!showForkliftMenu)}
              className={`px-1.5 py-1 rounded-r-lg border border-l-0 text-[11px] transition-colors ${
                showForkliftMenu
                  ? 'bg-amber-600 text-white border-amber-400'
                  : 'bg-amber-950/40 hover:bg-amber-900/60 text-amber-300 border-amber-800/50'
              }`}
              title="Choose specific warehouse corridor for forklift"
            >
              <ChevronDown className="w-3 h-3" />
            </button>
          </div>

          {/* Dedicated Block Aisle Tool */}
          <button
            onClick={() => setShowAisleMenu(!showAisleMenu)}
            className={`flex items-center space-x-1 px-2.5 py-1 rounded-lg border text-[11px] transition-colors ${
              activeBarriers.length > 0 || showAisleMenu
                ? 'bg-amber-600 text-white border-amber-400 font-bold'
                : 'bg-amber-950/40 hover:bg-amber-900/60 text-amber-300 border-amber-800/50'
            }`}
            title="Block an entire warehouse aisle with a physical barrier"
          >
            <ShieldAlert className="w-3 h-3" />
            <span>BLOCK AISLE</span>
            {activeBarriers.length > 0 && (
              <span className="ml-1 px-1 rounded-full bg-black/40 text-[9px]">
                {activeBarriers.length}
              </span>
            )}
            <ChevronDown className="w-3 h-3 ml-0.5" />
          </button>

          {interactiveObjects.length > 0 && (
            <button
              onClick={clearInteractiveObjects}
              className="p-1 rounded-lg bg-[#141d33] hover:bg-rose-950/60 text-slate-400 hover:text-rose-400 border border-[#1e2942] transition-colors"
              title="Clear all dynamic placed objects"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Live Camera Instructions */}
        <div className="flex items-center justify-between text-[10px] text-slate-400 px-1 pt-1 border-t border-[#1e2942]/60">
          <div className="flex items-center space-x-1 text-cyan-400">
            <Video className="w-3 h-3" />
            <span className="font-semibold uppercase">{getCameraLabel(cameraView)}</span>
          </div>
          <span className="text-slate-500">
            Left-Drag: Orbit • Right-Drag: Pan • Wheel: Zoom
          </span>
        </div>
      </div>
    </div>
  );
};
