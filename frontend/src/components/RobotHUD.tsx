import React from 'react';
import {
  Gauge,
  Compass,
  BatteryCharging,
  BatteryLow,
  AlertTriangle,
  RotateCcw,
  Octagon,
  CheckCircle,
  Move,
  Flame,
} from 'lucide-react';
import { useSimulationStore } from '../state/useSimulationStore';

export const RobotHUD: React.FC<{ className?: string }> = ({ className }) => {
  const mode = useSimulationStore((s) => s.mode);
  const robotPose = useSimulationStore((s) => s.robotPose);
  const robotStatus = useSimulationStore((s) => s.robotStatus);
  const authoritativeExecutionRecord = useSimulationStore((s) => s.authoritativeExecutionRecord);
  const toggleEmergencyStop = useSimulationStore((s) => s.toggleEmergencyStop);
  const resetRobotPose = useSimulationStore((s) => s.resetRobotPose);

  // Collaborative Multiplayer State
  const isMultiplayerActive = useSimulationStore((s) => s.isMultiplayerActive);
  const userRole = useSimulationStore((s) => s.userRole);

  const speedMs = Math.abs(robotPose.linearVelocity);
  const speedKmh = speedMs * 3.6;

  // Heading calculation: Convert radians to degrees (0 - 360)
  // Yaw in Three.js around Y axis: 0 is forward (+Z)
  let headingDeg = (robotPose.rotation * 180) / Math.PI;
  headingDeg = ((headingDeg % 360) + 360) % 360;

  // Compass Cardinal
  const getCardinal = (deg: number) => {
    const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const index = Math.round(deg / 45) % 8;
    return directions[index];
  };

  const isEStopped = robotStatus.isEmergencyStopped;
  const isBatteryLow = robotStatus.battery < 20;

  return (
    <div
      data-testid="robot-hud-panel"
      className={className || "w-full font-mono select-none space-y-2.5 pointer-events-auto"}
    >
      {/* Telemetry Panel */}
      <div className="rounded-xl bg-[#0d1322]/90 backdrop-blur-md border border-[#1e2942] p-3 shadow-2xl shadow-cyan-950/30 space-y-2.5">
        {/* Panel Header */}
        <div className="flex items-center justify-between border-b border-[#1e2942] pb-2 text-xs">
          <div className="flex items-center space-x-2">
            <div className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
            <span className="font-bold text-slate-200">AMR TELEMETRY</span>
          </div>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800">
            {String(mode || 'manual').toUpperCase()}
          </span>
        </div>

        {/* Speedometer & Primary Dynamics */}
        <div className="grid grid-cols-2 gap-2">
          {/* Speed Card */}
          <div className="p-2.5 rounded-lg bg-[#070a13] border border-[#1e2942]">
            <div className="flex items-center justify-between text-slate-400 text-[10px]">
              <span className="flex items-center space-x-1">
                <Gauge className="w-3 h-3 text-cyan-400" />
                <span>SPEED</span>
              </span>
              <span className="text-slate-500">{speedKmh.toFixed(1)} km/h</span>
            </div>
            <div className="mt-1 flex items-baseline space-x-1">
              <span className="text-xl font-black text-cyan-300">
                {speedMs.toFixed(2)}
              </span>
              <span className="text-[10px] text-slate-400">m/s</span>
            </div>
            {/* Speed Bar */}
            <div className="mt-1.5 h-1.5 w-full bg-[#141d33] rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 transition-all duration-100"
                style={{ width: `${Math.min(100, (speedMs / 3.5) * 100)}%` }}
              />
            </div>
          </div>

          {/* Heading / Compass Card */}
          <div className="p-2.5 rounded-lg bg-[#070a13] border border-[#1e2942]">
            <div className="flex items-center justify-between text-slate-400 text-[10px]">
              <span className="flex items-center space-x-1">
                <Compass className="w-3 h-3 text-cyan-400" />
                <span>HEADING</span>
              </span>
              <span className="font-bold text-cyan-400">
                {getCardinal(headingDeg)}
              </span>
            </div>
            <div className="mt-1 flex items-center justify-between">
              <span className="text-xl font-black text-slate-200">
                {headingDeg.toFixed(0)}°
              </span>
              {/* Mini Compass Needle */}
              <div
                className="w-5 h-5 rounded-full border border-cyan-800 flex items-center justify-center bg-[#141d33] transition-transform duration-75"
                style={{ transform: `rotate(${headingDeg}deg)` }}
              >
                <div className="w-0.5 h-2.5 bg-rose-500 rounded-full" />
              </div>
            </div>
            <div className="mt-1.5 text-[9px] text-slate-500 truncate">
              YAW: {robotPose.rotation.toFixed(2)} rad
            </div>
          </div>
        </div>

        {/* World Position Coordinates */}
        <div className="p-2 rounded-lg bg-[#070a13] border border-[#1e2942] text-[11px]">
          <div className="flex items-center justify-between text-slate-400 text-[10px] mb-1">
            <span className="flex items-center space-x-1">
              <Move className="w-3 h-3 text-cyan-400" />
              <span>COORDINATES (X, Y, Z)</span>
            </span>
          </div>
          <div className="grid grid-cols-3 gap-1 text-center font-bold text-slate-200 text-xs">
            <div className="bg-[#0d1322] py-1 rounded border border-[#1e2942]/60">
              <span className="text-slate-500 text-[9px] block">X</span>
              <span className="text-cyan-300">{robotPose.position[0].toFixed(2)}</span>
            </div>
            <div className="bg-[#0d1322] py-1 rounded border border-[#1e2942]/60">
              <span className="text-slate-500 text-[9px] block">Y</span>
              <span className="text-slate-300">{robotPose.position[1].toFixed(2)}</span>
            </div>
            <div className="bg-[#0d1322] py-1 rounded border border-[#1e2942]/60">
              <span className="text-slate-500 text-[9px] block">Z</span>
              <span className="text-cyan-300">{robotPose.position[2].toFixed(2)}</span>
            </div>
          </div>
        </div>

        {/* Battery & Health Telemetry */}
        <div className="p-2 rounded-lg bg-[#070a13] border border-[#1e2942] space-y-1.5 text-xs">
          <div className="flex items-center justify-between text-[10px]">
            <span className="flex items-center space-x-1 text-slate-400">
              {isBatteryLow ? (
                <BatteryLow className="w-3.5 h-3.5 text-rose-400 animate-pulse" />
              ) : (
                <BatteryCharging className="w-3.5 h-3.5 text-emerald-400" />
              )}
              <span>BATTERY PACK</span>
            </span>
            <span
              className={`font-bold ${
                isBatteryLow
                  ? 'text-rose-400 animate-pulse'
                  : robotStatus.battery > 50
                  ? 'text-emerald-300'
                  : 'text-amber-300'
              }`}
            >
              {robotStatus.battery.toFixed(1)}%
            </span>
          </div>
          {/* Battery Meter */}
          <div className="h-1.5 w-full bg-[#141d33] rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-300 ${
                isBatteryLow
                  ? 'bg-rose-500'
                  : robotStatus.battery > 50
                  ? 'bg-emerald-400'
                  : 'bg-amber-400'
              }`}
              style={{ width: `${robotStatus.battery}%` }}
            />
          </div>

          {/* Collision Counter */}
          <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1">
            <span className="flex items-center space-x-1">
              <Flame className="w-3 h-3 text-amber-400" />
              <span>IMPACTS / COLLISIONS</span>
            </span>
            <span
              className={`font-bold ${
                (authoritativeExecutionRecord?.collisionCount ?? robotStatus.collisionCount) > 0
                  ? 'text-rose-400'
                  : 'text-slate-400'
              }`}
            >
              {authoritativeExecutionRecord?.collisionCount ?? robotStatus.collisionCount}
            </span>
          </div>
        </div>

        {/* Role Banner if Multiplayer */}
        {isMultiplayerActive && (
          <div className="flex items-center justify-between px-2.5 py-1 rounded-lg bg-[#070a13] border border-[#1e2942] text-[10px]">
            <span className="text-slate-400 font-semibold">ROLE:</span>
            <span
              className={`font-bold uppercase ${
                userRole === 'operator' ? 'text-cyan-300' : 'text-amber-400'
              }`}
            >
              {userRole === 'operator' ? 'ROBOT OPERATOR (AUTHORITY)' : 'SCENARIO CONTROLLER (LOCKED)'}
            </span>
          </div>
        )}

        {/* Emergency Stop Button & Status Indicator */}
        <div className="pt-1">
          {isMultiplayerActive && userRole === 'controller' ? (
            <button
              disabled={true}
              className="w-full flex items-center justify-center space-x-2 py-2 px-4 rounded-xl text-xs font-bold tracking-wider bg-slate-900/60 text-slate-500 border border-slate-800 cursor-not-allowed"
              title="Emergency Stop authority is exclusive to the Robot Operator"
            >
              <Octagon className="w-4 h-4 fill-current opacity-40" />
              <span>{isEStopped ? 'E-STOP (OPERATOR ENGAGED)' : 'E-STOP (OPERATOR ONLY)'}</span>
            </button>
          ) : (
            <button
              onClick={toggleEmergencyStop}
              className={`w-full flex items-center justify-center space-x-2 py-2.5 px-4 rounded-xl text-xs font-bold tracking-wider transition-all duration-150 shadow-lg ${
                isEStopped
                  ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-600/40 animate-pulse border border-rose-400'
                  : 'bg-rose-950/60 hover:bg-rose-900/80 text-rose-300 border border-rose-800/60 shadow-rose-950/20'
              }`}
            >
              <Octagon className="w-4 h-4 fill-current" />
              <span>
                {isEStopped ? 'EMERGENCY STOP ENGAGED' : 'EMERGENCY STOP [SPACE]'}
              </span>
            </button>
          )}
        </div>

        {/* Operational Status & Pose Reset */}
        <div className="flex items-center justify-between pt-1 text-[11px]">
          <div className="flex items-center space-x-1.5">
            {isEStopped ? (
              <>
                <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
                <span className="text-rose-300 font-semibold">HALTED</span>
              </>
            ) : (
              <>
                <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-emerald-300 font-semibold">NOMINAL</span>
              </>
            )}
          </div>

          <button
            onClick={() => resetRobotPose()}
            disabled={isMultiplayerActive && userRole === 'controller'}
            className={`flex items-center space-x-1 px-2.5 py-1 rounded border transition-colors text-[10px] ${
              isMultiplayerActive && userRole === 'controller'
                ? 'bg-slate-900/40 text-slate-600 border-slate-800 cursor-not-allowed'
                : 'bg-[#141d33] hover:bg-[#1e2942] text-slate-300 hover:text-cyan-300 border-[#1e2942]'
            }`}
            title={isMultiplayerActive && userRole === 'controller' ? 'Resetting pose is reserved for Robot Operator' : 'Reset robot to spawn coordinates'}
          >
            <RotateCcw className="w-3 h-3" />
            <span>RESET POSE</span>
          </button>
        </div>
      </div>

      {/* Manual Mode Keyboard Guide */}
      {mode === 'manual' && (
        <div className="p-2.5 rounded-xl bg-[#0d1322]/80 backdrop-blur-sm border border-[#1e2942] text-[10px] text-slate-400 space-y-1">
          <div className="font-bold text-cyan-300 flex items-center justify-between">
            <span>MANUAL DRIVER CONTROLS</span>
            {isMultiplayerActive && userRole === 'controller' && (
              <span className="text-[9px] text-amber-400 font-normal">LOCKED</span>
            )}
          </div>
          {isMultiplayerActive && userRole === 'controller' ? (
            <div className="p-2 rounded bg-[#070a13] border border-amber-900/40 text-[10px] text-amber-300/80 leading-relaxed">
              ⚠️ <strong>Scenario Controller Mode:</strong> Teleoperation driving inputs (WASD) and emergency braking are exclusively controlled by the Robot Operator. You can inject obstacles and trigger challenge scenarios.
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-1 pt-0.5">
                <div>
                  <kbd className="px-1 py-0.5 rounded bg-[#141d33] border border-[#1e2942] text-slate-200">
                    W / ↑
                  </kbd>{' '}
                  Drive Forward
                </div>
                <div>
                  <kbd className="px-1 py-0.5 rounded bg-[#141d33] border border-[#1e2942] text-slate-200">
                    S / ↓
                  </kbd>{' '}
                  Reverse
                </div>
                <div>
                  <kbd className="px-1 py-0.5 rounded bg-[#141d33] border border-[#1e2942] text-slate-200">
                    A / ←
                  </kbd>{' '}
                  Steer Left
                </div>
                <div>
                  <kbd className="px-1 py-0.5 rounded bg-[#141d33] border border-[#1e2942] text-slate-200">
                    D / →
                  </kbd>{' '}
                  Steer Right
                </div>
              </div>
              <div className="pt-1 text-[9px] text-slate-500 border-t border-[#1e2942]">
                <kbd className="px-1 py-0.5 rounded bg-[#141d33] text-slate-200">SPACE</kbd>{' '}
                Toggle Emergency Braking
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};
