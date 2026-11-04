import React from 'react';
import { ShieldAlert, Activity, Wifi, WifiOff, Clock, Users, AlertTriangle, Radio, BarChart3, Flame, Sparkles, Eye } from 'lucide-react';
import { useSimulationStore } from '../state/useSimulationStore';

export const Header: React.FC = () => {
  const backendStatus = useSimulationStore((s) => s.backendStatus);
  const backendInfo = useSimulationStore((s) => s.backendInfo);
  const currentTime = useSimulationStore((s) => s.currentTime);
  const isRunning = useSimulationStore((s) => s.isRunning);

  // Collaborative Multiplayer State
  const isMultiplayerActive = useSimulationStore((s) => s.isMultiplayerActive);
  const sessionId = useSimulationStore((s) => s.sessionId);
  const userRole = useSimulationStore((s) => s.userRole);
  const latencyMs = useSimulationStore((s) => s.latencyMs);
  const setMultiplayerModalOpen = useSimulationStore((s) => s.setMultiplayerModalOpen);
  const isChallengeLibraryOpen = useSimulationStore((s) => s.isChallengeLibraryOpen);
  const setChallengeLibraryOpen = useSimulationStore((s) => s.setChallengeLibraryOpen);

  // Flight Recorder State
  const isFlightRecorderOpen = useSimulationStore((s) => s.isFlightRecorderOpen);
  const setFlightRecorderOpen = useSimulationStore((s) => s.setFlightRecorderOpen);
  const isRecordingFlightData = useSimulationStore((s) => s.isRecordingFlightData);

  // Benchmark Center State
  const isBenchmarkCenterOpen = useSimulationStore((s) => s.isBenchmarkCenterOpen);
  const setBenchmarkCenterOpen = useSimulationStore((s) => s.setBenchmarkCenterOpen);

  // Spatial Risk Heatmap State (Phase 5.3D)
  const isSpatialHeatmapOpen = useSimulationStore((s) => s.isSpatialHeatmapOpen);
  const setSpatialHeatmapOpen = useSimulationStore((s) => s.setSpatialHeatmapOpen);

  // AI Failure Analysis & Optimization Advisor State (Phase 5.4)
  const isAdvisorOpen = useSimulationStore((s) => s.isAdvisorOpen);
  const setAdvisorOpen = useSimulationStore((s) => s.setAdvisorOpen);

  // AI Scenario Generator State (Phase 5.5C)
  const isScenarioGeneratorOpen = useSimulationStore((s) => s.isScenarioGeneratorOpen);
  const setScenarioGeneratorOpen = useSimulationStore((s) => s.setScenarioGeneratorOpen);

  // Layout Zen View State
  const isZenMode = useSimulationStore((s) => s.isZenMode);
  const toggleZenMode = useSimulationStore((s) => s.toggleZenMode);

  return (
    <header className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-6 py-3 bg-[#070a13]/85 backdrop-blur-md border-b border-[#1e2942]/60 select-none">
      {/* Brand & Tagline */}
      <div className="flex items-center space-x-3">
        <div className="p-2 rounded-lg bg-gradient-to-br from-cyan-500/20 to-blue-600/20 border border-cyan-500/40 text-cyan-400">
          <ShieldAlert className="w-5 h-5 animate-pulse" />
        </div>
        <div>
          <div className="flex items-center space-x-2">
            <h1 className="text-base font-extrabold tracking-wider bg-gradient-to-r from-cyan-400 via-teal-300 to-blue-400 bg-clip-text text-transparent uppercase">
              RobotRisk AI
            </h1>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-cyan-950/80 text-cyan-300 border border-cyan-800/60 font-semibold">
              v0.1 CORE
            </span>
          </div>
          <p className="text-[11px] text-slate-400 tracking-tight hidden sm:block">
            Break it in simulation. Learn from failure. Make it safer in reality.
          </p>
        </div>
      </div>

      {/* Center Clock & Telemetry Indicator */}
      <div className="flex items-center space-x-3">
        <div className="flex items-center space-x-2 px-3 py-1 rounded-md bg-[#0d1322] border border-[#1e2942] font-mono text-xs">
          <Clock className="w-3.5 h-3.5 text-cyan-400" />
          <span className="text-slate-400">SIM CLOCK:</span>
          <span className="font-bold text-cyan-300">
            {currentTime.toFixed(2)}s
          </span>
          <span
            className={`w-2 h-2 rounded-full ${
              isRunning ? 'bg-emerald-400 animate-ping' : 'bg-amber-400'
            }`}
          />
        </div>
      </div>

      {/* Right Controls: Challenge Library, Multiplayer Session & Backend API Status */}
      <div className="flex items-center space-x-2.5">
        {/* Challenge Library Toggle */}
        <button
          onClick={() => setChallengeLibraryOpen(!isChallengeLibraryOpen)}
          className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg border text-xs font-mono font-semibold transition-all ${
            isChallengeLibraryOpen
              ? 'bg-amber-500/20 border-amber-500 text-amber-300 shadow-md shadow-amber-500/20'
              : 'bg-[#0d1322] hover:bg-[#141d33] border-[#1e2942] text-slate-300 hover:text-amber-300'
          }`}
          title="Open Predefined Challenge Library (9 Hazards)"
        >
          <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
          <span>HAZARDS (9)</span>
        </button>

        {/* AI Scenario Generator Button (Phase 5.5C) */}
        <button
          data-testid="header-scenario-generator-button"
          onClick={() => setScenarioGeneratorOpen(!isScenarioGeneratorOpen)}
          className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg border text-xs font-mono font-semibold transition-all ${
            isScenarioGeneratorOpen
              ? 'bg-cyan-500/20 border-cyan-500 text-cyan-300 shadow-md shadow-cyan-500/20'
              : 'bg-[#0d1322] hover:bg-[#141d33] border-[#1e2942] text-slate-300 hover:text-cyan-300'
          }`}
          title="Open AI Scenario Generator & Digital Twin Staging"
        >
          <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
          <span>SCENARIOS (AI)</span>
        </button>

        {/* Black Box Flight Recorder Button */}
        <button
          data-testid="header-flight-recorder-button"
          onClick={() => setFlightRecorderOpen(!isFlightRecorderOpen)}
          className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg border text-xs font-mono font-semibold transition-all ${
            isRecordingFlightData
              ? 'bg-rose-950/70 border-rose-500 text-rose-300 shadow-md shadow-rose-900/40 animate-pulse'
              : isFlightRecorderOpen
              ? 'bg-cyan-500/20 border-cyan-500 text-cyan-300 shadow-md shadow-cyan-500/20'
              : 'bg-[#0d1322] hover:bg-[#141d33] border-[#1e2942] text-slate-300 hover:text-cyan-300'
          }`}
          title="Open Black Box Flight Recorder & Telemetry Hub"
        >
          <Radio className={`w-3.5 h-3.5 ${isRecordingFlightData ? 'text-rose-400 animate-pulse' : 'text-cyan-400'}`} />
          <span>FLIGHT RECORDER</span>
          {isRecordingFlightData && (
            <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping ml-0.5" />
          )}
        </button>

        {/* Benchmark Center Button */}
        <button
          data-testid="header-benchmark-center-button"
          onClick={() => setBenchmarkCenterOpen(!isBenchmarkCenterOpen)}
          className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg border text-xs font-mono font-semibold transition-all ${
            isBenchmarkCenterOpen
              ? 'bg-amber-500/20 border-amber-500 text-amber-300 shadow-md shadow-amber-500/20'
              : 'bg-[#0d1322] hover:bg-[#141d33] border-[#1e2942] text-slate-300 hover:text-amber-300'
          }`}
          title="Open Benchmark Center & Comparative Safety Analytics"
        >
          <BarChart3 className="w-3.5 h-3.5 text-amber-400" />
          <span>BENCHMARKS</span>
        </button>

        {/* Spatial Risk Heatmap Button (Phase 5.3D) */}
        <button
          data-testid="header-spatial-heatmap-button"
          onClick={() => setSpatialHeatmapOpen(!isSpatialHeatmapOpen)}
          className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg border text-xs font-mono font-semibold transition-all ${
            isSpatialHeatmapOpen
              ? 'bg-rose-500/20 border-rose-500 text-rose-300 shadow-md shadow-rose-500/20'
              : 'bg-[#0d1322] hover:bg-[#141d33] border-[#1e2942] text-slate-300 hover:text-rose-300'
          }`}
          title="Open Spatial Risk Heatmap & Incident Hotspot Analytics"
        >
          <Flame className="w-3.5 h-3.5 text-rose-400" />
          <span>HEATMAP</span>
        </button>

        {/* AI Failure Analysis & Optimization Advisor Button (Phase 5.4) */}
        <button
          data-testid="header-ai-advisor-button"
          onClick={() => setAdvisorOpen(!isAdvisorOpen)}
          className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg border text-xs font-mono font-semibold transition-all ${
            isAdvisorOpen
              ? 'bg-purple-500/20 border-purple-500 text-purple-300 shadow-md shadow-purple-500/20'
              : 'bg-[#0d1322] hover:bg-[#141d33] border-[#1e2942] text-slate-300 hover:text-purple-300'
          }`}
          title="Open AI Failure Analysis & Optimization Advisor"
        >
          <Sparkles className="w-3.5 h-3.5 text-purple-400" />
          <span>AI ADVISOR</span>
        </button>

        {/* Zen View Unobstructed Simulation Toggle */}
        <button
          data-testid="header-zen-view-button"
          onClick={toggleZenMode}
          className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg border text-xs font-mono font-semibold transition-all ${
            isZenMode
              ? 'bg-emerald-950/70 border-emerald-500 text-emerald-300 shadow-md shadow-emerald-900/40'
              : 'bg-[#0d1322] hover:bg-[#141d33] border-[#1e2942] text-slate-300 hover:text-emerald-300'
          }`}
          title="Toggle Zen View (Hide/Show all floating panels for unobstructed simulation view) [Z]"
        >
          <Eye className="w-3.5 h-3.5 text-emerald-400" />
          <span>{isZenMode ? 'EXIT ZEN' : 'ZEN VIEW'}</span>
        </button>

        {/* Multiplayer Collaborative Session Button */}
        <button
          onClick={() => setMultiplayerModalOpen(true)}
          className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg border text-xs font-mono font-semibold transition-all ${
            isMultiplayerActive
              ? userRole === 'operator'
                ? 'bg-cyan-950/60 border-cyan-500 text-cyan-300 shadow-lg shadow-cyan-500/20'
                : 'bg-amber-950/60 border-amber-500 text-amber-300 shadow-lg shadow-amber-500/20'
              : 'bg-[#0d1322] hover:bg-[#141d33] border-[#1e2942] text-slate-300 hover:text-cyan-300'
          }`}
          title="Collaborative Multi-Device Simulation Hub"
        >
          <Users className="w-3.5 h-3.5" />
          {isMultiplayerActive && sessionId ? (
            <>
              <span className="font-extrabold">{sessionId}</span>
              <span className="text-[10px] px-1 py-0.2 rounded bg-black/40 border border-current font-bold uppercase">
                {userRole === 'operator' ? 'OPERATOR' : 'CONTROLLER'}
              </span>
              {latencyMs > 0 && <span className="text-[10px] opacity-75">{latencyMs}ms</span>}
            </>
          ) : (
            <span>MULTI-DEVICE</span>
          )}
        </button>

        {/* Backend API Connection Status */}
        <div
          className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg border text-xs font-mono transition-colors ${
            backendStatus === 'connected'
              ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300'
              : backendStatus === 'checking'
              ? 'bg-amber-950/40 border-amber-500/40 text-amber-300'
              : 'bg-rose-950/40 border-rose-500/40 text-rose-300'
          }`}
          title={
            backendInfo
              ? `Connected to ${backendInfo.service} v${backendInfo.version}`
              : 'Backend disconnected'
          }
        >
          {backendStatus === 'connected' ? (
            <>
              <Wifi className="w-3.5 h-3.5 text-emerald-400" />
              <span className="font-semibold hidden lg:inline">API: ONLINE</span>
            </>
          ) : backendStatus === 'checking' ? (
            <>
              <Activity className="w-3.5 h-3.5 text-amber-400 animate-spin" />
              <span className="hidden lg:inline">SYNCING...</span>
            </>
          ) : (
            <>
              <WifiOff className="w-3.5 h-3.5 text-rose-400" />
              <span className="hidden lg:inline">API: OFFLINE</span>
            </>
          )}
        </div>
      </div>
    </header>
  );
};
