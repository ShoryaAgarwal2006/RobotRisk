import React from 'react';
import { Gamepad2, Compass, Bot, Sparkles } from 'lucide-react';
import { useSimulationStore } from '../state/useSimulationStore';
import { SimulationMode } from '../types/simulation';

interface ModeOption {
  id: SimulationMode;
  label: string;
  badge: string;
  icon: React.ReactNode;
  description: string;
  keyHint: string;
}

const MODES: ModeOption[] = [
  {
    id: 'manual',
    label: 'Game / Manual',
    badge: 'M2',
    icon: <Gamepad2 className="w-4 h-4" />,
    description: 'Direct keyboard teleoperation (WASD / Arrows), manual navigation & collision tests.',
    keyHint: 'WASD Keys Ready',
  },
  {
    id: 'autonomous',
    label: 'Autonomous Lab',
    badge: 'M4',
    icon: <Compass className="w-4 h-4" />,
    description: 'A* optimal pathfinding, dynamic obstacle avoidance, lidar sensor arrays & replanning.',
    keyHint: 'A* Planner Ready',
  },
  {
    id: 'ai_command',
    label: 'AI Command Center',
    badge: 'M6',
    icon: <Bot className="w-4 h-4" />,
    description: 'Natural language scenario injection, collision forecasting & human-in-the-loop safety optimization.',
    keyHint: 'NLP Scenarios Ready',
  },
];

export const ModeSwitchBar: React.FC = () => {
  const currentMode = useSimulationStore((s) => s.mode);
  const setMode = useSimulationStore((s) => s.setMode);
  const isMultiplayerActive = useSimulationStore((s) => s.isMultiplayerActive);
  const userRole = useSimulationStore((s) => s.userRole);

  const activeModeDetails = MODES.find((m) => m.id === currentMode);

  return (
    <div className="absolute top-16 left-1/2 transform -translate-x-1/2 z-20 flex flex-col items-center select-none">
      {/* Mode Switcher Buttons */}
      <div className="flex items-center p-1.5 rounded-xl bg-[#0d1322]/90 backdrop-blur-lg border border-[#1e2942] shadow-2xl shadow-cyan-950/20 space-x-1">
        {MODES.map((mode) => {
          const isActive = currentMode === mode.id;
          return (
            <button
              key={mode.id}
              onClick={() => setMode(mode.id)}
              className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-xs font-semibold tracking-wide transition-all duration-200 ${
                isActive
                  ? 'bg-gradient-to-r from-cyan-500/20 to-blue-500/20 text-cyan-300 border border-cyan-500/50 shadow-lg shadow-cyan-500/10'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-[#141d33]/60 border border-transparent'
              }`}
            >
              <span className={isActive ? 'text-cyan-400' : 'text-slate-400'}>
                {mode.icon}
              </span>
              <span>{mode.label}</span>
              <span
                className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${
                  isActive
                    ? 'bg-cyan-900/60 text-cyan-300'
                    : 'bg-slate-800 text-slate-400'
                }`}
              >
                {mode.badge}
              </span>
            </button>
          );
        })}
      </div>

      {/* Shared Engine Banner & Mode Context */}
      <div className="mt-2 flex items-center space-x-2 px-3 py-1 rounded-full bg-[#070a13]/80 border border-[#1e2942]/60 text-[11px] font-mono text-slate-400">
        <Sparkles className="w-3 h-3 text-cyan-400" />
        {isMultiplayerActive ? (
          <>
            <span className={userRole === 'operator' ? 'text-cyan-400 font-bold' : 'text-amber-400 font-bold'}>
              {userRole === 'operator' ? 'ROBOT OPERATOR (HOST)' : 'SCENARIO CONTROLLER (OBSERVER REPLICA)'}:
            </span>
            <span className="text-slate-300">
              {userRole === 'operator'
                ? 'Authoritative physics & navigation running. Peer has scenario injection access.'
                : 'Shared live simulation. Driving reserved for Operator; full hazard injection enabled.'}
            </span>
          </>
        ) : (
          <>
            <span>Unified Simulation State:</span>
            <span className="text-cyan-300 font-semibold">{activeModeDetails?.description}</span>
          </>
        )}
      </div>
    </div>
  );
};
