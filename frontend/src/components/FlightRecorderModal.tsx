import React, { useState, useEffect } from 'react';
import {
  Radio,
  Square,
  Play,
  Trash2,
  X,
  AlertTriangle,
  ShieldAlert,
  Flame,
  Clock,
  Compass,
  FileSpreadsheet,
  FileText,
  Activity,
  Layers,
  Info,
  Award,
  Sparkles,
} from 'lucide-react';
import { useSimulationStore } from '../state/useSimulationStore';
import { SpatialIncident } from '../services/spatialRiskService';
import {
  flightRecorderService,
  FlightRecordingSession,
  IncidentEvent,
  IncidentType,
} from '../services/flightRecorder';

interface FlightRecorderModalProps {
  forceOpen?: boolean;
}

export const FlightRecorderModal: React.FC<FlightRecorderModalProps> = ({ forceOpen }) => {
  const storeOpen = useSimulationStore((s) => s.isFlightRecorderOpen);
  const setOpen = useSimulationStore((s) => s.setFlightRecorderOpen);
  const isRecording = useSimulationStore((s) => s.isRecordingFlightData);
  const startRecording = useSimulationStore((s) => s.startFlightRecording);
  const stopRecording = useSimulationStore((s) => s.stopFlightRecording);
  const clearRecordings = useSimulationStore((s) => s.clearFlightRecordings);
  const setBenchmarkCenterOpen = useSimulationStore((s) => s.setBenchmarkCenterOpen);
  const saveActiveSessionAsBenchmark = useSimulationStore((s) => s.saveActiveSessionAsBenchmark);
  const setAdvisorOpen = useSimulationStore((s) => s.setAdvisorOpen);
  const setAdvisorSelectedIncident = useSimulationStore((s) => s.setAdvisorSelectedIncident);

  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [selectedIncident, setSelectedIncident] = useState<IncidentEvent | null>(null);
  const [, setRefreshTick] = useState(0);

  const isOpen = forceOpen !== undefined ? forceOpen : storeOpen;

  // Poll for UI updates while recording (every 500ms)
  useEffect(() => {
    if (!isOpen) return;
    const interval = setInterval(() => {
      setRefreshTick((prev) => prev + 1);
    }, 500);
    return () => clearInterval(interval);
  }, [isOpen, isRecording]);

  if (!isOpen) return null;

  const allSessions = flightRecorderService.getAllSessions();
  const currentSession = flightRecorderService.getCurrentSession();
  
  // Active session being viewed
  const viewingSession: FlightRecordingSession | null =
    (selectedSessionId ? allSessions.find((s) => s.recordingId === selectedSessionId) : null) ||
    currentSession ||
    allSessions[0] ||
    null;

  const incidents = viewingSession?.incidents || [];

  const handleExportJSON = (session: FlightRecordingSession) => {
    if (session.frames.length === 0 && session.incidents.length === 0) {
      alert('Cannot export an empty flight session with 0 frames.');
      return;
    }
    const jsonStr = flightRecorderService.exportSessionAsJSON(session);
    const filename = flightRecorderService.generateExportFilename(session, 'json');
    downloadFile(jsonStr, filename, 'application/json');
  };

  const handleExportCSV = (session: FlightRecordingSession) => {
    if (session.frames.length === 0) {
      alert('Cannot export CSV: no telemetry frames were recorded in this session.');
      return;
    }
    const csvStr = flightRecorderService.exportSessionAsCSV(session);
    const filename = flightRecorderService.generateExportFilename(session, 'csv');
    downloadFile(csvStr, filename, 'text/csv;charset=utf-8;');
  };

  const downloadFile = (content: string, filename: string, mimeType: string) => {
    try {
      const blob = new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to trigger export download:', err);
      alert('Failed to generate export file. Check browser permissions.');
    }
  };

  const getIncidentBadge = (type: IncidentType) => {
    switch (type) {
      case 'COLLISION':
        return { label: 'COLLISION', color: 'bg-rose-950 text-rose-300 border-rose-600', icon: Flame };
      case 'NEAR_MISS':
        return { label: 'NEAR MISS', color: 'bg-amber-950 text-amber-300 border-amber-600', icon: AlertTriangle };
      case 'TTC_CRITICAL':
        return { label: 'TTC CRITICAL', color: 'bg-rose-900 text-rose-200 border-rose-500 animate-pulse', icon: ShieldAlert };
      case 'TTC_WARNING':
        return { label: 'TTC WARNING', color: 'bg-yellow-950 text-yellow-300 border-yellow-600', icon: AlertTriangle };
      case 'EMERGENCY_BRAKING':
        return { label: 'E-BRAKE', color: 'bg-purple-950 text-purple-300 border-purple-600', icon: Activity };
      case 'ROUTE_BLOCKED':
        return { label: 'BLOCKED', color: 'bg-red-950 text-red-300 border-red-700', icon: AlertTriangle };
      case 'ROUTE_RECALCULATED':
        return { label: 'REPLAN', color: 'bg-cyan-950 text-cyan-300 border-cyan-600', icon: Compass };
      case 'OBSTACLE_DETECTED':
        return { label: 'OBSTACLE', color: 'bg-blue-950 text-blue-300 border-blue-600', icon: Info };
      case 'NAVIGATION_FAILED':
        return { label: 'FAILED', color: 'bg-rose-950 text-rose-400 border-rose-700', icon: X };
      case 'MISSION_COMPLETED':
        return { label: 'COMPLETED', color: 'bg-emerald-950 text-emerald-300 border-emerald-600', icon: Compass };
      default:
        return { label: type, color: 'bg-slate-800 text-slate-300 border-slate-600', icon: Info };
    }
  };

  return (
    <div
      data-testid="flight-recorder-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-md font-mono select-none pointer-events-auto animate-in fade-in duration-150"
    >
      <div className="relative w-full max-w-5xl h-[90vh] max-h-[820px] flex flex-col rounded-2xl bg-[#080d18] border border-cyan-800/80 shadow-2xl shadow-cyan-950/60 overflow-hidden text-slate-200">
        
        {/* Header Bar */}
        <div className="shrink-0 flex items-center justify-between px-5 py-3.5 border-b border-[#1b263b] bg-[#050811]">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-lg bg-cyan-950/60 border border-cyan-700/60 text-cyan-400">
              <Radio className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-extrabold text-sm tracking-wider text-slate-100">
                  BLACK BOX FLIGHT RECORDER & TELEMETRY
                </span>
                <span
                  data-testid="flight-recorder-status-badge"
                  className={`text-[10px] px-2 py-0.5 rounded-full border font-bold uppercase ${
                    isRecording
                      ? 'bg-rose-950 text-rose-300 border-rose-600 animate-pulse'
                      : viewingSession?.isCompleted
                      ? 'bg-slate-800 text-slate-300 border-slate-600'
                      : 'bg-slate-900 text-slate-400 border-slate-800'
                  }`}
                >
                  {isRecording ? 'RECORDING (10 HZ)' : viewingSession ? 'ARCHIVED SESSION' : 'IDLE'}
                </span>
              </div>
              <span className="text-[11px] text-slate-400">
                Bounded circular ring buffer (10,000 frames) with event-driven incident capture
              </span>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            {/* Start / Stop Toggle Button */}
            {isRecording ? (
              <button
                data-testid="stop-recording-button"
                onClick={stopRecording}
                className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs shadow-lg shadow-rose-900/50 transition-all"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
                <span>STOP RECORDING</span>
              </button>
            ) : (
              <button
                data-testid="start-recording-button"
                onClick={startRecording}
                className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-lg shadow-emerald-900/50 transition-all"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>START RECORDING</span>
              </button>
            )}

            <button
              onClick={() => setOpen(false)}
              className="p-1.5 rounded-lg bg-[#0d1322] hover:bg-[#1a233a] border border-[#1e2942] text-slate-400 hover:text-white transition-colors"
              title="Close Flight Recorder"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Sessions Tabs & Action Controls Bar */}
        <div className="shrink-0 flex items-center justify-between px-5 py-2.5 border-b border-[#1b263b] bg-[#090e1c] text-xs">
          {/* Historical Session Selector (Max 5 retained) */}
          <div className="flex items-center space-x-2 overflow-x-auto max-w-[65%]">
            <span className="text-[11px] text-slate-500 uppercase font-bold shrink-0">Sessions ({allSessions.length}/5):</span>
            {allSessions.length === 0 ? (
              <span className="text-[11px] text-slate-500 italic">No saved recordings</span>
            ) : (
              allSessions.map((sess) => {
                const isSelected = viewingSession?.recordingId === sess.recordingId;
                const isCurrentActive = isRecording && sess.recordingId === currentSession?.recordingId;
                return (
                  <button
                    key={sess.recordingId}
                    onClick={() => {
                      setSelectedSessionId(sess.recordingId);
                      setSelectedIncident(null);
                    }}
                    className={`flex items-center space-x-1 px-2.5 py-1 rounded-md text-[11px] border font-bold transition-all shrink-0 ${
                      isSelected
                        ? 'bg-cyan-950 text-cyan-300 border-cyan-600 shadow-md shadow-cyan-900/30'
                        : 'bg-[#060a14] hover:bg-[#101728] text-slate-400 hover:text-slate-200 border-[#1e2942]'
                    }`}
                  >
                    {isCurrentActive && <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-ping mr-0.5" />}
                    <span>{sess.recordingId}</span>
                    <span className="text-[9px] opacity-75">({sess.frames.length}f)</span>
                  </button>
                );
              })
            )}
          </div>

          {/* Export & Clear Actions */}
          <div className="flex items-center space-x-2">
            {viewingSession && (
              <>
                <button
                  data-testid="export-json-button"
                  onClick={() => handleExportJSON(viewingSession)}
                  className="flex items-center space-x-1 px-2.5 py-1 rounded-md bg-[#0e1629] hover:bg-[#1a2642] text-cyan-300 border border-cyan-800/60 text-[11px] font-semibold transition-colors"
                  title="Export complete session metadata, telemetry frames and incident snapshots as JSON"
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>EXPORT JSON</span>
                </button>

                <button
                  data-testid="export-csv-button"
                  onClick={() => handleExportCSV(viewingSession)}
                  className="flex items-center space-x-1 px-2.5 py-1 rounded-md bg-[#0e1629] hover:bg-[#1a2642] text-emerald-300 border border-emerald-800/60 text-[11px] font-semibold transition-colors"
                  title="Export telemetry frames as RFC 4180 CSV spreadsheet"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  <span>EXPORT CSV</span>
                </button>

                <button
                  data-testid="save-as-benchmark-button"
                  onClick={() => {
                    const run = saveActiveSessionAsBenchmark(undefined, 'custom', viewingSession.recordingId);
                    if (run) {
                      setOpen(false);
                      setBenchmarkCenterOpen(true);
                    }
                  }}
                  className="flex items-center space-x-1 px-2.5 py-1 rounded-md bg-[#0e1629] hover:bg-[#1a2642] text-amber-300 border border-amber-800/60 text-[11px] font-semibold transition-colors"
                  title="Save this flight recording session as an authoritative benchmark run and compare"
                >
                  <Award className="w-3.5 h-3.5" />
                  <span>BENCHMARK</span>
                </button>
              </>
            )}

            {allSessions.length > 0 && !isRecording && (
              <button
                data-testid="clear-recordings-button"
                onClick={() => {
                  if (confirm('Clear all stored flight recorder sessions?')) {
                    clearRecordings();
                    setSelectedIncident(null);
                    setSelectedSessionId(null);
                  }
                }}
                className="flex items-center space-x-1 px-2 py-1 rounded-md bg-[#0e1629] hover:bg-rose-950/60 text-slate-400 hover:text-rose-300 border border-[#1e2942] hover:border-rose-800 text-[11px] transition-colors"
                title="Purge all retained sessions from memory"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Selected Session Info Banner */}
        {viewingSession ? (
          <div className="shrink-0 px-5 py-2.5 bg-[#050811] border-b border-[#1b263b] grid grid-cols-2 sm:grid-cols-5 gap-3 text-[11px]">
            <div>
              <span className="text-slate-500 text-[10px] block">SESSION ID</span>
              <span className="font-bold text-slate-200 truncate block">{viewingSession.sessionId}</span>
            </div>
            <div>
              <span className="text-slate-500 text-[10px] block">AUTHORITY</span>
              <span
                data-testid="session-authority-badge"
                className={`font-bold ${
                  viewingSession.isAuthoritative ? 'text-cyan-400' : 'text-amber-400'
                }`}
              >
                {viewingSession.isAuthoritative ? 'AUTHORITATIVE' : 'REMOTE MIRROR'}
              </span>
            </div>
            <div>
              <span className="text-slate-500 text-[10px] block">DURATION</span>
              <span className="font-bold text-slate-200">
                {(viewingSession.endTimeSim - viewingSession.startTimeSim).toFixed(1)}s
              </span>
            </div>
            <div>
              <span className="text-slate-500 text-[10px] block">FRAMES CAPTURED</span>
              <span data-testid="frames-count" className="font-bold text-cyan-300">
                {viewingSession.frames.length} / 10,000
                {viewingSession.hasBufferWrapped && (
                  <span className="text-[9px] text-amber-400 ml-1">(wrapped)</span>
                )}
              </span>
            </div>
            <div>
              <span className="text-slate-500 text-[10px] block">INCIDENTS LOGGED</span>
              <span
                data-testid="incidents-count"
                className={`font-bold ${
                  viewingSession.incidents.length > 0 ? 'text-amber-400' : 'text-emerald-400'
                }`}
              >
                {viewingSession.incidents.length} EVENTS
              </span>
            </div>
          </div>
        ) : (
          <div className="shrink-0 px-5 py-4 bg-[#050811] border-b border-[#1b263b] text-center text-slate-500 text-xs italic">
            No flight data recorded. Click "START RECORDING" to capture 10 Hz telemetry and critical incidents.
          </div>
        )}

        {/* Main Content: Split Master-Detail Layout */}
        <div className="flex-1 min-h-0 flex flex-col md:flex-row overflow-hidden">
          {/* Left Column: Chronological Incident Timeline */}
          <div className="w-full md:w-5/12 border-b md:border-b-0 md:border-r border-[#1b263b] flex flex-col min-h-0 bg-[#070b16]">
            <div className="shrink-0 flex items-center justify-between px-3.5 py-2 border-b border-[#1b263b] bg-[#050811] text-[11px] font-bold text-slate-400">
              <span className="flex items-center space-x-1.5">
                <Clock className="w-3.5 h-3.5 text-cyan-400" />
                <span>INCIDENT TIMELINE ({incidents.length})</span>
              </span>
              <span className="text-[10px] text-slate-500">Click to inspect</span>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto p-2.5 space-y-2">
              {incidents.length === 0 ? (
                <div className="p-8 text-center text-slate-500 text-xs space-y-1">
                  <Info className="w-6 h-6 mx-auto text-slate-600 mb-2" />
                  <p>No critical incident events recorded.</p>
                  <p className="text-[10px] text-slate-600">
                    Incidents trigger on collisions, near-misses, emergency stops, route blockage, and critical TTC thresholds.
                  </p>
                </div>
              ) : (
                incidents.map((inc) => {
                  const badge = getIncidentBadge(inc.type);
                  const isSelected = selectedIncident?.id === inc.id;
                  const Icon = badge.icon;
                  return (
                    <div
                      key={inc.id}
                      data-testid={`incident-item-${inc.id}`}
                      onClick={() => setSelectedIncident(inc)}
                      className={`p-2.5 rounded-lg border cursor-pointer transition-all ${
                        isSelected
                          ? 'bg-[#0f1930] border-cyan-500 shadow-md shadow-cyan-950/40'
                          : 'bg-[#0a0f1d] hover:bg-[#121c33] border-[#1e2942]/70 text-slate-300'
                      }`}
                    >
                      <div className="flex items-center justify-between text-[10px] mb-1">
                        <span className={`px-1.5 py-0.5 rounded font-bold border text-[9px] flex items-center space-x-1 ${badge.color}`}>
                          <Icon className="w-3 h-3" />
                          <span>{badge.label}</span>
                        </span>
                        <span className="font-mono text-cyan-400 font-bold">
                          t = {inc.simTime.toFixed(2)}s
                        </span>
                      </div>
                      <p className="text-[11px] font-semibold text-slate-200 line-clamp-2 leading-snug">
                        {inc.description}
                      </p>
                      <div className="flex items-center justify-between text-[10px] text-slate-500 pt-1 mt-1 border-t border-[#1b263b]/60">
                        <span>Threat: {inc.snapshot.highestRiskObstacle || 'N/A'}</span>
                        <span>Clearance: {inc.snapshot.minClearance.toFixed(2)}m</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Right Column: Exact-Time Incident Telemetry Inspector */}
          <div className="flex-1 min-h-0 flex flex-col bg-[#050811] overflow-hidden">
            <div className="shrink-0 flex items-center justify-between px-4 py-2 border-b border-[#1b263b] bg-[#070b16] text-[11px] font-bold text-slate-400">
              <span className="flex items-center space-x-1.5">
                <Layers className="w-3.5 h-3.5 text-cyan-400" />
                <span>EXACT-TIME TELEMETRY SNAPSHOT</span>
              </span>
              {selectedIncident && (
                <span className="text-[10px] text-cyan-300 font-mono">
                  Event ID: {selectedIncident.id}
                </span>
              )}
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
              {selectedIncident ? (
                <>
                  {/* Event Overview Card */}
                  <div className="p-3 rounded-xl bg-[#0b1020] border border-cyan-800/60 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        {React.createElement(getIncidentBadge(selectedIncident.type).icon, {
                          className: 'w-4 h-4 text-rose-400',
                        })}
                        <span className="font-bold text-slate-100 text-xs">
                          {selectedIncident.type}
                        </span>
                      </div>
                      <div className="text-right text-[10px] text-slate-400 font-mono">
                        <div>Sim Time: <span className="font-bold text-cyan-300">{selectedIncident.simTime.toFixed(3)}s</span></div>
                        <div>Wall Time: <span>{new Date(selectedIncident.wallTime).toISOString()}</span></div>
                      </div>
                    </div>
                    <p className="text-xs text-slate-200 leading-relaxed font-sans font-medium bg-[#060914] p-2 rounded border border-[#1b263b]">
                      {selectedIncident.description}
                    </p>
                    <button
                      data-testid="analyze-incident-ai-btn"
                      onClick={() => {
                        const spatialInc: SpatialIncident = {
                          id: selectedIncident.id,
                          type: selectedIncident.type,
                          position: selectedIncident.snapshot.position,
                          simTime: selectedIncident.simTime,
                          wallTime: selectedIncident.wallTime,
                          description: selectedIncident.description,
                          minClearance: selectedIncident.snapshot.minClearance,
                          ttc: selectedIncident.snapshot.ttc,
                          highestRiskObstacle: selectedIncident.snapshot.highestRiskObstacle,
                          linearVelocity: selectedIncident.snapshot.linearVelocity,
                          stoppingDistance: selectedIncident.details?.stoppingDistance ?? null,
                          sourceSessionId: viewingSession?.recordingId,
                        };
                        setAdvisorSelectedIncident(spatialInc);
                        setOpen(false);
                        setAdvisorOpen(true);
                      }}
                      className="w-full mt-2 py-2 px-3 rounded-lg bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-bold text-xs flex items-center justify-center space-x-2 shadow-lg shadow-purple-900/30 transition-all cursor-pointer"
                    >
                      <Sparkles className="w-4 h-4 text-amber-300" />
                      <span>ANALYZE WITH AI ADVISOR</span>
                    </button>
                  </div>

                  {/* Robot Dynamics Snapshot */}
                  <div className="p-3 rounded-xl bg-[#0b1020] border border-[#1b263b] space-y-2">
                    <span className="text-[10px] text-slate-500 uppercase font-bold block">Robot Pose & Dynamics</span>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                      <div className="p-1.5 rounded bg-[#060914] border border-[#1b263b]">
                        <span className="text-slate-500 text-[9px] block">POSITION (X, Z)</span>
                        <span className="font-bold text-slate-200">
                          [{selectedIncident.snapshot.position[0]}, {selectedIncident.snapshot.position[2]}]
                        </span>
                      </div>
                      <div className="p-1.5 rounded bg-[#060914] border border-[#1b263b]">
                        <span className="text-slate-500 text-[9px] block">HEADING (YAW)</span>
                        <span className="font-bold text-slate-200">
                          {selectedIncident.snapshot.rotation.toFixed(2)} rad
                        </span>
                      </div>
                      <div className="p-1.5 rounded bg-[#060914] border border-[#1b263b]">
                        <span className="text-slate-500 text-[9px] block">LINEAR SPEED</span>
                        <span className="font-bold text-cyan-300">
                          {selectedIncident.snapshot.linearVelocity.toFixed(2)} m/s
                        </span>
                      </div>
                      <div className="p-1.5 rounded bg-[#060914] border border-[#1b263b]">
                        <span className="text-slate-500 text-[9px] block">NAV STATE</span>
                        <span className="font-bold text-emerald-400">
                          {selectedIncident.snapshot.navState}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Safety & Collision Metrics Snapshot */}
                  <div className="p-3 rounded-xl bg-[#0b1020] border border-[#1b263b] space-y-2">
                    <span className="text-[10px] text-slate-500 uppercase font-bold block">Safety & Threat Assessment</span>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                      <div className="p-1.5 rounded bg-[#060914] border border-[#1b263b]">
                        <span className="text-slate-500 text-[9px] block">DYNAMIC TTC</span>
                        <span
                          className={`font-black ${
                            selectedIncident.snapshot.ttc !== null && selectedIncident.snapshot.ttc <= 1.5
                              ? 'text-rose-400'
                              : 'text-amber-400'
                          }`}
                        >
                          {selectedIncident.snapshot.ttc !== null ? `${selectedIncident.snapshot.ttc.toFixed(1)}s` : 'NONE'}
                        </span>
                      </div>
                      <div className="p-1.5 rounded bg-[#060914] border border-[#1b263b]">
                        <span className="text-slate-500 text-[9px] block">MIN CLEARANCE</span>
                        <span className="font-black text-rose-300">
                          {selectedIncident.snapshot.minClearance.toFixed(2)} m
                        </span>
                      </div>
                      <div className="p-1.5 rounded bg-[#060914] border border-[#1b263b]">
                        <span className="text-slate-500 text-[9px] block">SAFETY STATUS</span>
                        <span
                          className={`font-black ${
                            selectedIncident.snapshot.safetyStatus === 'CRITICAL'
                              ? 'text-rose-400'
                              : 'text-amber-400'
                          }`}
                        >
                          {selectedIncident.snapshot.safetyStatus}
                        </span>
                      </div>
                      <div className="p-1.5 rounded bg-[#060914] border border-[#1b263b]">
                        <span className="text-slate-500 text-[9px] block">PRIMARY THREAT</span>
                        <span className="font-bold text-amber-300 truncate block">
                          {selectedIncident.snapshot.highestRiskObstacle || 'N/A'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* LiDAR Range Readings */}
                  <div className="p-3 rounded-xl bg-[#0b1020] border border-[#1b263b] space-y-2">
                    <span className="text-[10px] text-slate-500 uppercase font-bold block">LiDAR Range Rays</span>
                    <div className="grid grid-cols-3 gap-2 text-[11px] text-center">
                      <div className="p-1.5 rounded bg-[#060914] border border-[#1b263b]">
                        <span className="text-slate-500 text-[9px]">LEFT RAY</span>
                        <div className="font-bold text-slate-200">{selectedIncident.snapshot.lidar.left.toFixed(2)}m</div>
                      </div>
                      <div className="p-1.5 rounded bg-[#060914] border border-[#1b263b]">
                        <span className="text-slate-500 text-[9px]">FORWARD RAY</span>
                        <div className="font-bold text-rose-400">{selectedIncident.snapshot.lidar.forward.toFixed(2)}m</div>
                      </div>
                      <div className="p-1.5 rounded bg-[#060914] border border-[#1b263b]">
                        <span className="text-slate-500 text-[9px]">RIGHT RAY</span>
                        <div className="font-bold text-slate-200">{selectedIncident.snapshot.lidar.right.toFixed(2)}m</div>
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <div className="p-12 text-center text-slate-500 text-xs space-y-2">
                  <Activity className="w-8 h-8 mx-auto text-slate-600 mb-2" />
                  <p className="font-bold text-slate-400">Select an incident from the timeline</p>
                  <p className="text-[11px] text-slate-600 max-w-sm mx-auto">
                    Inspect the exact-time kinematic and sensor telemetry snapshot captured at the precise moment of the hazard.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};
