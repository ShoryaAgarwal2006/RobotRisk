import React, { useState } from 'react';
import {
  UserCheck,
  PackageMinus,
  ShieldAlert,
  Users,
  Truck,
  AlertTriangle,
  CheckCircle,
  Flame,
  Zap,
  Play,
  Filter,
  Sparkles,
  X,
  Radio,
} from 'lucide-react';
import { useSimulationStore } from '../state/useSimulationStore';
import { PREDEFINED_CHALLENGES } from '../simulation/challenges/challengeLibrary';
import { PredefinedChallenge, UserRole } from '../types/multiplayer';

interface ChallengeLibraryPanelProps {
  forceOpen?: boolean;
  forceMultiplayerActive?: boolean;
  forceUserRole?: UserRole;
}

export const ChallengeLibraryPanel: React.FC<ChallengeLibraryPanelProps> = ({
  forceOpen,
  forceMultiplayerActive,
  forceUserRole,
}) => {
  const storeIsOpen = useSimulationStore((s) => s.isChallengeLibraryOpen);
  const isChallengeLibraryOpen = forceOpen !== undefined ? forceOpen : storeIsOpen;
  const setChallengeLibraryOpen = useSimulationStore((s) => s.setChallengeLibraryOpen);
  const storeActive = useSimulationStore((s) => s.isMultiplayerActive);
  const isMultiplayerActive = forceMultiplayerActive !== undefined ? forceMultiplayerActive : storeActive;
  const storeUserRole = useSimulationStore((s) => s.userRole);
  const userRole = forceUserRole !== undefined ? forceUserRole : storeUserRole;
  const triggerPredefinedChallenge = useSimulationStore((s) => s.triggerPredefinedChallenge);
  const startVerticalImpactScenario = useSimulationStore((s) => s.startVerticalImpactScenario);

  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [lastTriggeredId, setLastTriggeredId] = useState<string | null>(null);

  if (!isChallengeLibraryOpen) return null;

  const categories = [
    { id: 'all', label: 'All Hazards (9)' },
    { id: 'traffic', label: 'Pedestrians & Traffic' },
    { id: 'incident', label: 'Cargo Incidents' },
    { id: 'hazard', label: 'Corridor Hazards' },
    { id: 'stress', label: 'Impossible Presets' },
  ];

  const filteredChallenges =
    selectedCategory === 'all'
      ? PREDEFINED_CHALLENGES
      : PREDEFINED_CHALLENGES.filter((c) => c.category === selectedCategory);

  const handleTrigger = (challenge: PredefinedChallenge) => {
    setLastTriggeredId(challenge.id);
    triggerPredefinedChallenge(challenge.id);
    setTimeout(() => {
      setLastTriggeredId((current) => (current === challenge.id ? null : current));
    }, 2500);
  };

  const getSeverityBadge = (severity: PredefinedChallenge['severity']) => {
    switch (severity) {
      case 'low':
        return 'bg-emerald-950 text-emerald-300 border-emerald-700';
      case 'medium':
        return 'bg-blue-950 text-blue-300 border-blue-700';
      case 'high':
        return 'bg-amber-950 text-amber-300 border-amber-700';
      case 'critical':
        return 'bg-rose-950 text-rose-300 border-rose-700 font-extrabold animate-pulse';
    }
  };

  const renderIcon = (iconName: string) => {
    switch (iconName) {
      case 'UserCheck':
        return <UserCheck className="w-4 h-4 text-cyan-400" />;
      case 'PackageMinus':
        return <PackageMinus className="w-4 h-4 text-amber-400" />;
      case 'ShieldAlert':
        return <ShieldAlert className="w-4 h-4 text-rose-400" />;
      case 'Users':
        return <Users className="w-4 h-4 text-indigo-400" />;
      case 'Truck':
        return <Truck className="w-4 h-4 text-teal-400" />;
      case 'AlertTriangle':
        return <AlertTriangle className="w-4 h-4 text-rose-400" />;
      case 'CheckCircle':
        return <CheckCircle className="w-4 h-4 text-emerald-400" />;
      case 'Flame':
        return <Flame className="w-4 h-4 text-amber-400" />;
      case 'Zap':
        return <Zap className="w-4 h-4 text-rose-400" />;
      default:
        return <Sparkles className="w-4 h-4 text-cyan-400" />;
    }
  };

  return (
    <div
      data-testid="challenge-library-panel"
      className="absolute top-20 bottom-6 right-6 z-30 w-88 sm:w-96 max-h-[calc(100vh-6.5rem)] flex flex-col font-mono select-none pointer-events-auto animate-in fade-in slide-in-from-right-4 duration-200"
    >
      <div className="flex-1 min-h-0 flex flex-col rounded-xl bg-[#090d18]/95 backdrop-blur-md border border-amber-500/50 shadow-2xl shadow-amber-950/40 overflow-hidden">
        {/* Panel Header */}
        <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-[#1e2942] bg-[#070a13]">
          <div className="flex items-center space-x-2.5">
            <div className="p-1.5 rounded-lg bg-amber-500/20 border border-amber-500/40 text-amber-400">
              <AlertTriangle className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="font-extrabold text-xs text-slate-100 tracking-wider">
                  CHALLENGE & HAZARD LIBRARY
                </h3>
                {isMultiplayerActive && (
                  <span className="text-[9px] px-1.5 py-0.2 rounded bg-amber-950 text-amber-300 border border-amber-800 font-bold">
                    {String(userRole || 'controller').toUpperCase()}
                  </span>
                )}
              </div>
              <p className="text-[10px] text-slate-400">Real-time incident & stress injection</p>
            </div>
          </div>
          <button
            onClick={() => setChallengeLibraryOpen(false)}
            className="p-1 rounded-lg hover:bg-[#141d33] text-slate-400 hover:text-slate-200 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Category Filter Tabs */}
        <div className="shrink-0 px-3 py-2 border-b border-[#1e2942] bg-[#090d18] flex items-center space-x-1 overflow-x-auto no-scrollbar">
          <Filter className="w-3 h-3 text-slate-500 shrink-0 ml-1 mr-1" />
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setSelectedCategory(cat.id)}
              className={`px-2.5 py-1 rounded-md text-[10px] font-semibold whitespace-nowrap transition-colors ${
                selectedCategory === cat.id
                  ? 'bg-amber-600 text-white'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-[#141d33]'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/* Scrollable Challenge Cards List */}
        <div className="flex-1 min-h-0 overflow-y-auto p-3.5 space-y-2.5">
          {/* Special Adversarial Scenario: Vertical Impact Falling Pallet Test */}
          <div className="p-3 rounded-xl bg-gradient-to-r from-red-950/70 to-amber-950/70 border border-red-500/60 shadow-lg shadow-red-950/40">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-black uppercase text-red-400 tracking-wider flex items-center space-x-1">
                <Flame className="w-3.5 h-3.5 text-red-400" />
                <span>ADVERSARIAL SCENARIO</span>
              </span>
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-red-900/80 text-red-200 border border-red-500 font-bold uppercase">
                EXTREME
              </span>
            </div>
            <h4 className="text-xs font-black text-slate-100 mb-1">
              VERTICAL IMPACT — FALLING PALLET TEST
            </h4>
            <p className="text-[10px] text-slate-300 leading-snug mb-2">
              Suspends 250kg heavy cargo pallet at Y=3.6m above centerline. Drops under gravity (g=9.81m/s²) when AMR approaches within 3.0m. Tests 3D rigid-body collision, 2D LiDAR blindspots, and failure analysis.
            </p>
            <button
              data-testid="start-vertical-impact-btn"
              onClick={() => {
                startVerticalImpactScenario();
                setLastTriggeredId('vertical_impact_falling_pallet');
              }}
              className="w-full py-1.5 px-3 rounded-lg bg-red-600 hover:bg-red-500 text-white font-extrabold text-xs flex items-center justify-center space-x-1.5 shadow-md shadow-red-900/50 transition-all cursor-pointer"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>START FALLING PALLET TEST</span>
            </button>
          </div>

          {filteredChallenges.map((challenge) => {
            const isTriggered = lastTriggeredId === challenge.id;
            const badgeClass = getSeverityBadge(challenge.severity);

            return (
              <div
                key={challenge.id}
                className={`p-3 rounded-xl border transition-all ${
                  isTriggered
                    ? 'bg-amber-950/60 border-amber-400 shadow-lg shadow-amber-500/20'
                    : 'bg-[#0d1322] border-[#1e2942] hover:border-slate-700'
                }`}
              >
                {/* Challenge Header */}
                <div className="flex items-start justify-between">
                  <div className="flex items-center space-x-2">
                    <div className="p-1.5 rounded-lg bg-[#070a13] border border-[#1e2942]">
                      {renderIcon(challenge.iconName)}
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-slate-100">{challenge.title}</h4>
                      <span className="text-[9px] uppercase font-mono text-slate-500">
                        {challenge.category}
                      </span>
                    </div>
                  </div>
                  <span className={`text-[9px] px-1.5 py-0.5 rounded border uppercase font-mono ${badgeClass}`}>
                    {challenge.severity}
                  </span>
                </div>

                {/* Description */}
                <p className="mt-2 text-[11px] text-slate-300 leading-snug">{challenge.description}</p>
                <p className="mt-1 text-[10px] text-slate-500 leading-snug">{challenge.details}</p>

                {/* Trigger Button */}
                <div className="mt-3 pt-2 border-t border-[#1e2942]/60 flex items-center justify-between">
                  <div className="text-[10px] text-slate-500">
                    {isMultiplayerActive
                      ? userRole === 'controller'
                        ? '⚡ Injects directly to Operator'
                        : 'Local & Broadcast'
                      : 'Standalone injection'}
                  </div>

                  <button
                    onClick={() => handleTrigger(challenge)}
                    className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all shadow-md ${
                      isTriggered
                        ? 'bg-emerald-600 text-white shadow-emerald-500/30'
                        : 'bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white shadow-amber-600/20'
                    }`}
                  >
                    <Play className="w-3 h-3 fill-current" />
                    <span>{isTriggered ? 'HAZARD DISPATCHED!' : 'TRIGGER INCIDENT'}</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Panel Footer */}
        <div className="shrink-0 px-3.5 py-2.5 bg-[#070a13] border-t border-[#1e2942] text-[10px] text-slate-400 flex items-center justify-between">
          <div className="flex items-center space-x-1.5">
            <Radio className="w-3 h-3 text-amber-400" />
            <span>Scenario Controller Channel</span>
          </div>
          <span className="text-amber-400 font-semibold">9 HAZARD PROFILES READY</span>
        </div>
      </div>
    </div>
  );
};
