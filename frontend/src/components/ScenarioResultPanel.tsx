import React, { useState } from 'react';
import {
  Sparkles,
  CheckCircle2,
  XCircle,
  ChevronUp,
  ChevronDown,
  Activity,
  Compass,
  Target,
  Disc,
  Clock,
  AlertOctagon,
} from 'lucide-react';
import { useSimulationStore } from '../state/useSimulationStore';
import { GeneratedScenario, ScenarioExecutionStatus } from '../types/scenario';

interface ScenarioResultPanelProps {
  forceScenario?: GeneratedScenario | null;
  forceStatus?: ScenarioExecutionStatus;
  forceRecordingId?: string | null;
}

export const ScenarioResultPanel: React.FC<ScenarioResultPanelProps> = ({
  forceScenario,
  forceStatus,
  forceRecordingId,
}) => {
  const storeMetadata = useSimulationStore((s) => s.activeScenarioMetadata);
  const activeScenarioMetadata = forceScenario !== undefined ? forceScenario : storeMetadata;

  const storeStatus = useSimulationStore((s) => s.scenarioExecutionStatus);
  const scenarioExecutionStatus = forceStatus !== undefined ? forceStatus : storeStatus;

  const storeFlightStats = useSimulationStore((s) => s.flightRecorderStats);
  const flightRecorderStats =
    forceRecordingId !== undefined
      ? { ...storeFlightStats, activeRecordingId: forceRecordingId }
      : storeFlightStats;

  const robotPose = useSimulationStore((s) => s.robotPose);
  const sensorData = useSimulationStore((s) => s.sensorData);
  const robotStatus = useSimulationStore((s) => s.robotStatus);
  const missionMetrics = useSimulationStore((s) => s.missionMetrics);
  const minObservedClearance = useSimulationStore((s) => s.minObservedClearance);
  const minObservedTtc = useSimulationStore((s) => s.minObservedTtc);
  const destinations = useSimulationStore((s) => s.destinations);
  const selectedDestinationId = useSimulationStore((s) => s.selectedDestinationId);
  const setScenarioGeneratorOpen = useSimulationStore((s) => s.setScenarioGeneratorOpen);
  const setFlightRecorderOpen = useSimulationStore((s) => s.setFlightRecorderOpen);
  const clearActiveScenario = useSimulationStore((s) => s.clearActiveScenario);
  const navState = useSimulationStore((s) => s.navState);
  const authoritativeRecord = useSimulationStore((s) => s.authoritativeExecutionRecord);

  const [isMinimized, setIsMinimized] = useState(false);

  if (!activeScenarioMetadata) {
    return null;
  }

  const activeDest =
    destinations.find((d) => d.id === selectedDestinationId) || destinations[0];
  const distToGoal = activeDest
    ? Math.hypot(
        activeDest.position[0] - robotPose.position[0],
        activeDest.position[2] - robotPose.position[2]
      )
    : 0;

  const isGemini = activeScenarioMetadata.generator_engine === 'GEMINI_1_5_FLASH';

  // Determine status display config
  const getStatusBadge = (status: ScenarioExecutionStatus) => {
    switch (status) {
      case 'RUNNING':
        return {
          label: 'RUNNING',
          subLabel: 'Adversarial Mission Active',
          bg: 'bg-cyan-950/80',
          border: 'border-cyan-500',
          text: 'text-cyan-300',
          pulse: true,
          icon: <Activity className="w-3.5 h-3.5 animate-spin" style={{ animationDuration: '4s' }} />,
        };
      case 'COMPLETED':
        return {
          label: 'COMPLETED',
          subLabel: 'AMR Delivered to Goal',
          bg: 'bg-emerald-950/80',
          border: 'border-emerald-500',
          text: 'text-emerald-300',
          pulse: false,
          icon: <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />,
        };
      case 'FAILED':
        return {
          label: 'FAILED',
          subLabel: 'Collision / Path Impasse',
          bg: 'bg-rose-950/80',
          border: 'border-rose-500',
          text: 'text-rose-300',
          pulse: false,
          icon: <AlertOctagon className="w-3.5 h-3.5 text-rose-400" />,
        };
      case 'ABORTED':
        return {
          label: 'ABORTED',
          subLabel: 'Halted by Operator',
          bg: 'bg-amber-950/80',
          border: 'border-amber-500',
          text: 'text-amber-300',
          pulse: false,
          icon: <XCircle className="w-3.5 h-3.5 text-amber-400" />,
        };
      case 'STAGED':
      default:
        return {
          label: 'STAGED',
          subLabel: 'Physics Verified & Ready',
          bg: 'bg-indigo-950/80',
          border: 'border-indigo-500',
          text: 'text-indigo-300',
          pulse: false,
          icon: <Clock className="w-3.5 h-3.5 text-indigo-400" />,
        };
    }
  };

  const statusConfig = getStatusBadge(scenarioExecutionStatus);

  // Authoritative metrics derived from single source of truth
  const displayCollisionCount = authoritativeRecord?.collisionCount ?? robotStatus.collisionCount;
  const displayNearMissCount = authoritativeRecord?.nearMissCount ?? (missionMetrics.nearMisses || 0);

  // Clearance formatting (distinct observed minimum vs instantaneous clearance)
  const observedClearance =
    authoritativeRecord?.minObservedClearance !== null && authoritativeRecord?.minObservedClearance !== undefined
      ? authoritativeRecord.minObservedClearance
      : minObservedClearance < 50
      ? minObservedClearance
      : null;
  const clearanceText =
    observedClearance !== null && observedClearance < 50
      ? `${observedClearance.toFixed(2)}m`
      : 'N/A';

  // TTC formatting: Validate whether any dynamic hazard exists in the scene
  const hasDynamicActors = activeScenarioMetadata.actors && activeScenarioMetadata.actors.length > 0;
  const curTtc = sensorData.ttc;
  const observedTtc =
    authoritativeRecord?.minObservedTtc !== null && authoritativeRecord?.minObservedTtc !== undefined
      ? authoritativeRecord.minObservedTtc
      : minObservedTtc < 50
      ? minObservedTtc
      : null;

  const ttcText = !hasDynamicActors || (curTtc == null && observedTtc == null)
    ? 'NONE'
    : observedTtc !== null && observedTtc < 50
    ? `${observedTtc.toFixed(2)}s`
    : curTtc != null && curTtc < 50
    ? `${curTtc.toFixed(2)}s`
    : 'NONE';

  // Safety status badge synchronized across all panels
  const safetyStatus = authoritativeRecord?.safetyStatus ?? sensorData.safetyStatus ?? 'SAFE';
  const safetyBadge =
    displayCollisionCount > 0 || safetyStatus === 'CRITICAL'
      ? { label: 'CRITICAL', color: 'bg-rose-950 text-rose-300 border-rose-600' }
      : safetyStatus === 'WARNING'
      ? { label: 'CAUTION', color: 'bg-amber-950 text-amber-300 border-amber-600' }
      : { label: 'CLEAR', color: 'bg-emerald-950 text-emerald-300 border-emerald-600' };

  return (
    <div
      data-testid="scenario-result-panel"
      className="absolute top-20 right-6 z-30 w-84 sm:w-92 select-none font-mono pointer-events-auto shadow-2xl transition-all duration-200"
    >
      <div className="bg-[#0b101d]/95 backdrop-blur-md border border-cyan-800/80 rounded-xl overflow-hidden shadow-2xl shadow-cyan-950/50">
        {/* === HEADER BAR === */}
        <div className="flex items-center justify-between px-3.5 py-2.5 bg-[#080c16] border-b border-[#1c273e]">
          <div className="flex items-center space-x-2 min-w-0">
            <div className="p-1 rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 shrink-0">
              <Sparkles className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center space-x-1.5">
                <span className="text-xs font-bold text-slate-100 tracking-wider truncate">
                  {activeScenarioMetadata.title}
                </span>
              </div>
              <div className="flex items-center space-x-1.5 text-[10px] text-slate-400">
                <span className="truncate">{activeScenarioMetadata.scenario_id}</span>
                <span>•</span>
                <span
                  className={`px-1.5 py-0.2 rounded border font-semibold text-[9px] uppercase ${
                    isGemini
                      ? 'bg-purple-950/80 text-purple-300 border-purple-600'
                      : 'bg-amber-950/80 text-amber-300 border-amber-600'
                  }`}
                >
                  {isGemini ? 'Gemini 1.5 Flash' : 'Deterministic'}
                </span>
              </div>
            </div>
          </div>

          <button
            onClick={() => setIsMinimized((prev) => !prev)}
            title={isMinimized ? 'Expand Scenario Results' : 'Minimize Panel'}
            className="p-1 text-slate-400 hover:text-white hover:bg-slate-800 rounded transition shrink-0 ml-1"
          >
            {isMinimized ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          </button>
        </div>

        {/* === MINIMIZED SUMMARY STRIP === */}
        {isMinimized ? (
          <div className="px-3.5 py-2 flex items-center justify-between text-xs bg-[#0b101d]/90">
            <div className="flex items-center space-x-2">
              <span className={`px-2 py-0.5 rounded border text-[10px] font-bold flex items-center space-x-1 ${statusConfig.bg} ${statusConfig.border} ${statusConfig.text}`}>
                {statusConfig.icon}
                <span>{statusConfig.label}</span>
              </span>
              <span className="text-[11px] text-slate-300 font-medium">
                Goal: {distToGoal.toFixed(1)}m
              </span>
            </div>
            <div className="text-[10px] text-slate-400 flex items-center space-x-2">
              <span>Clr: {clearanceText}</span>
              <span>•</span>
              <span>Coll: {displayCollisionCount}</span>
            </div>
          </div>
        ) : (
          /* === EXPANDED TELEMETRY & RESULTS DECK === */
          <div className="p-3.5 space-y-3 text-xs">
            {/* Status Banner */}
            <div
              className={`p-2.5 rounded-lg border flex items-center justify-between ${statusConfig.bg} ${statusConfig.border} ${
                statusConfig.pulse ? 'ring-1 ring-cyan-500/50' : ''
              }`}
            >
              <div className="flex items-center space-x-2">
                <div className="p-1 rounded bg-black/40 text-cyan-400 shrink-0">
                  {statusConfig.icon}
                </div>
                <div>
                  <div className={`text-xs font-bold ${statusConfig.text}`}>
                    {statusConfig.label}
                  </div>
                  <div className="text-[10px] text-slate-400">
                    {statusConfig.subLabel}
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-[10px] text-slate-400 uppercase">Nav State</div>
                <div className="text-xs font-semibold text-slate-200">{navState}</div>
              </div>
            </div>

            {/* Safety Metrics Grid */}
            <div className="grid grid-cols-2 gap-2 text-center">
              <div className="p-2 rounded-lg bg-[#0e1628] border border-slate-800">
                <span className="text-[10px] text-slate-400 block uppercase">Collisions</span>
                <span
                  className={`text-base font-extrabold ${
                    displayCollisionCount > 0 ? 'text-rose-400 animate-pulse' : 'text-slate-200'
                  }`}
                >
                  {displayCollisionCount}
                </span>
              </div>

              <div className="p-2 rounded-lg bg-[#0e1628] border border-slate-800">
                <span className="text-[10px] text-slate-400 block uppercase">Near-Misses</span>
                <span
                  className={`text-base font-extrabold ${
                    displayNearMissCount > 0 ? 'text-amber-400' : 'text-slate-200'
                  }`}
                >
                  {displayNearMissCount}
                </span>
              </div>

              <div className="p-2 rounded-lg bg-[#0e1628] border border-slate-800">
                <span className="text-[10px] text-slate-400 block uppercase">Min Clearance</span>
                <span className="text-sm font-bold text-cyan-300">{clearanceText}</span>
              </div>

              <div className="p-2 rounded-lg bg-[#0e1628] border border-slate-800">
                <span className="text-[10px] text-slate-400 block uppercase">Min Dynamic TTC</span>
                <span className="text-sm font-bold text-amber-300">{ttcText}</span>
              </div>
            </div>

            {/* AMR Kinematics Row */}
            <div className="p-2.5 rounded-lg bg-[#080d19] border border-slate-800/80 space-y-1.5">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-slate-400 flex items-center space-x-1">
                  <Compass className="w-3.5 h-3.5 text-cyan-400" />
                  <span>AMR Position</span>
                </span>
                <span className="text-slate-200 font-semibold">
                  [{robotPose.position[0].toFixed(2)}, {robotPose.position[2].toFixed(2)}]
                </span>
              </div>

              <div className="flex items-center justify-between text-[11px]">
                <span className="text-slate-400 flex items-center space-x-1">
                  <Target className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Target Destination</span>
                </span>
                <span className="text-emerald-300 font-semibold truncate max-w-[150px]">
                  {activeDest?.name || 'Goal'}
                </span>
              </div>

              <div className="flex items-center justify-between text-[11px]">
                <span className="text-slate-400">Distance to Goal</span>
                <span className="text-cyan-300 font-bold">{distToGoal.toFixed(2)}m</span>
              </div>

              <div className="flex items-center justify-between text-[11px]">
                <span className="text-slate-400">Current Safety</span>
                <span className={`px-1.5 py-0.2 rounded border text-[9px] font-bold ${safetyBadge.color}`}>
                  {safetyBadge.label}
                </span>
              </div>
            </div>

            {/* Generated Entities Count */}
            <div className="flex items-center justify-between px-2 py-1.5 rounded-lg bg-slate-900/60 border border-slate-800 text-[11px]">
              <span className="text-slate-400">Adversarial Objects</span>
              <span className="text-slate-200 font-medium">
                {activeScenarioMetadata.actors.length} actors, {activeScenarioMetadata.static_hazards.length} hazards
              </span>
            </div>

            {/* Flight Recorder Telemetry Session */}
            {flightRecorderStats.activeRecordingId && (
              <div className="p-2 rounded-lg bg-slate-900/80 border border-slate-800 flex items-center justify-between">
                <div className="flex items-center space-x-1.5 text-[11px]">
                  <Disc className="w-3.5 h-3.5 text-rose-400 animate-pulse" />
                  <span className="text-slate-300 font-semibold truncate max-w-[140px]">
                    {flightRecorderStats.activeRecordingId}
                  </span>
                </div>
                <button
                  onClick={() => setFlightRecorderOpen(true)}
                  className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-cyan-300 hover:text-cyan-200 border border-slate-700 text-[10px] font-semibold transition"
                >
                  View Flight Data
                </button>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex items-center space-x-2 pt-1">
              <button
                onClick={() => setScenarioGeneratorOpen(true)}
                className="flex-1 py-1.5 px-2 rounded-lg bg-cyan-950/80 hover:bg-cyan-900/90 text-cyan-200 border border-cyan-600/60 text-xs font-semibold transition flex items-center justify-center space-x-1"
              >
                <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                <span>Re-open Generator</span>
              </button>
              <button
                onClick={clearActiveScenario}
                title="Unload active scenario from simulation"
                className="py-1.5 px-2.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 text-xs transition"
              >
                Clear
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
