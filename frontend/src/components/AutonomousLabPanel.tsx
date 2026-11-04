import React from 'react';
import {
  Compass,
  Play,
  Pause,
  Square,
  RotateCcw,
  RefreshCw,
  Navigation,
  AlertTriangle,
  Target,
  Route,
  Activity,
  Cpu,
  AlertOctagon,
  CheckCircle2,
  ShieldAlert,
  ShieldCheck,
  Radio,
  Award,
  ChevronRight,
  ChevronLeft,
} from 'lucide-react';
import { useSimulationStore } from '../state/useSimulationStore';
import { NavState } from '../types/simulation';

interface AutonomousLabPanelProps {
  forceMode?: string;
  forceCrashed?: boolean;
}

export const AutonomousLabPanel: React.FC<AutonomousLabPanelProps> = ({ forceMode, forceCrashed }) => {
  const storeMode = useSimulationStore((s) => s.mode);
  const mode = forceMode || storeMode;
  const currentTime = useSimulationStore((s) => s.currentTime);
  const navState = useSimulationStore((s) => s.navState);
  const plannedPath = useSimulationStore((s) => s.plannedPath);
  const currentWaypointIndex = useSimulationStore((s) => s.currentWaypointIndex);
  const selectedDestinationId = useSimulationStore((s) => s.selectedDestinationId);
  const destinations = useSimulationStore((s) => s.destinations);
  const sensorData = useSimulationStore((s) => s.sensorData);
  const missionMetrics = useSimulationStore((s) => s.missionMetrics);
  const robotPose = useSimulationStore((s) => s.robotPose);
  const diagnostics = useSimulationStore((s) => s.diagnostics);

  const startMission = useSimulationStore((s) => s.startMission);
  const pauseMission = useSimulationStore((s) => s.pauseMission);
  const resumeMission = useSimulationStore((s) => s.resumeMission);
  const abortMission = useSimulationStore((s) => s.abortMission);
  const selectDestination = useSimulationStore((s) => s.selectDestination);
  const triggerReplan = useSimulationStore((s) => s.triggerReplan);
  const activeScenarioMetadata = useSimulationStore((s) => s.activeScenarioMetadata);
  const scenarioExecutionStatus = useSimulationStore((s) => s.scenarioExecutionStatus);

  // Collaborative Multiplayer State
  const isMultiplayerActive = useSimulationStore((s) => s.isMultiplayerActive);
  const userRole = useSimulationStore((s) => s.userRole);

  // Flight Recorder State
  const setFlightRecorderOpen = useSimulationStore((s) => s.setFlightRecorderOpen);
  const isRecordingFlightData = useSimulationStore((s) => s.isRecordingFlightData);

  // Benchmark Center State
  const setBenchmarkCenterOpen = useSimulationStore((s) => s.setBenchmarkCenterOpen);
  const saveActiveSessionAsBenchmark = useSimulationStore((s) => s.saveActiveSessionAsBenchmark);

  // Authoritative metrics & Layout drawer state
  const authoritativeRecord = useSimulationStore((s) => s.authoritativeExecutionRecord);
  const minObservedClearance = useSimulationStore((s) => s.minObservedClearance);
  const isRightPanelOpen = useSimulationStore((s) => s.isRightPanelOpen);
  const toggleRightPanel = useSimulationStore((s) => s.toggleRightPanel);

  // Crash Recovery State (Falling Object Scenario)
  const crashState = useSimulationStore((s) => s.crashState);
  const restartMissionAfterCrash = useSimulationStore((s) => s.restartMissionAfterCrash);
  const isCrashed = forceCrashed !== undefined ? forceCrashed : crashState.hasCrashed;

  if (mode !== 'autonomous') return null;

  const activeDestination =
    destinations.find((d) => d.id === selectedDestinationId) || destinations[0];

  const distanceToGoal = activeDestination
    ? Math.hypot(
        activeDestination.position[0] - robotPose.position[0],
        activeDestination.position[2] - robotPose.position[2]
      )
    : 0;

  const currentWp =
    currentWaypointIndex < plannedPath.length ? plannedPath[currentWaypointIndex] : null;

  const getNavBadge = (state: NavState) => {
    switch (state) {
      case 'IDLE':
        return { label: 'STANDBY', color: 'bg-slate-800 text-slate-300 border-slate-700' };
      case 'PLANNING':
        return { label: 'A* PLANNING', color: 'bg-cyan-950 text-cyan-300 border-cyan-700 animate-pulse' };
      case 'MOVING':
        return { label: 'PURSUIT ACTIVE', color: 'bg-emerald-950 text-emerald-300 border-emerald-700' };
      case 'AVOIDING':
        return { label: 'REACTIVE AVOID', color: 'bg-amber-950 text-amber-300 border-amber-700 animate-pulse' };
      case 'STOPPED':
        return { label: 'HOLDING', color: 'bg-rose-950 text-rose-300 border-rose-700' };
      case 'COMPLETED':
        return { label: 'DESTINATION REACHED', color: 'bg-emerald-900 text-emerald-200 border-emerald-500 font-bold' };
      case 'FAILED':
        return { label: 'PATH UNREACHABLE', color: 'bg-rose-900 text-rose-200 border-rose-500 font-bold' };
    }
  };

  const navBadge = getNavBadge(navState);
  const timeSinceLastProgress = Math.max(0, currentTime - diagnostics.lastMovedTime);

  // Authoritative metrics derived from single source of truth
  const totalCollisions = authoritativeRecord?.collisionCount ?? missionMetrics.collisions;
  const totalNearMisses = authoritativeRecord?.nearMissCount ?? (missionMetrics.nearMisses || 0);

  const currentClearanceVal = authoritativeRecord?.currentClearance ?? sensorData.minClearance;
  const currentClearanceText =
    currentClearanceVal !== null && currentClearanceVal !== undefined && currentClearanceVal < 50
      ? `${currentClearanceVal.toFixed(2)} m`
      : 'N/A';

  const observedClearanceVal =
    authoritativeRecord?.minObservedClearance !== null && authoritativeRecord?.minObservedClearance !== undefined
      ? authoritativeRecord.minObservedClearance
      : minObservedClearance < 50
      ? minObservedClearance
      : null;

  const observedClearanceText =
    observedClearanceVal !== null && observedClearanceVal < 50
      ? `${observedClearanceVal.toFixed(2)} m`
      : 'N/A';

  const authoritativeSafetyStatus = authoritativeRecord?.safetyStatus ?? sensorData.safetyStatus ?? 'SAFE';
  const hasDynamicActors = !activeScenarioMetadata || (activeScenarioMetadata.actors && activeScenarioMetadata.actors.length > 0);
  const curTtc = sensorData.ttc;
  const displayTtcText =
    !hasDynamicActors
      ? 'NONE'
      : curTtc !== null && curTtc !== undefined && !isNaN(curTtc)
      ? `${curTtc.toFixed(1)} s`
      : 'NONE';

  if (!isRightPanelOpen) {
    return (
      <div
        data-testid="autonomous-lab-panel"
        className="absolute top-20 bottom-6 right-6 z-20 pointer-events-auto flex items-start justify-end"
      >
        <button
          onClick={toggleRightPanel}
          data-testid="expand-autonomous-lab-btn"
          className="px-3 py-2 rounded-xl bg-[#0d1322]/95 border border-cyan-700/80 text-cyan-300 font-mono text-xs font-bold shadow-2xl flex items-center space-x-1.5 hover:bg-cyan-950 transition-colors pointer-events-auto cursor-pointer"
          title="Expand Autonomous Lab Controls"
        >
          <ChevronLeft className="w-4 h-4 text-cyan-400" />
          <Compass className="w-4 h-4 text-cyan-400" />
          <span>AUTONOMOUS LAB</span>
        </button>
      </div>
    );
  }

  return (
    <div
      data-testid="autonomous-lab-panel"
      className="absolute top-20 bottom-6 right-6 z-20 w-84 sm:w-92 max-h-[calc(100vh-6.5rem)] flex flex-col font-mono select-none pointer-events-auto"
    >
      {/* Main Autonomous Control Panel */}
      <div className="flex-1 min-h-0 flex flex-col rounded-xl bg-[#0d1322]/95 backdrop-blur-md border border-cyan-800/60 shadow-2xl shadow-cyan-950/40 overflow-hidden">
        {/* Panel Header */}
        <div className="shrink-0 flex items-center justify-between px-3.5 py-3 border-b border-[#1e2942] text-xs bg-[#090d18]">
          <div className="flex items-center space-x-2">
            <Compass className="w-4 h-4 text-cyan-400 animate-spin" style={{ animationDuration: '8s' }} />
            <span className="font-extrabold text-slate-100 tracking-wider">AUTONOMOUS LAB</span>
          </div>
          <div className="flex items-center space-x-1.5">
            <span className={`text-[10px] px-2 py-0.5 rounded border font-semibold ${navBadge.color}`}>
              {navBadge.label}
            </span>
            <button
              onClick={toggleRightPanel}
              data-testid="collapse-autonomous-lab-btn"
              title="Collapse Autonomous Lab Panel"
              className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 transition ml-1"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Scrollable Panel Content */}
        <div className="flex-1 min-h-0 overflow-y-auto p-3.5 space-y-3">
          {/* Active AI Scenario Banner */}
          {activeScenarioMetadata && (
            <div
              data-testid="autonomous-active-scenario-banner"
              className="p-2.5 rounded-xl bg-cyan-950/60 border border-cyan-700/60 space-y-1.5 shadow-md shadow-cyan-950/30"
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-cyan-300 uppercase tracking-wider flex items-center space-x-1">
                  <span>AI SCENARIO ACTIVE</span>
                </span>
                <span className="text-[9px] px-1.5 py-0.2 rounded bg-cyan-900/60 text-cyan-200 border border-cyan-700 font-mono">
                  {scenarioExecutionStatus}
                </span>
              </div>
              <div className="text-xs font-bold text-slate-100 truncate">
                {activeScenarioMetadata.title}
              </div>
              <div className="text-[10px] text-slate-400 flex items-center justify-between">
                <span>{activeScenarioMetadata.actors.length} actors</span>
                <span>{activeScenarioMetadata.static_hazards.length} hazards</span>
                <span className="text-cyan-400 capitalize">{activeScenarioMetadata.difficulty}</span>
              </div>
            </div>
          )}

          {/* Falling Object Crash Recovery Notification & Persistent Restart Action */}
          {isCrashed && (
            <div
              data-testid="crash-recovery-panel"
              className="p-3 rounded-xl bg-rose-950/90 border border-rose-600 space-y-2 shadow-xl shadow-rose-950/60 animate-in fade-in duration-200"
            >
              <div className="flex items-center space-x-2 text-rose-300 font-bold text-xs">
                <AlertOctagon className="w-4 h-4 text-rose-400 shrink-0" />
                <span>COLLISION HALT ACTIVE</span>
              </div>
              <p className="text-[11px] text-rose-100/90 leading-tight">
                A falling object has struck the robot. Autonomous navigation is halted and the scene is paused.
              </p>
              <button
                onClick={restartMissionAfterCrash}
                data-testid="right-panel-restart-mission-btn"
                className="w-full flex items-center justify-center space-x-2 py-2 px-3 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs transition-colors shadow-md shadow-rose-900/50 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>RESTART MISSION</span>
              </button>
            </div>
          )}

          {/* Failure / Unreachable Route Explanation Box */}
          {navState === 'FAILED' && (
            <div className="p-2.5 rounded-lg bg-rose-950/80 border border-rose-600/80 text-rose-200 text-xs space-y-1 animate-in fade-in duration-200">
              <div className="flex items-center space-x-1.5 font-bold text-rose-300">
                <AlertOctagon className="w-4 h-4" />
                <span>ROBOT STOPPED: UNREACHABLE</span>
              </div>
              <p className="text-[11px] leading-relaxed text-rose-100">
                {diagnostics.failureExplanation ||
                  'All available warehouse corridors to the selected destination are obstructed by physical obstacles or barricades.'}
              </p>
            </div>
          )}

        {/* Destination Target Selector */}
        <div className="space-y-1">
          <label className="text-[10px] text-slate-400 font-semibold flex items-center space-x-1">
            <Target className="w-3 h-3 text-cyan-400" />
            <span>MISSION DESTINATION</span>
          </label>
          <select
            value={selectedDestinationId}
            onChange={(e) => selectDestination(e.target.value)}
            disabled={navState === 'MOVING' || navState === 'AVOIDING'}
            className="w-full bg-[#070a13] border border-[#1e2942] text-cyan-300 text-xs rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-cyan-500 disabled:opacity-60 transition-colors"
          >
            {destinations.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>

        {/* Mission Action Buttons */}
        {isMultiplayerActive && userRole === 'controller' ? (
          <div className="p-2.5 rounded-lg bg-[#070a13] border border-amber-900/40 text-[11px] text-amber-300 space-y-1">
            <div className="flex items-center space-x-1.5 font-bold">
              <AlertOctagon className="w-3.5 h-3.5 text-amber-400" />
              <span>MISSION CONTROLS (OPERATOR AUTHORITY)</span>
            </div>
            <p className="text-[10px] text-slate-400 leading-snug">
              Autonomous mission starts, pauses, and rerouting are executed by the Robot Operator. You can observe live waypoint progression and inject dynamic hazards.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2 pt-0.5">
            {navState === 'IDLE' || navState === 'COMPLETED' || navState === 'FAILED' ? (
              <button
                onClick={() => startMission()}
                className="col-span-2 flex items-center justify-center space-x-2 py-2 px-3 rounded-lg bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-bold text-xs shadow-lg shadow-cyan-600/30 transition-all"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>START AUTONOMOUS MISSION</span>
              </button>
            ) : navState === 'STOPPED' ? (
              <button
                onClick={resumeMission}
                className="flex items-center justify-center space-x-1.5 py-2 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition-colors"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>RESUME</span>
              </button>
            ) : (
              <button
                onClick={pauseMission}
                className="flex items-center justify-center space-x-1.5 py-2 px-3 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs transition-colors"
              >
                <Pause className="w-3.5 h-3.5 fill-current" />
                <span>PAUSE</span>
              </button>
            )}

            {navState !== 'IDLE' && navState !== 'COMPLETED' && (
              <button
                onClick={abortMission}
                className="flex items-center justify-center space-x-1 py-1.5 px-3 rounded-lg bg-[#141d33] hover:bg-rose-950 text-slate-300 hover:text-rose-300 border border-[#1e2942] text-xs transition-colors"
              >
                <Square className="w-3 h-3 fill-current" />
                <span>ABORT</span>
              </button>
            )}

            <button
              onClick={() => startMission('charging-dock')}
              className="flex items-center justify-center space-x-1 py-1.5 px-2 rounded-lg bg-[#070a13] hover:bg-[#141d33] text-slate-300 hover:text-cyan-300 border border-[#1e2942] text-[11px] transition-colors"
              title="Calculate path back to charging station"
            >
              <RotateCcw className="w-3 h-3" />
              <span>RETURN TO BASE</span>
            </button>

            <button
              onClick={triggerReplan}
              className="flex items-center justify-center space-x-1 py-1.5 px-2 rounded-lg bg-[#070a13] hover:bg-[#141d33] text-slate-300 hover:text-cyan-300 border border-[#1e2942] text-[11px] transition-colors"
              title="Recalculate route immediately"
            >
              <RefreshCw className="w-3 h-3" />
              <span>REPLAN NOW</span>
            </button>
          </div>
        )}

        {/* Live Navigation & Waypoint Telemetry */}
        <div className="p-2.5 rounded-lg bg-[#070a13] border border-[#1e2942] space-y-1.5 text-xs">
          <div className="flex items-center justify-between text-slate-400 text-[10px]">
            <span className="flex items-center space-x-1">
              <Navigation className="w-3 h-3 text-cyan-400" />
              <span>WAYPOINT PROGRESS</span>
            </span>
            <span className="text-cyan-300 font-bold">
              {plannedPath.length > 0
                ? `${currentWaypointIndex + 1} / ${plannedPath.length}`
                : 'NO ROUTE'}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 text-[11px] pt-1 border-t border-[#1e2942]/60">
            <div>
              <span className="text-slate-500 text-[10px] block">DISTANCE TO GOAL</span>
              <span className="text-sm font-black text-slate-100">{distanceToGoal.toFixed(1)} m</span>
            </div>
            <div>
              <span className="text-slate-500 text-[10px] block">ACTIVE WAYPOINT</span>
              <span className="text-xs font-bold text-cyan-300 truncate block">
                {currentWp ? `[${currentWp[0].toFixed(1)}, ${currentWp[1].toFixed(1)}]` : 'N/A'}
              </span>
            </div>
          </div>
        </div>

        {/* Obstacle Proximity & Sensor Cone Monitor */}
        <div className="p-2.5 rounded-lg bg-[#070a13] border border-[#1e2942] space-y-2 text-xs">
          <div className="flex items-center justify-between text-[10px]">
            <span className="flex items-center space-x-1 text-slate-400">
              <Activity className="w-3 h-3 text-cyan-400" />
              <span>LIDAR SENSOR CONE</span>
            </span>
            <span
              className={`font-bold px-1.5 py-0.2 rounded text-[9px] uppercase ${
                sensorData.riskLevel === 'clear'
                  ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                  : sensorData.riskLevel === 'caution'
                  ? 'bg-amber-950 text-amber-300 border border-amber-800'
                  : 'bg-rose-950 text-rose-300 border border-rose-800 animate-pulse'
              }`}
            >
              {sensorData.riskLevel}
            </span>
          </div>

          {/* Proximity Readings (Left, Forward, Right) */}
          <div className="grid grid-cols-3 gap-1 text-center font-mono">
            <div className="p-1 rounded bg-[#0d1322] border border-[#1e2942]">
              <div className="text-[9px] text-slate-500">LEFT</div>
              <div className="text-xs font-bold text-slate-200">
                {sensorData.leftDist.toFixed(1)}m
              </div>
            </div>
            <div className="p-1 rounded bg-[#0d1322] border border-[#1e2942]">
              <div className="text-[9px] text-slate-500">FORWARD</div>
              <div
                className={`text-xs font-bold ${
                  sensorData.forwardDist < 0.85
                    ? 'text-rose-400'
                    : sensorData.forwardDist < 2.4
                    ? 'text-amber-400'
                    : 'text-cyan-300'
                }`}
              >
                {sensorData.forwardDist.toFixed(1)}m
              </div>
            </div>
            <div className="p-1 rounded bg-[#0d1322] border border-[#1e2942]">
              <div className="text-[9px] text-slate-500">RIGHT</div>
              <div className="text-xs font-bold text-slate-200">
                {sensorData.rightDist.toFixed(1)}m
              </div>
            </div>
          </div>

          {sensorData.closestObstacle && (
            <div className="text-[10px] text-slate-400 truncate flex items-center space-x-1 pt-0.5">
              <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0" />
              <span className="truncate">Threat: {sensorData.closestObstacle}</span>
            </div>
          )}
        </div>

        {/* Safety Intelligence & Time-to-Collision (TTC) Card */}
        <div data-testid="safety-intelligence-card" className="p-2.5 rounded-lg bg-[#070a13] border border-cyan-800/50 space-y-2 text-xs">
          <div className="flex items-center justify-between text-[10px] pb-1 border-b border-[#1e2942]/60">
            <span className="flex items-center space-x-1.5 font-bold text-slate-200">
              {authoritativeSafetyStatus === 'CRITICAL' ? (
                <ShieldAlert className="w-3.5 h-3.5 text-rose-400 animate-pulse" />
              ) : authoritativeSafetyStatus === 'WARNING' ? (
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
              ) : (
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              )}
              <span>SAFETY INTELLIGENCE</span>
            </span>
            <span
              data-testid="safety-status-badge"
              className={`font-bold px-2 py-0.5 rounded text-[9px] uppercase border ${
                authoritativeSafetyStatus === 'CRITICAL'
                  ? 'bg-rose-950 text-rose-200 border-rose-500 animate-pulse'
                  : authoritativeSafetyStatus === 'WARNING'
                  ? 'bg-amber-950 text-amber-200 border-amber-500'
                  : 'bg-emerald-950 text-emerald-200 border-emerald-600'
              }`}
            >
              {authoritativeSafetyStatus}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 text-[10px]">
            <div className="p-1.5 rounded bg-[#0d1322] border border-[#1e2942]">
              <span className="text-slate-500 text-[9px] block">DYNAMIC TTC</span>
              <span
                data-testid="dynamic-ttc-value"
                className={`text-sm font-black ${
                  curTtc !== null && curTtc !== undefined && curTtc <= 1.5
                    ? 'text-rose-400 animate-pulse'
                    : curTtc !== null && curTtc !== undefined && curTtc <= 3.5
                    ? 'text-amber-400'
                    : 'text-emerald-300'
                }`}
              >
                {displayTtcText}
              </span>
            </div>

            <div className="p-1.5 rounded bg-[#0d1322] border border-[#1e2942]">
              <div className="flex items-center justify-between text-slate-500 text-[9px]">
                <span>MIN CLEARANCE</span>
                <span className="text-[8px] text-cyan-400 font-mono">OBSERVED</span>
              </div>
              <span
                data-testid="min-clearance-value"
                className={`text-sm font-black ${
                  observedClearanceVal !== null && observedClearanceVal <= 0.45
                    ? 'text-rose-400'
                    : observedClearanceVal !== null && observedClearanceVal <= 1.2
                    ? 'text-amber-400'
                    : 'text-slate-200'
                }`}
              >
                {observedClearanceText}
              </span>
              <div className="text-[8px] text-slate-500 flex items-center justify-between mt-0.5 border-t border-[#1e2942]/40 pt-0.5">
                <span>Current:</span>
                <span className="text-slate-300 font-mono">{currentClearanceText}</span>
              </div>
            </div>
          </div>

          <div className="space-y-1 text-[10px] pt-1 border-t border-[#1e2942]/40">
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Trajectory Risk:</span>
              <span
                data-testid="collision-course-status"
                className={`font-bold px-1.5 py-0.2 rounded text-[9px] ${
                  sensorData.isCollisionCourse
                    ? 'bg-rose-950 text-rose-300 border border-rose-800 animate-pulse'
                    : 'bg-emerald-950/60 text-emerald-300'
                }`}
              >
                {sensorData.isCollisionCourse ? 'COLLISION COURSE' : 'CLEAR'}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-slate-400">Threat Target:</span>
              <span data-testid="highest-risk-threat" className="font-bold text-amber-300 truncate max-w-[140px]">
                {sensorData.highestRiskObstacle || 'None Detected'}
              </span>
            </div>

            <div className="flex items-center justify-between pt-0.5 text-[9px]">
              <span className="text-slate-500">INCIDENTS:</span>
              <span className="space-x-2">
                <span data-testid="collisions-counter" className={totalCollisions > 0 ? 'text-rose-400 font-bold' : 'text-slate-400'}>
                  COLLISIONS: {totalCollisions}
                </span>
                <span data-testid="near-misses-counter" className={totalNearMisses > 0 ? 'text-amber-400 font-bold' : 'text-slate-400'}>
                  NEAR-MISSES: {totalNearMisses}
                </span>
              </span>
            </div>

            {/* Quick Black Box Flight Recorder launch */}
            <div className="pt-1.5 border-t border-[#1e2942]/60 flex items-center justify-between">
              <span className="text-[9px] text-slate-500">BLACK BOX TELEMETRY:</span>
              <button
                data-testid="lab-open-flight-recorder-btn"
                onClick={() => setFlightRecorderOpen(true)}
                className="flex items-center space-x-1 px-2 py-0.5 rounded bg-cyan-950/60 hover:bg-cyan-900/60 text-cyan-300 border border-cyan-700/60 text-[9px] font-bold transition-all"
              >
                <Radio className={`w-3 h-3 ${isRecordingFlightData ? 'text-rose-400 animate-pulse' : 'text-cyan-400'}`} />
                <span>{isRecordingFlightData ? 'RECORDING ACTIVE' : 'OPEN FLIGHT RECORDER'}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Real-time Diagnostics (Issue 1 Required Diagnostics) */}
        <div className="p-2.5 rounded-lg bg-[#070a13] border border-cyan-900/40 space-y-1.5 text-[11px]">
          <div className="flex items-center justify-between text-[10px] text-slate-400 border-b border-[#1e2942]/60 pb-1">
            <span className="flex items-center space-x-1 font-bold text-cyan-300">
              <Cpu className="w-3 h-3 text-cyan-400" />
              <span>ROBOT RISK DIAGNOSTICS</span>
            </span>
            <span
              className={`text-[9px] px-1 rounded uppercase font-bold ${
                diagnostics.routeValidity === 'valid'
                  ? 'bg-emerald-950 text-emerald-400'
                  : 'bg-rose-950 text-rose-400'
              }`}
            >
              ROUTE {diagnostics.routeValidity}
            </span>
          </div>

          <div className="space-y-1 text-[10px] pt-0.5">
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Obstacle Coords:</span>
              <span className="font-bold text-amber-300">
                {diagnostics.obstaclePosition
                  ? `[${diagnostics.obstaclePosition[0].toFixed(1)}, ${diagnostics.obstaclePosition[1].toFixed(1)}]`
                  : 'None Detected'}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-slate-400">Time Since Motion:</span>
              <span
                className={`font-bold ${
                  timeSinceLastProgress > 2.0 ? 'text-amber-400' : 'text-slate-200'
                }`}
              >
                {timeSinceLastProgress.toFixed(1)}s
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-slate-400">Route Status:</span>
              <span className="font-bold text-cyan-300">
                {diagnostics.routeDiffers ? 'Alternative Detour' : 'Original Path'}
              </span>
            </div>

            {/* Predictive Braking & Stopping Distance Telemetry */}
            <div className="flex items-center justify-between border-t border-[#1e2942]/40 pt-1">
              <span className="text-slate-400">Stopping Distance (d=v²/2a):</span>
              <span className="font-bold text-cyan-300">
                {(diagnostics.stoppingDistance ?? 0).toFixed(2)} m
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-slate-400">Available Clearance:</span>
              <span className="font-bold text-slate-200">
                {(diagnostics.availableClearance ?? sensorData.forwardDist).toFixed(2)} m
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-slate-400">Braking Dynamic:</span>
              <span
                className={`font-bold px-1.5 py-0.5 rounded text-[9px] uppercase ${
                  diagnostics.brakingStatus === 'emergency_braking'
                    ? 'bg-rose-950 text-rose-300 border border-rose-600 animate-pulse'
                    : diagnostics.brakingStatus === 'controlled_braking'
                    ? 'bg-amber-950 text-amber-300 border border-amber-600'
                    : diagnostics.brakingStatus === 'stopped'
                    ? 'bg-slate-800 text-slate-400 border border-slate-700'
                    : 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                }`}
              >
                {diagnostics.brakingStatus
                  ? diagnostics.brakingStatus.replace('_', ' ')
                  : 'CRUISING'}
              </span>
            </div>

            <div className="text-[10px] text-slate-400 pt-0.5 border-t border-[#1e2942]/40 truncate">
              <span className="text-slate-500">Replan Reason: </span>
              <span className="text-slate-200 font-semibold">{diagnostics.replanReason}</span>
            </div>
          </div>
        </div>

        {/* Genuine Simulation Telemetry & Benchmarks */}
        <div className="p-2.5 rounded-lg bg-[#070a13] border border-[#1e2942] space-y-1.5 text-[11px]">
          <div className="flex items-center justify-between text-[10px] text-slate-400 border-b border-[#1e2942]/60 pb-1">
            <span className="flex items-center space-x-1 font-bold text-slate-300">
              <Route className="w-3 h-3 text-cyan-400" />
              <span>SIMULATION TELEMETRY</span>
            </span>
            <span className="text-[9px] text-emerald-400 flex items-center space-x-0.5">
              <CheckCircle2 className="w-2.5 h-2.5" />
              <span>PHYSICS GROUND TRUTH</span>
            </span>
          </div>

          <div className="grid grid-cols-2 gap-1.5 text-[10px] pt-1">
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Mission Time:</span>
              <span className="font-bold text-slate-200">{missionMetrics.missionTime.toFixed(1)}s</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Travelled:</span>
              <span className="font-bold text-cyan-300">{missionMetrics.distanceTravelled.toFixed(1)}m</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Obstacles Seen:</span>
              <span className="font-bold text-amber-300">{missionMetrics.obstaclesDetected}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Replans:</span>
              <span className="font-bold text-cyan-400">{missionMetrics.replanCount}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Time Stopped:</span>
              <span className="font-bold text-slate-400">{missionMetrics.timeStopped.toFixed(1)}s</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Collisions:</span>
              <span
                className={`font-bold ${
                  missionMetrics.collisions > 0 ? 'text-rose-400' : 'text-emerald-400'
                }`}
              >
                {missionMetrics.collisions}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Near-Misses:</span>
              <span
                className={`font-bold ${
                  (missionMetrics.nearMisses || 0) > 0 ? 'text-amber-400' : 'text-emerald-400'
                }`}
              >
                {missionMetrics.nearMisses || 0}
              </span>
            </div>

            {/* Quick Benchmark Center Save */}
            <div className="col-span-2 pt-1.5 border-t border-[#1e2942]/60 flex items-center justify-between">
              <span className="text-[9px] text-slate-500">BENCHMARK LAB:</span>
              <button
                data-testid="lab-save-benchmark-btn"
                onClick={() => {
                  saveActiveSessionAsBenchmark();
                  setBenchmarkCenterOpen(true);
                }}
                className="flex items-center space-x-1 px-2 py-0.5 rounded bg-amber-950/60 hover:bg-amber-900/60 text-amber-300 border border-amber-700/60 text-[9px] font-bold transition-all"
                title="Save current mission telemetry into Benchmark Center"
              >
                <Award className="w-3 h-3 text-amber-400" />
                <span>SAVE RUN TO BENCHMARKS</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
);
};
