import React, { useState } from 'react';
import { Terminal, ChevronUp, ChevronDown, CheckCircle2, XCircle } from 'lucide-react';
import { useSimulationStore } from '../state/useSimulationStore';

export const DiagnosticsPanel: React.FC<{ className?: string }> = ({ className }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const eventLog = useSimulationStore((s) => s.eventLog);
  const backendInfo = useSimulationStore((s) => s.backendInfo);
  const backendStatus = useSimulationStore((s) => s.backendStatus);
  const mode = useSimulationStore((s) => s.mode);
  const interactiveCount = useSimulationStore((s) => s.interactiveObjects.length);

  return (
    <div
      data-testid="core-telemetry-panel"
      className={className || "w-full select-none font-mono pointer-events-auto"}
    >
      <div className="rounded-xl bg-[#0d1322]/90 backdrop-blur-md border border-[#1e2942] shadow-2xl overflow-hidden transition-all duration-300">
        {/* Panel Header */}
        <div
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center justify-between px-3.5 py-2 bg-[#141d33]/80 hover:bg-[#141d33] cursor-pointer border-b border-[#1e2942] transition-colors"
        >
          <div className="flex items-center space-x-2 text-xs font-mono">
            <Terminal className="w-3.5 h-3.5 text-cyan-400" />
            <span className="font-semibold text-slate-200">CORE TELEMETRY</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded bg-cyan-950 text-cyan-300 border border-cyan-800">
              RAPIER 3D
            </span>
          </div>
          <button className="text-slate-400 hover:text-slate-200" aria-label="Toggle Core Telemetry">
            {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          </button>
        </div>

        {/* Panel Body */}
        {isExpanded ? (
          <div className="p-3 space-y-3 max-h-56 overflow-y-auto font-mono text-xs">
            {/* Engine Stats */}
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div className="p-2 rounded bg-[#070a13] border border-[#1e2942]">
                <div className="text-slate-400 text-[10px]">ACTIVE MODE</div>
                <div className="text-cyan-300 font-bold uppercase">{mode}</div>
              </div>
              <div className="p-2 rounded bg-[#070a13] border border-[#1e2942]">
                <div className="text-slate-400 text-[10px]">RIGID BODIES</div>
                <div className="text-emerald-300 font-bold">{interactiveCount + 5} entities</div>
              </div>
            </div>

            {/* Backend Capabilities Check */}
            <div className="space-y-1.5 border-t border-[#1e2942] pt-2">
              <div className="text-[11px] text-slate-400 font-bold tracking-wider">
                BACKEND INTEGRATION:
              </div>
              {backendStatus === 'connected' && backendInfo ? (
                <div className="space-y-1 text-[11px]">
                  <div className="flex items-center justify-between text-slate-300">
                    <span>Service:</span>
                    <span className="text-cyan-300 font-semibold">{backendInfo.service}</span>
                  </div>
                  <div className="flex items-center justify-between text-slate-300">
                    <span>Version:</span>
                    <span className="text-slate-400">{backendInfo.version}</span>
                  </div>
                  <div className="flex items-center space-x-1.5 text-emerald-400 pt-1">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Scenario Validation: Verified</span>
                  </div>
                  <div className="flex items-center space-x-1.5 text-emerald-400">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Failure Analysis Engine: Online</span>
                  </div>
                </div>
              ) : (
                <div className="flex items-center space-x-1.5 text-amber-400 text-[11px]">
                  <XCircle className="w-3.5 h-3.5" />
                  <span>Offline / Fallback Rule Mode Active</span>
                </div>
              )}
            </div>

            {/* Live System Log */}
            <div className="space-y-1 border-t border-[#1e2942] pt-2">
              <div className="text-[11px] text-slate-400 font-bold tracking-wider mb-1">
                SYSTEM EVENT STREAM:
              </div>
              <div className="space-y-1 text-[10px] text-slate-400 bg-[#070a13] p-2 rounded border border-[#1e2942] max-h-24 overflow-y-auto">
                {eventLog.map((log, index) => (
                  <div key={index} className="leading-tight truncate">
                    <span className="text-cyan-400">&gt; </span>
                    {log}
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          /* Minimized Summary */
          <div className="px-3.5 py-1.5 flex items-center justify-between text-[11px] font-mono text-slate-400">
            <span className="truncate">Mode: {String(mode || 'manual').toUpperCase()}</span>
            <span className="text-cyan-400">{interactiveCount} Dynamic Bodies</span>
          </div>
        )}
      </div>
    </div>
  );
};
