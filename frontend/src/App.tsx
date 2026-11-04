import React, { useEffect } from 'react';
import { Header } from './components/Header';
import { ModeSwitchBar } from './components/ModeSwitchBar';
import { SimControls } from './components/SimControls';
import { DiagnosticsPanel } from './components/DiagnosticsPanel';
import { RobotHUD } from './components/RobotHUD';
import { AutonomousLabPanel } from './components/AutonomousLabPanel';
import { AICommandCenterPanel } from './components/AICommandCenterPanel';
import { MultiplayerModal } from './components/MultiplayerModal';
import { FlightRecorderModal } from './components/FlightRecorderModal';
import { BenchmarkCenterModal } from './components/BenchmarkCenterModal';
import { SpatialHeatmapModal } from './components/SpatialHeatmapModal';
import { FailureAdvisorModal } from './components/FailureAdvisorModal';
import { CollisionRecoveryModal } from './components/CollisionRecoveryModal';
import { ChallengeLibraryPanel } from './components/ChallengeLibraryPanel';
import { ScenarioGeneratorModal } from './components/ScenarioGeneratorModal';
import { ScenarioResultPanel } from './components/ScenarioResultPanel';
import { PhysicsScene } from './simulation/PhysicsScene';
import { fetchHealthCheck } from './services/api';
import { useSimulationStore } from './state/useSimulationStore';
import { UserRole } from './types/multiplayer';
import { ShieldCheck, ChevronLeft, ChevronRight, Activity } from 'lucide-react';

export const App: React.FC = () => {
  const mode = useSimulationStore((s) => s.mode);
  const setBackendStatus = useSimulationStore((s) => s.setBackendStatus);
  const addLog = useSimulationStore((s) => s.addLog);
  const togglePlayPause = useSimulationStore((s) => s.togglePlayPause);
  const toggleEmergencyStop = useSimulationStore((s) => s.toggleEmergencyStop);
  const resetRobotPose = useSimulationStore((s) => s.resetRobotPose);
  const joinMultiplayerSession = useSimulationStore((s) => s.joinMultiplayerSession);
  const isMultiplayerActive = useSimulationStore((s) => s.isMultiplayerActive);
  const userRole = useSimulationStore((s) => s.userRole);
  const isLeftPanelOpen = useSimulationStore((s) => s.isLeftPanelOpen);
  const toggleLeftPanel = useSimulationStore((s) => s.toggleLeftPanel);
  const toggleZenMode = useSimulationStore((s) => s.toggleZenMode);

  useEffect(() => {
    let isMounted = true;

    async function checkApi() {
      try {
        setBackendStatus('checking');
        const data = await fetchHealthCheck();
        if (isMounted) {
          setBackendStatus('connected', data);
          addLog(`[BACKEND] Connected to ${data.service} v${data.version}`);
        }
      } catch (err) {
        if (isMounted) {
          setBackendStatus('offline');
          addLog('[BACKEND] Unable to reach FastAPI backend. Fallback mode active.');
        }
      }
    }

    checkApi();
    const interval = setInterval(checkApi, 10000); // Check every 10s

    // Auto-join collaborative session if ?session=... is in the URL query params
    const params = new URLSearchParams(window.location.search);
    const sessionParam = params.get('session');
    const roleParam = (params.get('role') as UserRole) || 'controller';
    if (sessionParam) {
      joinMultiplayerSession(sessionParam, 'Scenario Controller', roleParam)
        .then(() => {
          addLog(`[MULTIPLAYER] Automatically connected to session ${sessionParam} as ${String(roleParam || 'controller').toUpperCase()}`);
        })
        .catch((err) => {
          addLog(`[MULTIPLAYER] Auto-join failed: ${err.message || err}`);
        });
    }

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [setBackendStatus, addLog, joinMultiplayerSession]);

  // Global Keyboard Shortcuts (Space = E-Stop, P = Pause, R = Reset Pose)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) {
        return;
      }

      if (e.code === 'Space') {
        e.preventDefault();
        toggleEmergencyStop();
      } else if (e.code === 'KeyP') {
        e.preventDefault();
        togglePlayPause();
      } else if (e.code === 'KeyR') {
        e.preventDefault();
        resetRobotPose();
      } else if (e.code === 'KeyZ') {
        e.preventDefault();
        toggleZenMode();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleEmergencyStop, togglePlayPause, resetRobotPose, toggleZenMode]);

  return (
    <div className="w-screen h-screen relative overflow-hidden bg-[#070a13]">
      {/* 1. Header with Brand, Clock & API status */}
      <Header />

      {/* 2. Top-Center Unified Mode Switcher */}
      <ModeSwitchBar />

      {/* 3. 3D Rapier Physics Canvas with AMR Robot */}
      <PhysicsScene />

      {/* 4. Left-Side Telemetry & Observer Deck (AMR Telemetry + Core Telemetry) */}
      {isLeftPanelOpen ? (
        <div
          data-testid="left-telemetry-deck"
          className="absolute top-20 left-6 z-20 w-72 sm:w-80 flex flex-col space-y-2 pointer-events-auto select-none max-h-[calc(100vh-14rem)] overflow-y-auto no-scrollbar animate-in fade-in slide-in-from-left-4 duration-200"
        >
          <div className="flex items-center justify-between px-2.5 py-1 bg-[#090d18]/90 backdrop-blur-md rounded-lg border border-[#1e2942] text-[10px] font-mono text-slate-400">
            <span className="font-semibold text-slate-300">TELEMETRY DECK</span>
            <button
              onClick={toggleLeftPanel}
              data-testid="collapse-left-deck-btn"
              className="flex items-center space-x-1 text-slate-400 hover:text-cyan-300 transition-colors cursor-pointer"
              title="Collapse Telemetry Deck"
            >
              <span>COLLAPSE</span>
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
          </div>
          <RobotHUD />
          <DiagnosticsPanel />
        </div>
      ) : (
        <div className="absolute top-20 left-4 z-20 pointer-events-auto select-none">
          <button
            onClick={toggleLeftPanel}
            data-testid="expand-left-deck-btn"
            className="px-3 py-2 rounded-r-xl bg-[#0d1322]/95 border border-cyan-700/80 text-cyan-300 font-mono text-xs font-bold shadow-2xl flex items-center space-x-1.5 hover:bg-cyan-950 transition-colors cursor-pointer"
            title="Expand AMR Telemetry & Diagnostics Deck"
          >
            <Activity className="w-4 h-4 text-cyan-400" />
            <span>TELEMETRY</span>
            <ChevronRight className="w-3.5 h-3.5 text-cyan-400" />
          </button>
        </div>
      )}

      {/* 5. Top-Right Autonomous Lab Control Panel (Shown in Autonomous Mode) */}
      <AutonomousLabPanel />

      {/* 5b. Live Scenario Execution Result Panel (Active whenever an AI scenario is staged or running) */}
      <ScenarioResultPanel />

      {/* 6. Top-Right AI Command Center Deck (Shown in AI Command Mode) */}
      <AICommandCenterPanel />

      {/* 7. Bottom-Left Simulation Controls */}
      <SimControls />

      {/* 8. Predefined Challenge & Hazard Library Modal/Panel */}
      <ChallengeLibraryPanel />

      {/* 9. Collaborative Multi-Device Modal */}
      <MultiplayerModal />

      {/* 10. Black Box Flight Recorder & Telemetry Modal */}
      <FlightRecorderModal />

      {/* 11. Benchmark Center & Comparative Analytics Modal */}
      <BenchmarkCenterModal />

      {/* 12. Spatial Risk Heatmap & Incident Hotspots Modal (Phase 5.3D) */}
      <SpatialHeatmapModal />

      {/* 13. AI Failure Analysis & Optimization Advisor Modal (Phase 5.4) */}
      <FailureAdvisorModal />

      {/* 14. Falling Object Collision Recovery Confirmation Modal */}
      <CollisionRecoveryModal />

      {/* 15. AI Scenario Generator & Digital Twin Staging Modal (Phase 5.5C) */}
      <ScenarioGeneratorModal />

      {/* 10. Mode Context Status Badge (Shown in Manual mode when panels are docked) */}
      {mode === 'manual' && (
        <div className="absolute top-20 right-6 z-10 hidden md:flex items-center space-x-2 px-3 py-1.5 rounded-lg bg-cyan-950/40 backdrop-blur-sm border border-cyan-800/40 text-[11px] font-mono text-cyan-300 pointer-events-none">
          <ShieldCheck className="w-3.5 h-3.5 text-cyan-400" />
          <span>
            {isMultiplayerActive && userRole === 'controller'
              ? 'SCENARIO CONTROLLER (OBSERVER/HAZARDS ONLY)'
              : 'MANUAL TELEOPERATION READY (WASD / ARROWS)'}
          </span>
        </div>
      )}
    </div>
  );
};

export default App;
