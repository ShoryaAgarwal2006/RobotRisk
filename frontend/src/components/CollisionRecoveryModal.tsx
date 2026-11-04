import React from 'react';
import { AlertOctagon, RotateCcw, Eye, ShieldAlert } from 'lucide-react';
import { useSimulationStore } from '../state/useSimulationStore';

interface CollisionRecoveryModalProps {
  forceShow?: boolean;
}

export const CollisionRecoveryModal: React.FC<CollisionRecoveryModalProps> = ({ forceShow }) => {
  const storeCrashState = useSimulationStore((s) => s.crashState);
  const restartMissionAfterCrash = useSimulationStore((s) => s.restartMissionAfterCrash);
  const continueWithoutRestart = useSimulationStore((s) => s.continueWithoutRestart);

  const isVisible = forceShow !== undefined ? forceShow : storeCrashState.showConfirmationModal;
  if (!isVisible) {
    return null;
  }

  const details = storeCrashState.incidentDetails || {
    objectName: 'Heavy Overhead Falling Pallet',
    impulse: 2450.0,
    time: 5.0,
    position: [-8.5, 0.22, -10.5] as [number, number, number],
  };

  return (
    <div
      data-testid="collision-recovery-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200"
    >
      <div className="w-full max-w-lg rounded-2xl bg-[#0b101d] border-2 border-rose-500/80 shadow-2xl shadow-rose-950/70 p-6 space-y-6 font-mono text-slate-200">
        {/* Header */}
        <div className="flex items-center space-x-3 pb-4 border-b border-rose-900/60">
          <div className="p-3 rounded-xl bg-rose-950/80 border border-rose-600/60 text-rose-400">
            <AlertOctagon className="w-7 h-7 animate-pulse" />
          </div>
          <div>
            <h2 className="text-base font-extrabold text-white tracking-wider">
              ROBOT COLLISION DETECTED
            </h2>
            <p className="text-xs text-rose-400 font-medium">
              Physical Impact Incident Confirmed
            </p>
          </div>
        </div>

        {/* Message */}
        <div className="space-y-3">
          <p className="text-sm font-semibold text-rose-200 leading-relaxed">
            A falling object has struck the robot. The mission has been stopped for safety.
          </p>

          {/* Telemetry Snapshot Info */}
          {details && (
            <div className="p-3.5 rounded-xl bg-[#060913] border border-rose-900/40 text-xs space-y-2">
              <div className="flex items-center justify-between text-slate-400 text-[11px]">
                <span>HAZARD OBJECT</span>
                <span className="text-white font-bold">{details.objectName}</span>
              </div>
              <div className="flex items-center justify-between text-slate-400 text-[11px]">
                <span>MEASURED IMPACT FORCE</span>
                <span className="text-rose-400 font-bold">{details.impulse.toFixed(1)} N</span>
              </div>
              <div className="flex items-center justify-between text-slate-400 text-[11px]">
                <span>IMPACT LOCATION</span>
                <span className="text-cyan-300 font-bold">
                  [{details.position[0].toFixed(2)}, {details.position[2].toFixed(2)}]
                </span>
              </div>
              <div className="flex items-center justify-between text-slate-400 text-[11px]">
                <span>SIMULATION STATUS</span>
                <span className="text-amber-400 font-bold flex items-center space-x-1">
                  <ShieldAlert className="w-3.5 h-3.5" />
                  <span>PAUSED (E-STOPPED)</span>
                </span>
              </div>
            </div>
          )}

          <p className="text-[11px] text-slate-400 leading-normal">
            The simulation has been frozen at the exact moment of contact. Choose to reset and rerun the mission from base, or keep the post-collision scene paused to visually inspect physical contact manifolds and Black Box telemetry.
          </p>
        </div>

        {/* Action Buttons */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
          <button
            onClick={restartMissionAfterCrash}
            data-testid="restart-mission-modal-btn"
            className="flex items-center justify-center space-x-2 py-3 px-4 rounded-xl bg-gradient-to-r from-rose-600 to-amber-600 hover:from-rose-500 hover:to-amber-500 text-white font-bold text-xs shadow-lg shadow-rose-900/40 transition-all cursor-pointer"
          >
            <RotateCcw className="w-4 h-4" />
            <span>Restart Mission</span>
          </button>

          <button
            onClick={continueWithoutRestart}
            data-testid="continue-without-restart-modal-btn"
            className="flex items-center justify-center space-x-2 py-3 px-4 rounded-xl bg-[#141d33] hover:bg-[#1e2942] text-slate-300 hover:text-white border border-[#2d3f66] font-semibold text-xs transition-colors cursor-pointer"
          >
            <Eye className="w-4 h-4 text-cyan-400" />
            <span>Continue Without Restart</span>
          </button>
        </div>
      </div>
    </div>
  );
};
