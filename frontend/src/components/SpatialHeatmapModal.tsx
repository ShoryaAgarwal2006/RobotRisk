import React, { useState, useMemo } from 'react';
import {
  Flame,
  X,
  MapPin,
  AlertTriangle,
  ShieldAlert,
  Radio,
  Eye,
  EyeOff,
  GitCompare,
  TrendingDown,
  Info,
  ChevronRight,
  Route,
  Activity,
} from 'lucide-react';
import { useSimulationStore } from '../state/useSimulationStore';
import {
  spatialRiskService,
  SpatialRiskLayer,
  SpatialIncident,
  SpatialCluster,
  SpatialCell,
  GRID_COLUMNS,
  GRID_ROWS,
  WAREHOUSE_BOUNDS,
  CELL_SIZE,
} from '../services/spatialRiskService';
import { flightRecorderService } from '../services/flightRecorder';
import { benchmarkService } from '../services/benchmarkService';

interface SpatialHeatmapModalProps {
  forceOpen?: boolean;
}

export const SpatialHeatmapModal: React.FC<SpatialHeatmapModalProps> = ({ forceOpen }) => {
  const storeOpen = useSimulationStore((s) => s.isSpatialHeatmapOpen);
  const setOpen = useSimulationStore((s) => s.setSpatialHeatmapOpen);
  const isOverlay3DVisible = useSimulationStore((s) => s.isSpatialRiskOverlay3DVisible);
  const setOverlay3DVisible = useSimulationStore((s) => s.setSpatialRiskOverlay3DVisible);
  const activeLayer = useSimulationStore((s) => s.spatialRiskActiveLayer);
  const setActiveLayer = useSimulationStore((s) => s.setSpatialRiskActiveLayer);
  const setFlightRecorderOpen = useSimulationStore((s) => s.setFlightRecorderOpen);

  // Source selection: 'active_flight' | 'benchmark_run' | 'comparison'
  const [selectedSourceType, setSelectedSourceType] = useState<'active_flight' | 'benchmark_run' | 'comparison'>('active_flight');
  const [selectedBenchmarkId, setSelectedBenchmarkId] = useState<string>('');
  const [baselineCompareId, setBaselineCompareId] = useState<string>('');
  const [candidateCompareId, setCandidateCompareId] = useState<string>('');

  // Selected cluster / incident for detail drawer
  const [selectedCluster, setSelectedCluster] = useState<SpatialCluster | null>(null);
  const [selectedIncident, setSelectedIncident] = useState<SpatialIncident | null>(null);

  // Overlay layer display options
  const [overlayOpacity, setOverlayOpacity] = useState<number>(0.65);
  const [showCoverageGrid, setShowCoverageGrid] = useState<boolean>(true);
  const [showTrajectoryPath, setShowTrajectoryPath] = useState<boolean>(true);

  const isOpen = forceOpen !== undefined ? forceOpen : storeOpen;

  // Retrieve runs and active flight sessions
  const benchmarkRuns = benchmarkService.getAllRuns();
  const currentFlightSession = flightRecorderService.getCurrentSession() || flightRecorderService.getPastSessions()[0] || null;

  // Set default benchmark selections
  useMemo(() => {
    if (benchmarkRuns.length > 0) {
      if (!selectedBenchmarkId) setSelectedBenchmarkId(benchmarkRuns[0].id);
      if (!baselineCompareId) setBaselineCompareId(benchmarkRuns[0].id);
      if (!candidateCompareId && benchmarkRuns.length > 1) {
        setCandidateCompareId(benchmarkRuns[1].id);
      }
    }
  }, [benchmarkRuns]);

  // Extract source incidents and telemetry frames
  const { incidents, telemetryFrames, trajectoryEnvelope, sourceName } = useMemo(() => {
    if (selectedSourceType === 'active_flight' && currentFlightSession) {
      return {
        incidents: spatialRiskService.extractIncidentsFromSession(currentFlightSession),
        telemetryFrames: currentFlightSession.frames || [],
        trajectoryEnvelope: currentFlightSession.frames.map((f) => [f.position[0], f.position[2]] as [number, number]),
        sourceName: `Active Flight Session (${currentFlightSession.recordingId})`,
      };
    }

    if (selectedSourceType === 'benchmark_run') {
      const run = benchmarkRuns.find((r) => r.id === selectedBenchmarkId) || benchmarkRuns[0];
      if (run) {
        return {
          incidents: spatialRiskService.extractIncidentsFromBenchmarkRun(run),
          telemetryFrames: [],
          trajectoryEnvelope: run.trajectoryEnvelope || [],
          sourceName: `Benchmark Run: ${run.name}`,
        };
      }
    }

    return {
      incidents: currentFlightSession ? spatialRiskService.extractIncidentsFromSession(currentFlightSession) : [],
      telemetryFrames: currentFlightSession?.frames || [],
      trajectoryEnvelope: [],
      sourceName: 'No Active Telemetry Source',
    };
  }, [selectedSourceType, selectedBenchmarkId, currentFlightSession, benchmarkRuns]);

  // Compute Spatial Heatmap Data
  const heatmapData = useMemo(() => {
    return spatialRiskService.generateHeatmapData(incidents, telemetryFrames, activeLayer);
  }, [incidents, telemetryFrames, activeLayer]);

  // Compute Spatial Comparison Delta if in comparison mode
  const comparisonDelta = useMemo(() => {
    if (selectedSourceType !== 'comparison') return null;
    const baseRun = benchmarkRuns.find((r) => r.id === baselineCompareId);
    const candRun = benchmarkRuns.find((r) => r.id === candidateCompareId);
    if (!baseRun || !candRun) return null;
    return spatialRiskService.compareSpatialRisk(baseRun, candRun, activeLayer);
  }, [selectedSourceType, baselineCompareId, candidateCompareId, benchmarkRuns, activeLayer]);

  if (!isOpen) return null;

  // Coordinate transformation helpers for SVG (Canvas: 1000 x 800)
  const SVG_W = 1000;
  const SVG_H = 800;

  const toSvgX = (worldX: number) => ((worldX - WAREHOUSE_BOUNDS.minX) / WAREHOUSE_BOUNDS.width) * SVG_W;
  const toSvgY = (worldZ: number) => ((worldZ - WAREHOUSE_BOUNDS.minZ) / WAREHOUSE_BOUNDS.length) * SVG_H;

  const cellWidthPx = (CELL_SIZE / WAREHOUSE_BOUNDS.width) * SVG_W;
  const cellHeightPx = (CELL_SIZE / WAREHOUSE_BOUNDS.length) * SVG_H;

  const getCellFillColor = (cell: SpatialCell): string => {
    if (cell.normalizedRiskIndex === 0) {
      if (cell.coverageState === 'UNTESTED' && showCoverageGrid) {
        return 'rgba(30, 41, 59, 0.4)'; // Untested cold cell
      }
      return 'transparent';
    }

    switch (cell.riskLevel) {
      case 'CRITICAL':
        return `rgba(239, 68, 68, ${overlayOpacity})`; // Crimson Red
      case 'MODERATE':
        return `rgba(245, 158, 11, ${overlayOpacity * 0.9})`; // Amber
      case 'CAUTION':
        return `rgba(234, 179, 8, ${overlayOpacity * 0.75})`; // Yellow
      default:
        return 'transparent';
    }
  };

  const getIncidentBadgeColor = (type: string) => {
    switch (type) {
      case 'COLLISION':
        return 'bg-rose-950 text-rose-300 border-rose-600';
      case 'NEAR_MISS':
        return 'bg-amber-950 text-amber-300 border-amber-600';
      case 'EMERGENCY_BRAKING':
        return 'bg-purple-950 text-purple-300 border-purple-600';
      case 'TTC_CRITICAL':
        return 'bg-yellow-950 text-yellow-300 border-yellow-600';
      case 'TTC_WARNING':
        return 'bg-cyan-950 text-cyan-300 border-cyan-600';
      default:
        return 'bg-slate-800 text-slate-300 border-slate-600';
    }
  };

  return (
    <div
      data-testid="spatial-heatmap-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/85 backdrop-blur-md select-none font-mono"
    >
      <div className="relative w-full max-w-[1440px] h-[92vh] flex flex-col bg-[#070b16] border border-[#1e2942] rounded-2xl shadow-2xl shadow-cyan-950/40 overflow-hidden text-slate-200">
        
        {/* 1. Modal Header Bar */}
        <div className="shrink-0 flex items-center justify-between px-6 py-3 border-b border-[#1b263b] bg-[#090e1c]">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-lg bg-gradient-to-br from-amber-500/20 via-rose-500/20 to-cyan-500/20 border border-amber-500/40 text-amber-400">
              <Flame className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-base font-extrabold tracking-wider bg-gradient-to-r from-amber-400 via-rose-400 to-cyan-400 bg-clip-text text-transparent uppercase">
                  Spatial Risk Heatmap & Incident Hotspots
                </h2>
                <span className="text-[10px] px-2 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-800 font-bold">
                  PHASE 5.3D CORE
                </span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700 hidden sm:inline">
                  1m × 1m UNIFORM GRID (1,280 CELLS)
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Ground-truth incident density, trajectory coverage & physical bottleneck hotspot analysis.
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            {/* 3D In-Scene Sync Toggle */}
            <button
              data-testid="toggle-3d-overlay-button"
              onClick={() => setOverlay3DVisible(!isOverlay3DVisible)}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg border text-xs font-bold transition-all ${
                isOverlay3DVisible
                  ? 'bg-cyan-950 text-cyan-300 border-cyan-600 shadow-md shadow-cyan-900/30'
                  : 'bg-[#0d1322] hover:bg-[#141d33] text-slate-400 border-[#1e2942]'
              }`}
              title="Toggle 3D floor projection overlay inside simulation viewport"
            >
              {isOverlay3DVisible ? <Eye className="w-3.5 h-3.5 text-cyan-400" /> : <EyeOff className="w-3.5 h-3.5 text-slate-500" />}
              <span>3D VIEWPORT: {isOverlay3DVisible ? 'ON' : 'OFF'}</span>
            </button>

            {/* Close Button */}
            <button
              data-testid="close-heatmap-modal"
              onClick={() => setOpen(false)}
              className="p-1.5 rounded-lg hover:bg-slate-800/80 text-slate-400 hover:text-slate-100 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* 2. Source & Layer Controls Bar */}
        <div className="shrink-0 flex flex-wrap items-center justify-between px-6 py-2.5 bg-[#0a1020] border-b border-[#1b263b] gap-2.5 text-xs">
          
          {/* Source Type Selector */}
          <div className="flex items-center space-x-1.5 bg-[#050811] p-1 rounded-lg border border-[#1e2942]">
            <button
              onClick={() => {
                setSelectedSourceType('active_flight');
                setSelectedCluster(null);
                setSelectedIncident(null);
              }}
              className={`px-2.5 py-1 rounded text-[11px] font-bold transition-all ${
                selectedSourceType === 'active_flight'
                  ? 'bg-cyan-950 text-cyan-300 border border-cyan-700 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              ACTIVE FLIGHT
            </button>
            <button
              onClick={() => {
                setSelectedSourceType('benchmark_run');
                setSelectedCluster(null);
                setSelectedIncident(null);
              }}
              className={`px-2.5 py-1 rounded text-[11px] font-bold transition-all ${
                selectedSourceType === 'benchmark_run'
                  ? 'bg-cyan-950 text-cyan-300 border border-cyan-700 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              BENCHMARK RUN
            </button>
            <button
              onClick={() => {
                setSelectedSourceType('comparison');
                setSelectedCluster(null);
                setSelectedIncident(null);
              }}
              className={`flex items-center space-x-1 px-2.5 py-1 rounded text-[11px] font-bold transition-all ${
                selectedSourceType === 'comparison'
                  ? 'bg-amber-950 text-amber-300 border border-amber-700 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <GitCompare className="w-3 h-3" />
              <span>DELTA COMPARE</span>
            </button>
          </div>

          {/* Benchmark Selection Dropdown (if benchmark or comparison mode) */}
          {selectedSourceType === 'benchmark_run' && (
            <div className="flex items-center space-x-2">
              <span className="text-slate-500 text-[11px] font-semibold">RUN:</span>
              <select
                data-testid="heatmap-run-select"
                value={selectedBenchmarkId}
                onChange={(e) => setSelectedBenchmarkId(e.target.value)}
                className="bg-[#050811] border border-[#1e2942] rounded px-2.5 py-1 text-slate-200 text-xs focus:border-cyan-500 outline-none"
              >
                {benchmarkRuns.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} ({r.metrics.incidentCounts.collisions}c / {r.metrics.incidentCounts.nearMisses}nm)
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Comparison Pair Dropdowns */}
          {selectedSourceType === 'comparison' && (
            <div className="flex items-center space-x-2 text-[11px]">
              <span className="text-cyan-400 font-bold">BASELINE:</span>
              <select
                value={baselineCompareId}
                onChange={(e) => setBaselineCompareId(e.target.value)}
                className="bg-[#050811] border border-cyan-800/60 rounded px-2 py-1 text-slate-200 text-xs outline-none"
              >
                {benchmarkRuns.map((r) => (
                  <option key={`base-${r.id}`} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>

              <span className="text-amber-400 font-bold ml-2">CANDIDATE:</span>
              <select
                value={candidateCompareId}
                onChange={(e) => setCandidateCompareId(e.target.value)}
                className="bg-[#050811] border border-amber-800/60 rounded px-2 py-1 text-slate-200 text-xs outline-none"
              >
                {benchmarkRuns.map((r) => (
                  <option key={`cand-${r.id}`} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Event Layers Filter */}
          <div className="flex items-center space-x-1 overflow-x-auto">
            <span className="text-slate-500 text-[10px] font-bold uppercase mr-1">Layer:</span>
            {(
              [
                ['COMBINED', 'COMBINED RISK'],
                ['COLLISION', 'COLLISIONS'],
                ['NEAR_MISS', 'NEAR-MISSES'],
                ['EMERGENCY_BRAKING', 'BRAKING'],
                ['TTC_CRITICAL', 'TTC CRITICAL'],
                ['TTC_WARNING', 'TTC WARNING'],
              ] as const
            ).map(([layerKey, label]) => (
              <button
                key={layerKey}
                onClick={() => setActiveLayer(layerKey as SpatialRiskLayer)}
                className={`px-2 py-1 rounded text-[10px] font-bold transition-all shrink-0 ${
                  activeLayer === layerKey
                    ? 'bg-rose-950/80 text-rose-300 border border-rose-600 shadow-sm'
                    : 'bg-[#060a14] text-slate-400 hover:text-slate-200 border border-[#1e2942]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Layer View Options (Opacity, Trajectory, Coverage Grid) */}
          <div className="flex items-center space-x-3 text-[11px] text-slate-400">
            <label className="flex items-center space-x-1 cursor-pointer">
              <input
                type="checkbox"
                checked={showCoverageGrid}
                onChange={(e) => setShowCoverageGrid(e.target.checked)}
                className="rounded accent-cyan-500"
              />
              <span className="text-[10px]">COLD ZONES</span>
            </label>
            <label className="flex items-center space-x-1 cursor-pointer">
              <input
                type="checkbox"
                checked={showTrajectoryPath}
                onChange={(e) => setShowTrajectoryPath(e.target.checked)}
                className="rounded accent-cyan-500"
              />
              <span className="text-[10px]">PATH TRACE</span>
            </label>
            <div className="flex items-center space-x-1">
              <span className="text-[10px]">OPACITY:</span>
              <input
                type="range"
                min="0.2"
                max="0.95"
                step="0.05"
                value={overlayOpacity}
                onChange={(e) => setOverlayOpacity(parseFloat(e.target.value))}
                className="w-16 h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-cyan-400"
              />
            </div>
          </div>
        </div>

        {/* 3. Main Workspace: 2D Floorplan Blueprint & Hotspot Inspector */}
        <div className="flex-1 flex overflow-hidden">
          
          {/* Left Canvas Container: 2D Floorplan Blueprint */}
          <div className="flex-1 relative bg-[#04060c] p-4 flex flex-col items-center justify-center overflow-hidden">
            
            {/* Status & Source Notification Pill */}
            <div className="absolute top-4 left-4 z-10 flex items-center space-x-2">
              <div className="px-2.5 py-1 rounded bg-[#070b16]/90 border border-[#1e2942] backdrop-blur-sm text-[11px] font-bold text-slate-300">
                <span>SOURCE: {sourceName}</span>
              </div>
              <div className="px-2.5 py-1 rounded bg-[#070b16]/90 border border-[#1e2942] backdrop-blur-sm text-[11px] text-cyan-300">
                <span>COVERAGE: {heatmapData.coverage.coveragePercentage}% NAVIGABLE</span>
              </div>
            </div>

            {/* Zero-Incident Notification Banner */}
            {selectedSourceType !== 'comparison' && heatmapData.incidents.length === 0 && (
              <div
                data-testid="zero-incidents-banner"
                className="absolute top-16 z-10 px-5 py-2.5 rounded-xl bg-emerald-950/80 border border-emerald-500 text-emerald-300 text-xs font-bold shadow-lg shadow-emerald-950/50 flex items-center space-x-2 animate-pulse"
              >
                <ShieldAlert className="w-4 h-4 text-emerald-400" />
                <span>NO INCIDENTS DETECTED IN RECORDED COVERAGE.</span>
              </div>
            )}

            {/* Comparison Verdict Banner (if Delta Compare mode active) */}
            {selectedSourceType === 'comparison' && comparisonDelta && (
              <div
                data-testid="spatial-comparison-banner"
                className={`absolute top-16 z-10 px-5 py-2 rounded-xl text-xs font-bold border shadow-lg flex items-center space-x-2.5 ${
                  comparisonDelta.overallSpatialVerdict === 'RISK_REDUCED'
                    ? 'bg-emerald-950/90 text-emerald-300 border-emerald-500'
                    : comparisonDelta.overallSpatialVerdict === 'RISK_INCREASED'
                    ? 'bg-rose-950/90 text-rose-300 border-rose-500'
                    : 'bg-slate-900/90 text-slate-300 border-slate-600'
                }`}
              >
                {comparisonDelta.overallSpatialVerdict === 'RISK_REDUCED' ? (
                  <TrendingDown className="w-4 h-4 text-emerald-400" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-rose-400" />
                )}
                <span>{comparisonDelta.summarySentence}</span>
              </div>
            )}

            {/* Interactive SVG Floorplan Blueprint */}
            <svg
              viewBox={`0 0 ${SVG_W} ${SVG_H}`}
              className="w-full h-full max-h-[72vh] border border-[#1e2942] rounded-xl bg-[#03050a] shadow-inner select-none"
              style={{ aspectRatio: `${SVG_W}/${SVG_H}` }}
            >
              {/* SVG Definitions for Patterns & Gradients */}
              <defs>
                {/* Diagonal Crosshatch for Untested Cold Zones */}
                <pattern id="untestedHatch" width="8" height="8" patternTransform="rotate(45 0 0)" patternUnits="userSpaceOnUse">
                  <line x1="0" y1="0" x2="0" y2="8" stroke="#334155" strokeWidth="1" strokeOpacity="0.4" />
                </pattern>
                {/* Rack Hatching */}
                <pattern id="rackHatch" width="6" height="6" patternTransform="rotate(45 0 0)" patternUnits="userSpaceOnUse">
                  <line x1="0" y1="0" x2="0" y2="6" stroke="#1e293b" strokeWidth="1.5" />
                </pattern>
              </defs>

              {/* 1. Industrial Expansion Joint Background Grid (5m major grid) */}
              {Array.from({ length: 9 }).map((_, i) => (
                <line
                  key={`v-grid-${i}`}
                  x1={(i * SVG_W) / 8}
                  y1={0}
                  x2={(i * SVG_W) / 8}
                  y2={SVG_H}
                  stroke="#0f172a"
                  strokeWidth="1"
                />
              ))}
              {Array.from({ length: 7 }).map((_, j) => (
                <line
                  key={`h-grid-${j}`}
                  x1={0}
                  y1={(j * SVG_H) / 6}
                  x2={SVG_W}
                  y2={(j * SVG_H) / 6}
                  stroke="#0f172a"
                  strokeWidth="1"
                />
              ))}

              {/* 2. Warehouse Perimeter Walls (40m x 32m) */}
              <rect
                x={0}
                y={0}
                width={SVG_W}
                height={SVG_H}
                fill="none"
                stroke="#334155"
                strokeWidth="4"
              />

              {/* 3. Designated Warehouse Facility Zones */}
              {/* Charging Station Dock (X = -18 to -13, Z = -14 to -9) */}
              <rect
                x={toSvgX(-18)}
                y={toSvgY(-14)}
                width={toSvgX(-13) - toSvgX(-18)}
                height={toSvgY(-9) - toSvgY(-14)}
                fill="rgba(0, 240, 255, 0.05)"
                stroke="#0284c7"
                strokeWidth="1.5"
                strokeDasharray="4 2"
              />
              <text
                x={toSvgX(-15.5)}
                y={toSvgY(-11.5)}
                fill="#38bdf8"
                fontSize="11"
                textAnchor="middle"
                fontWeight="bold"
              >
                CHARGING DOCK 01
              </text>

              {/* Bay 4 Express Delivery Destination Zone (X = 11 to 17, Z = 8 to 14) */}
              <rect
                x={toSvgX(11)}
                y={toSvgY(8)}
                width={toSvgX(17) - toSvgX(11)}
                height={toSvgY(14) - toSvgY(8)}
                fill="rgba(0, 255, 136, 0.05)"
                stroke="#10b981"
                strokeWidth="1.5"
                strokeDasharray="4 2"
              />
              <text
                x={toSvgX(14)}
                y={toSvgY(11)}
                fill="#34d399"
                fontSize="11"
                textAnchor="middle"
                fontWeight="bold"
              >
                BAY 4 DELIVERY
              </text>

              {/* 4. Industrial Storage Racks (4 Double-Bay Rows) */}
              {[
                { x: -9.75, name: 'RACK D' },
                { x: -3.25, name: 'RACK A' },
                { x: 3.25, name: 'RACK B' },
                { x: 9.75, name: 'RACK C' },
              ].map((rack, idx) => (
                <g key={`rack-group-${idx}`}>
                  {/* North bay (Z = -4.5, length = 6.5, depth = 1.4) */}
                  <rect
                    x={toSvgX(rack.x - 0.7)}
                    y={toSvgY(-7.75)}
                    width={toSvgX(rack.x + 0.7) - toSvgX(rack.x - 0.7)}
                    height={toSvgY(-1.25) - toSvgY(-7.75)}
                    fill="url(#rackHatch)"
                    stroke="#1e293b"
                    strokeWidth="1.5"
                  />
                  {/* South bay (Z = 4.5, length = 6.5, depth = 1.4) */}
                  <rect
                    x={toSvgX(rack.x - 0.7)}
                    y={toSvgY(1.25)}
                    width={toSvgX(rack.x + 0.7) - toSvgX(rack.x - 0.7)}
                    height={toSvgY(7.75) - toSvgY(1.25)}
                    fill="url(#rackHatch)"
                    stroke="#1e293b"
                    strokeWidth="1.5"
                  />
                  <text
                    x={toSvgX(rack.x)}
                    y={toSvgY(-4.5)}
                    fill="#64748b"
                    fontSize="10"
                    textAnchor="middle"
                    fontWeight="bold"
                  >
                    {rack.name}
                  </text>
                </g>
              ))}

              {/* 5. Navigable Aisle Centerlines (Dashed Blue Lines) */}
              {/* West Arterial */}
              <line x1={toSvgX(-14.5)} y1={toSvgY(-12)} x2={toSvgX(-14.5)} y2={toSvgY(12)} stroke="#0369a1" strokeWidth="1" strokeDasharray="5 3" />
              {/* East Arterial */}
              <line x1={toSvgX(14.0)} y1={toSvgY(-12)} x2={toSvgX(14.0)} y2={toSvgY(12)} stroke="#0369a1" strokeWidth="1" strokeDasharray="5 3" />
              {/* North Cross */}
              <line x1={toSvgX(-14.5)} y1={toSvgY(-10.5)} x2={toSvgX(14.0)} y2={toSvgY(-10.5)} stroke="#0369a1" strokeWidth="1" strokeDasharray="5 3" />
              {/* South Cross */}
              <line x1={toSvgX(-14.5)} y1={toSvgY(10.5)} x2={toSvgX(14.0)} y2={toSvgY(10.5)} stroke="#0369a1" strokeWidth="1" strokeDasharray="5 3" />
              {/* Aisles 1, 2, 3 */}
              {[-6.5, 0.0, 6.5].map((ax, aIdx) => (
                <line key={`aisle-line-${aIdx}`} x1={toSvgX(ax)} y1={toSvgY(-9)} x2={toSvgX(ax)} y2={toSvgY(9)} stroke="#0369a1" strokeWidth="1" strokeDasharray="4 4" />
              ))}

              {/* 6. Spatial Heatmap Density Grid Layer (40 x 32 cells) */}
              {selectedSourceType !== 'comparison' ? (
                heatmapData.grid.map((colArr, cIdx) =>
                  colArr.map((cell, rIdx) => {
                    const cellX = (cIdx / GRID_COLUMNS) * SVG_W;
                    const cellY = (rIdx / GRID_ROWS) * SVG_H;
                    const fill = getCellFillColor(cell);

                    // If Untested Cold Zone inside navigable aisle
                    if (cell.coverageState === 'UNTESTED' && cell.isNavigableAisle && showCoverageGrid) {
                      return (
                        <rect
                          key={`cell-${cIdx}-${rIdx}`}
                          x={cellX}
                          y={cellY}
                          width={cellWidthPx}
                          height={cellHeightPx}
                          fill="url(#untestedHatch)"
                          stroke="#1e293b"
                          strokeWidth="0.5"
                          opacity={0.35}
                        />
                      );
                    }

                    if (cell.normalizedRiskIndex === 0) return null;

                    return (
                      <rect
                        key={`cell-${cIdx}-${rIdx}`}
                        x={cellX}
                        y={cellY}
                        width={cellWidthPx}
                        height={cellHeightPx}
                        fill={fill}
                        stroke="#000000"
                        strokeWidth="0.3"
                        className="transition-colors duration-300"
                      />
                    );
                  })
                )
              ) : (
                /* Comparative Delta Grid Layer */
                comparisonDelta?.deltaGrid.map((dCell, dIdx) => {
                  if (dCell.verdict === 'NEUTRAL') return null;
                  const cellX = (dCell.col / GRID_COLUMNS) * SVG_W;
                  const cellY = (dCell.row / GRID_ROWS) * SVG_H;
                  const isImproved = dCell.verdict === 'IMPROVED';
                  const fill = isImproved
                    ? `rgba(16, 185, 129, ${overlayOpacity})` // Green risk reduction
                    : `rgba(239, 68, 68, ${overlayOpacity})`; // Red risk increase

                  return (
                    <rect
                      key={`delta-cell-${dIdx}`}
                      x={cellX}
                      y={cellY}
                      width={cellWidthPx}
                      height={cellHeightPx}
                      fill={fill}
                      stroke="#000000"
                      strokeWidth="0.3"
                    />
                  );
                })
              )}

              {/* 7. Actual Trajectory Envelope Trace Polyline (Cyan ribbon) */}
              {showTrajectoryPath && trajectoryEnvelope.length > 1 && (
                <polyline
                  points={trajectoryEnvelope.map(([x, z]) => `${toSvgX(x)},${toSvgY(z)}`).join(' ')}
                  fill="none"
                  stroke="#00f0ff"
                  strokeWidth="2.5"
                  strokeDasharray="4 2"
                  opacity={0.75}
                />
              )}

              {/* 8. Clustered Hotspot Pins */}
              {heatmapData.clusters.map((cluster) => {
                const [cx, cz] = cluster.center;
                const px = toSvgX(cx);
                const py = toSvgY(cz);
                const isSelected = selectedCluster?.id === cluster.id;
                const pinColor = cluster.dominantType === 'COLLISION'
                  ? '#ef4444'
                  : cluster.dominantType === 'NEAR_MISS'
                  ? '#f59e0b'
                  : cluster.dominantType === 'EMERGENCY_BRAKING'
                  ? '#a855f7'
                  : '#eab308';

                return (
                  <g
                    key={cluster.id}
                    onClick={() => {
                      setSelectedCluster(cluster);
                      setSelectedIncident(cluster.incidents[0] || null);
                    }}
                    className="cursor-pointer group"
                  >
                    {/* Concentric Pulsing Ring */}
                    <circle
                      cx={px}
                      cy={py}
                      r={isSelected ? 16 : 12}
                      fill={pinColor}
                      fillOpacity={0.25}
                      stroke={pinColor}
                      strokeWidth="1.5"
                      className="animate-ping"
                    />
                    {/* Center Core Marker */}
                    <circle
                      cx={px}
                      cy={py}
                      r={isSelected ? 9 : 7}
                      fill={pinColor}
                      stroke="#ffffff"
                      strokeWidth="2"
                    />
                    {/* Incident Count Badge if > 1 */}
                    {cluster.count > 1 && (
                      <text
                        x={px}
                        y={py + 3.5}
                        fill="#ffffff"
                        fontSize="9"
                        textAnchor="middle"
                        fontWeight="black"
                      >
                        {cluster.count}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>

            {/* Bottom Coordinate Bar & Legend */}
            <div className="shrink-0 w-full mt-3 flex items-center justify-between text-[11px] text-slate-400 bg-[#070b16] px-4 py-2 rounded-lg border border-[#1e2942]">
              <div className="flex items-center space-x-4">
                <span className="font-bold text-slate-300">RISK STRATIFICATION:</span>
                <span className="flex items-center space-x-1.5">
                  <span className="w-2.5 h-2.5 rounded bg-rose-500" />
                  <span>CRITICAL (66-100)</span>
                </span>
                <span className="flex items-center space-x-1.5">
                  <span className="w-2.5 h-2.5 rounded bg-amber-500" />
                  <span>MODERATE (36-65)</span>
                </span>
                <span className="flex items-center space-x-1.5">
                  <span className="w-2.5 h-2.5 rounded bg-yellow-500" />
                  <span>CAUTION (11-35)</span>
                </span>
                <span className="flex items-center space-x-1.5">
                  <span className="w-2.5 h-2.5 rounded border border-slate-600 bg-slate-800" />
                  <span>UNTESTED COLD ZONE</span>
                </span>
              </div>

              <div className="text-[10px] text-slate-500 italic">
                <span>{heatmapData.normalizationLabel}</span>
              </div>
            </div>
          </div>

          {/* Right Panel: Hotspot Inspector Drawer & Coverage Audit */}
          <div className="w-80 sm:w-96 border-l border-[#1e2942] bg-[#080d1a] p-4 flex flex-col justify-between overflow-y-auto">
            <div className="space-y-4">
              
              {/* Hotspot Inspector Header */}
              <div className="flex items-center justify-between border-b border-[#1b263b] pb-2">
                <div className="flex items-center space-x-2">
                  <MapPin className="w-4 h-4 text-amber-400" />
                  <h3 className="font-bold text-slate-200 text-xs uppercase">
                    Incident Hotspot Inspector
                  </h3>
                </div>
                {selectedCluster && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
                    {selectedCluster.id} ({selectedCluster.count}x)
                  </span>
                )}
              </div>

              {/* Selected Hotspot Details */}
              {selectedCluster ? (
                <div className="space-y-3">
                  <div className="p-3 rounded-lg bg-[#050811] border border-[#1e2942] space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400 text-xs">Dominant Hazard:</span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${getIncidentBadgeColor(selectedCluster.dominantType)}`}>
                        {selectedCluster.dominantType}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400">Centroid Coordinates:</span>
                      <span className="font-bold text-cyan-300">
                        [{selectedCluster.center[0].toFixed(2)}m, {selectedCluster.center[1].toFixed(2)}m]
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400">Radius of Danger:</span>
                      <span className="font-bold text-slate-200">{selectedCluster.radiusMeters.toFixed(1)} m</span>
                    </div>

                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400">Total Incident Events:</span>
                      <span className="font-bold text-rose-400">{selectedCluster.count}</span>
                    </div>
                  </div>

                  {/* Incidents in this cluster list */}
                  <div className="space-y-1.5">
                    <span className="text-[11px] font-bold text-slate-400 block">
                      INCIDENT EVENTS AT THIS LOCATION:
                    </span>
                    {selectedCluster.incidents.map((inc) => (
                      <button
                        key={inc.id}
                        onClick={() => setSelectedIncident(inc)}
                        className={`w-full text-left p-2 rounded-lg border text-xs transition-all ${
                          selectedIncident?.id === inc.id
                            ? 'bg-amber-950/60 border-amber-500 text-amber-300'
                            : 'bg-[#060a14] border-[#1e2942] text-slate-300 hover:border-slate-600'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-[11px]">{inc.type}</span>
                          <span className="text-[10px] text-slate-500">t={inc.simTime.toFixed(1)}s</span>
                        </div>
                        <p className="text-[10px] text-slate-400 truncate mt-0.5">{inc.description}</p>
                      </button>
                    ))}
                  </div>

                  {/* Detailed Telemetry Snapshot for Selected Incident */}
                  {selectedIncident && (
                    <div className="p-3 rounded-lg bg-[#04060c] border border-cyan-900/50 space-y-2 text-xs">
                      <div className="flex items-center justify-between border-b border-[#1e2942] pb-1.5">
                        <span className="font-bold text-cyan-400 text-[11px]">TELEMETRY SNAPSHOT</span>
                        <span className="text-[10px] text-slate-500">{selectedIncident.id}</span>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-[10px]">
                        <div>
                          <span className="text-slate-500 block">Linear Speed:</span>
                          <span className="font-bold text-slate-200">
                            {selectedIncident.linearVelocity !== null ? `${selectedIncident.linearVelocity.toFixed(2)} m/s` : 'N/A'}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-500 block">Obstacle Clearance:</span>
                          <span className="font-bold text-slate-200">
                            {selectedIncident.minClearance !== null ? `${selectedIncident.minClearance.toFixed(2)} m` : 'N/A'}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-500 block">Time-to-Collision:</span>
                          <span className="font-bold text-amber-300">
                            {selectedIncident.ttc !== null ? `${selectedIncident.ttc.toFixed(2)} s` : 'N/A'}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-500 block">Threat Target:</span>
                          <span className="font-bold text-slate-200 truncate block">
                            {selectedIncident.highestRiskObstacle || 'N/A'}
                          </span>
                        </div>
                      </div>

                      {/* Quick Navigation to Flight Recorder */}
                      <button
                        data-testid="inspect-flight-recorder-button"
                        onClick={() => {
                          setOpen(false);
                          setFlightRecorderOpen(true);
                        }}
                        className="w-full mt-2 py-1.5 px-3 rounded bg-[#0e1629] hover:bg-[#1a2642] text-cyan-300 border border-cyan-800 text-[11px] font-bold flex items-center justify-center space-x-1 transition-colors"
                      >
                        <Radio className="w-3.5 h-3.5" />
                        <span>INSPECT IN FLIGHT RECORDER</span>
                        <ChevronRight className="w-3 h-3 ml-0.5" />
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-6 rounded-lg bg-[#050811] border border-[#1e2942] text-center space-y-2 text-slate-500 text-xs">
                  <MapPin className="w-6 h-6 mx-auto opacity-50" />
                  <p>Click any hotspot pin or high-risk zone on the warehouse blueprint to inspect exact telemetry snapshots.</p>
                </div>
              )}

              {/* Coverage & Telemetry Quality Deck */}
              <div className="p-3 rounded-lg bg-[#050811] border border-[#1e2942] space-y-2">
                <div className="flex items-center justify-between border-b border-[#1b263b] pb-1">
                  <span className="font-bold text-slate-300 text-[11px] flex items-center space-x-1">
                    <Route className="w-3 h-3 text-cyan-400" />
                    <span>FACILITY SPATIAL COVERAGE</span>
                  </span>
                  <span className="font-bold text-cyan-400 text-xs">
                    {heatmapData.coverage.coveragePercentage}%
                  </span>
                </div>

                <div className="space-y-1.5 text-[10px]">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Total Grid Resolution:</span>
                    <span className="font-bold text-slate-200">1m × 1m (1,280 cells)</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Observed (≥ 3 samples):</span>
                    <span className="font-bold text-emerald-400">{heatmapData.coverage.observedCells} cells</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Insufficient (1-2 samples):</span>
                    <span className="font-bold text-amber-400">{heatmapData.coverage.insufficientTelemetryCells} cells</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Untested Cold Cells:</span>
                    <span className="font-bold text-slate-400">{heatmapData.coverage.untestedCells} cells</span>
                  </div>
                </div>

                <div className="pt-1.5 border-t border-[#1e2942] text-[9px] text-slate-500 leading-tight">
                  <Info className="w-3 h-3 inline mr-1 text-slate-400" />
                  <span>{heatmapData.coverage.label}</span>
                </div>
              </div>
            </div>

            {/* Formula & Disclaimers Footer */}
            <div className="mt-4 pt-3 border-t border-[#1b263b] text-[9px] text-slate-500 space-y-1">
              <div className="flex items-center space-x-1 text-slate-400 font-bold">
                <Activity className="w-3 h-3 text-amber-400" />
                <span>SPATIAL RISK HEURISTIC FORMULA</span>
              </div>
              <p className="leading-snug">
                R(x,z) = Σ W(type) · exp(-d² / 2σ²) with physical bandwidth σ = 1.2m and cutoff radius = 3.0m.
              </p>
              <p className="text-amber-500/80 font-semibold">
                [CALCULATED HEURISTIC — NOT CERTIFIED SAFETY MEASUREMENT]
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
