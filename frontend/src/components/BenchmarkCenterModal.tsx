import React, { useState } from 'react';
import {
  BarChart3,
  Award,
  AlertTriangle,
  CheckCircle2,
  Upload,
  Download,
  Trash2,
  X,
  Info,
  Sparkles,
} from 'lucide-react';
import { useSimulationStore } from '../state/useSimulationStore';
import {
  benchmarkService,
  BenchmarkComparison,
  MAX_BENCHMARK_RUNS,
} from '../services/benchmarkService';
import { flightRecorderService } from '../services/flightRecorder';
import { spatialRiskService } from '../services/spatialRiskService';

interface BenchmarkCenterModalProps {
  forceOpen?: boolean;
}

export const BenchmarkCenterModal: React.FC<BenchmarkCenterModalProps> = ({ forceOpen }) => {
  const storeOpen = useSimulationStore((s) => s.isBenchmarkCenterOpen);
  const setOpen = useSimulationStore((s) => s.setBenchmarkCenterOpen);
  const saveActiveSession = useSimulationStore((s) => s.saveActiveSessionAsBenchmark);
  const setAdvisorOpen = useSimulationStore((s) => s.setAdvisorOpen);
  const setAdvisorSelectedIncident = useSimulationStore((s) => s.setAdvisorSelectedIncident);

  const [activeTab, setActiveTab] = useState<'dashboard' | 'comparison' | 'analytics'>('dashboard');
  const [includeRemoteMirrors, setIncludeRemoteMirrors] = useState(false);

  // Comparison selections
  const [selectedBaselineId, setSelectedBaselineId] = useState<string | null>(null);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);

  // Custom Run Save Inputs
  const [newRunName, setNewRunName] = useState('');
  const [newRunVariant, setNewRunVariant] = useState<'baseline' | 'optimized' | 'custom'>('custom');

  const [, setRefreshTrigger] = useState(0);

  const isOpen = forceOpen !== undefined ? forceOpen : storeOpen;
  if (!isOpen) return null;

  const allRuns = benchmarkService.getAllRuns();
  const summary = benchmarkService.getDashboardSummary(includeRemoteMirrors);

  // Filtered runs for display
  const displayRuns = includeRemoteMirrors
    ? allRuns
    : allRuns.filter((r) => r.isAuthoritative);

  // Active Flight Recorder Session available to save
  const activeSession = flightRecorderService.getCurrentSession() || flightRecorderService.getPastSessions()[0];

  // Auto-select baseline and candidate if not already set
  const baselineRun = selectedBaselineId
    ? benchmarkService.getRunById(selectedBaselineId)
    : displayRuns.find((r) => r.variantTag === 'baseline') || displayRuns[1] || displayRuns[0] || null;

  const candidateRun = selectedCandidateId
    ? benchmarkService.getRunById(selectedCandidateId)
    : displayRuns.find((r) => r.variantTag === 'optimized' && r.id !== baselineRun?.id) ||
      (displayRuns[0]?.id !== baselineRun?.id ? displayRuns[0] : displayRuns[1]) ||
      null;

  const comparison: BenchmarkComparison | null =
    baselineRun && candidateRun && baselineRun.id !== candidateRun.id
      ? benchmarkService.compareRuns(baselineRun, candidateRun)
      : null;

  const handleSaveCurrentSession = () => {
    if (!activeSession) return;
    const run = saveActiveSession(newRunName.trim() || undefined, newRunVariant);
    if (run) {
      setNewRunName('');
      setRefreshTrigger((prev) => prev + 1);
    }
  };

  const handleExportJSON = () => {
    if (allRuns.length === 0) {
      alert('No benchmark runs available to export.');
      return;
    }
    const jsonStr = benchmarkService.exportBenchmarksJSON();
    const filename = `robotrisk_benchmarks_export_${new Date().toISOString().replace(/[-:]/g, '').split('.')[0]}.json`;
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleImportJSON = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) {
        const result = benchmarkService.importBenchmarksJSON(content);
        if (result.errors.length > 0) {
          alert(`Import completed with warnings:\n- ${result.errors.join('\n- ')}`);
        } else {
          alert(`Successfully imported ${result.importedCount} benchmark runs!`);
        }
        setRefreshTrigger((prev) => prev + 1);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div
      data-testid="benchmark-center-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/85 backdrop-blur-md font-mono select-none pointer-events-auto animate-in fade-in duration-150"
    >
      <div className="relative w-full max-w-6xl h-[92vh] max-h-[860px] flex flex-col rounded-2xl bg-[#080d18] border border-cyan-800/80 shadow-2xl shadow-cyan-950/60 overflow-hidden text-slate-200">
        
        {/* Header Bar */}
        <div className="shrink-0 flex items-center justify-between px-5 py-3.5 border-b border-[#1b263b] bg-[#050811]">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-lg bg-cyan-950/60 border border-cyan-700/60 text-cyan-400">
              <Award className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-extrabold text-sm tracking-wider text-slate-100">
                  AUTONOMOUS ROBOT BENCHMARK CENTER
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded-full border border-cyan-700/60 bg-cyan-950/60 text-cyan-300 font-bold uppercase">
                  PHASE 5.3C
                </span>
              </div>
              <div className="flex items-center space-x-3 text-[11px] text-slate-400">
                <span>Evaluates & compares mission performance using genuine flight telemetry</span>
                <span className="text-slate-600">•</span>
                <span data-testid="storage-limit-indicator" className="text-cyan-400 font-semibold">
                  Storage: {allRuns.length} / {MAX_BENCHMARK_RUNS} runs (Oldest auto-archived upon reaching {MAX_BENCHMARK_RUNS})
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center space-x-2.5">
            {/* Export & Import Buttons */}
            <button
              data-testid="export-benchmarks-btn"
              onClick={handleExportJSON}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-[#0e1629] hover:bg-[#1a2642] text-cyan-300 border border-cyan-800/60 text-xs font-semibold transition-colors"
              title="Export all benchmark runs as JSON"
            >
              <Download className="w-3.5 h-3.5" />
              <span>EXPORT ALL</span>
            </button>

            <label className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-[#0e1629] hover:bg-[#1a2642] text-slate-300 hover:text-white border border-[#1e2942] text-xs font-semibold cursor-pointer transition-colors">
              <Upload className="w-3.5 h-3.5 text-cyan-400" />
              <span>IMPORT</span>
              <input type="file" accept=".json" onChange={handleImportJSON} className="hidden" />
            </label>

            <button
              onClick={() => setOpen(false)}
              className="p-1.5 rounded-lg bg-[#0d1322] hover:bg-[#1a233a] border border-[#1e2942] text-slate-400 hover:text-white transition-colors ml-1"
              title="Close Benchmark Center"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Dashboard KPI Banner (8 Required KPIs) */}
        <div className="shrink-0 px-5 py-3 bg-[#060a14] border-b border-[#1b263b] space-y-2">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-slate-400 font-bold uppercase tracking-wider flex items-center space-x-1.5">
              <BarChart3 className="w-3.5 h-3.5 text-cyan-400" />
              <span>OVERALL BENCHMARK PERFORMANCE DASHBOARD</span>
            </span>

            {/* Multiplayer Remote Mirror Filter Toggle */}
            <label className="flex items-center space-x-2 cursor-pointer text-slate-400 hover:text-slate-200">
              <input
                type="checkbox"
                checked={includeRemoteMirrors}
                onChange={(e) => setIncludeRemoteMirrors(e.target.checked)}
                className="rounded bg-[#0d1322] border-cyan-800 text-cyan-500 focus:ring-0 w-3.5 h-3.5"
              />
              <span className="text-[10px]">
                Include Remote Mirrors ({summary.remoteMirrorRunsCount})
              </span>
            </label>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
            <div className="p-2 rounded-lg bg-[#0a0f1d] border border-[#1b263b]">
              <span className="text-[9px] text-slate-500 block truncate">TOTAL RUNS</span>
              <span data-testid="kpi-total-runs" className="text-base font-black text-slate-100">{summary.totalRuns}</span>
            </div>

            <div className="p-2 rounded-lg bg-[#0a0f1d] border border-[#1b263b]">
              <span className="text-[9px] text-slate-500 block truncate">SUCCESS RATE</span>
              <span
                data-testid="kpi-success-rate"
                className={`text-base font-black ${
                  summary.successRate >= 80
                    ? 'text-emerald-400'
                    : summary.successRate >= 50
                    ? 'text-amber-400'
                    : 'text-rose-400'
                }`}
              >
                {summary.totalRuns > 0 ? `${summary.successRate}%` : 'N/A'}
              </span>
            </div>

            <div className="p-2 rounded-lg bg-[#0a0f1d] border border-[#1b263b]">
              <span className="text-[9px] text-slate-500 block truncate">OUTCOMES</span>
              <span data-testid="kpi-outcomes" className="text-xs font-bold text-slate-200 truncate block">
                {summary.completedRuns}c / {summary.failedRuns}f / {summary.abortedRuns}a
              </span>
            </div>

            <div className="p-2 rounded-lg bg-[#0a0f1d] border border-[#1b263b]">
              <span className="text-[9px] text-slate-500 block truncate">AVG TIME TO GOAL</span>
              <span data-testid="kpi-avg-time" className="text-base font-black text-cyan-300">
                {summary.avgTimeToGoalSeconds !== null ? `${summary.avgTimeToGoalSeconds}s` : 'N/A'}
              </span>
            </div>

            <div className="p-2 rounded-lg bg-[#0a0f1d] border border-[#1b263b]">
              <span className="text-[9px] text-slate-500 block truncate">TOTAL COLLISIONS</span>
              <span
                data-testid="kpi-total-collisions"
                className={`text-base font-black ${
                  summary.totalCollisions > 0 ? 'text-rose-400' : 'text-emerald-400'
                }`}
              >
                {summary.totalCollisions}
              </span>
            </div>

            <div className="p-2 rounded-lg bg-[#0a0f1d] border border-[#1b263b]">
              <span className="text-[9px] text-slate-500 block truncate">TOTAL NEAR-MISSES</span>
              <span
                data-testid="kpi-total-near-misses"
                className={`text-base font-black ${
                  summary.totalNearMisses > 0 ? 'text-amber-400' : 'text-emerald-400'
                }`}
              >
                {summary.totalNearMisses}
              </span>
            </div>

            <div className="p-2 rounded-lg bg-[#0a0f1d] border border-[#1b263b]">
              <span className="text-[9px] text-slate-500 block truncate">NEAR-MISSES / KM</span>
              <span data-testid="kpi-near-misses-per-km" className="text-base font-black text-amber-300">
                {summary.overallNearMissesPerKm !== null ? `${summary.overallNearMissesPerKm}` : 'N/A'}
              </span>
            </div>

            <div className="p-2 rounded-lg bg-[#0a0f1d] border border-[#1b263b]">
              <span className="text-[9px] text-slate-500 block truncate">AVG MIN CLEARANCE</span>
              <span data-testid="kpi-avg-min-clearance" className="text-base font-black text-slate-200">
                {summary.avgMinClearanceMeters !== null ? `${summary.avgMinClearanceMeters}m` : 'N/A'}
              </span>
            </div>
          </div>
        </div>

        {/* Tab Navigation Controls */}
        <div className="shrink-0 flex items-center justify-between px-5 border-b border-[#1b263b] bg-[#070b16]">
          <div className="flex space-x-1">
            <button
              data-testid="tab-dashboard"
              onClick={() => setActiveTab('dashboard')}
              className={`px-4 py-2.5 text-xs font-bold border-b-2 transition-all ${
                activeTab === 'dashboard'
                  ? 'border-cyan-400 text-cyan-300 bg-cyan-950/20'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              RUN MANAGER & RECORDINGS ({displayRuns.length})
            </button>

            <button
              data-testid="tab-comparison"
              onClick={() => setActiveTab('comparison')}
              className={`px-4 py-2.5 text-xs font-bold border-b-2 transition-all flex items-center space-x-1.5 ${
                activeTab === 'comparison'
                  ? 'border-cyan-400 text-cyan-300 bg-cyan-950/20'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <span>RUN COMPARISON (A / B)</span>
              {comparison && (
                <span className="px-1.5 py-0.2 rounded text-[9px] bg-cyan-950 border border-cyan-700 text-cyan-300">
                  READY
                </span>
              )}
            </button>

            <button
              data-testid="tab-analytics"
              onClick={() => setActiveTab('analytics')}
              className={`px-4 py-2.5 text-xs font-bold border-b-2 transition-all ${
                activeTab === 'analytics'
                  ? 'border-cyan-400 text-cyan-300 bg-cyan-950/20'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              BENCHMARK CHARTS & TRENDS
            </button>
          </div>
        </div>

        {/* Tab 1: Run Management & Save Panel */}
        {activeTab === 'dashboard' && (
          <div className="flex-1 min-h-0 flex flex-col p-4 space-y-4 overflow-y-auto">
            {/* Quick Save Current Active Flight Recording */}
            {activeSession && (
              <div className="p-3.5 rounded-xl bg-[#0b1020] border border-cyan-800/60 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
                <div className="space-y-1">
                  <div className="flex items-center space-x-2">
                    <span className="text-[10px] px-2 py-0.5 rounded bg-cyan-950 border border-cyan-700 text-cyan-300 font-bold uppercase">
                      ACTIVE FLIGHT SESSION: {activeSession.recordingId}
                    </span>
                    <span className="text-slate-400 text-[11px]">
                      {activeSession.frames.length} frames captured • {(activeSession.endTimeSim - activeSession.startTimeSim).toFixed(1)}s elapsed
                    </span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <input
                      data-testid="benchmark-name-input"
                      type="text"
                      placeholder="Run Name (e.g. Baseline Speeds - Bay 4)"
                      value={newRunName}
                      onChange={(e) => setNewRunName(e.target.value)}
                      className="px-2.5 py-1 rounded bg-[#060914] border border-[#1b263b] text-xs text-slate-100 focus:border-cyan-500 outline-none w-64"
                    />
                    <select
                      data-testid="benchmark-variant-select"
                      value={newRunVariant}
                      onChange={(e) => setNewRunVariant(e.target.value as any)}
                      className="px-2 py-1 rounded bg-[#060914] border border-[#1b263b] text-xs text-slate-300 focus:border-cyan-500 outline-none"
                    >
                      <option value="baseline">Baseline Config</option>
                      <option value="optimized">Optimized Config</option>
                      <option value="custom">Custom Run</option>
                    </select>
                  </div>
                </div>

                <button
                  data-testid="save-benchmark-run-btn"
                  onClick={handleSaveCurrentSession}
                  className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs shadow-lg shadow-cyan-950/50 transition-all shrink-0"
                >
                  SAVE AS BENCHMARK RUN
                </button>
              </div>
            )}

            {/* Saved Runs Table */}
            <div className="flex-1 min-h-0 flex flex-col rounded-xl bg-[#060a14] border border-[#1b263b] overflow-hidden">
              <div className="shrink-0 px-4 py-2.5 bg-[#090e1c] border-b border-[#1b263b] flex items-center justify-between text-xs text-slate-400 font-bold">
                <span>HISTORICAL BENCHMARK RUNS ({displayRuns.length})</span>
                <span className="text-[10px] text-slate-500">Select baseline & candidate for side-by-side comparison</span>
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto">
                {displayRuns.length === 0 ? (
                  <div className="p-12 text-center text-slate-500 text-xs space-y-1">
                    <Info className="w-8 h-8 mx-auto text-slate-600 mb-2" />
                    <p>No benchmark runs saved yet.</p>
                    <p className="text-[10px] text-slate-600">
                      Record a mission with the Flight Recorder and click "SAVE AS BENCHMARK RUN" above.
                    </p>
                  </div>
                ) : (
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-[#050811] text-slate-400 text-[10px] uppercase border-b border-[#1b263b] sticky top-0">
                      <tr>
                        <th className="py-2.5 px-3">Run Name & ID</th>
                        <th className="py-2.5 px-2">Environment</th>
                        <th className="py-2.5 px-2">Outcome</th>
                        <th className="py-2.5 px-2">Time</th>
                        <th className="py-2.5 px-2">Distance</th>
                        <th className="py-2.5 px-2">Collisions</th>
                        <th className="py-2.5 px-2">Near-Misses</th>
                        <th className="py-2.5 px-2">Min Clearance</th>
                        <th className="py-2.5 px-2">Safety Score</th>
                        <th className="py-2.5 px-2 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1b263b]/60">
                      {displayRuns.map((r) => {
                        const isBaseline = baselineRun?.id === r.id;
                        const isCandidate = candidateRun?.id === r.id;
                        return (
                          <tr
                            key={r.id}
                            data-testid={`benchmark-run-row-${r.id}`}
                            className={`hover:bg-[#0c1222] transition-colors ${
                              isBaseline
                                ? 'bg-cyan-950/30'
                                : isCandidate
                                ? 'bg-amber-950/20'
                                : ''
                            }`}
                          >
                            <td className="py-2.5 px-3">
                              <div className="font-bold text-slate-200">{r.name}</div>
                              <div className="text-[10px] text-slate-500 flex items-center space-x-1">
                                <span>{r.id}</span>
                                {r.variantTag !== 'custom' && (
                                  <span className="px-1 rounded bg-[#0b1020] text-cyan-400 text-[9px] uppercase border border-cyan-800">
                                    {r.variantTag}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="py-2.5 px-2 text-[11px] text-slate-300">
                              {r.environment}
                            </td>
                            <td className="py-2.5 px-2">
                              <span
                                className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase border ${
                                  r.result === 'COMPLETED'
                                    ? 'bg-emerald-950 text-emerald-300 border-emerald-700'
                                    : r.result === 'FAILED'
                                    ? 'bg-rose-950 text-rose-300 border-rose-700'
                                    : 'bg-slate-800 text-slate-300 border-slate-600'
                                }`}
                              >
                                {r.result}
                              </span>
                            </td>
                            <td className="py-2.5 px-2 text-cyan-300 font-bold">
                              {r.metrics.durationSeconds}s
                            </td>
                            <td className="py-2.5 px-2 text-slate-300">
                              {r.metrics.distanceTravelledMeters}m
                            </td>
                            <td className="py-2.5 px-2">
                              <span className={r.metrics.collisions > 0 ? 'text-rose-400 font-bold' : 'text-slate-400'}>
                                {r.metrics.collisions}
                              </span>
                            </td>
                            <td className="py-2.5 px-2">
                              <span className={r.metrics.nearMisses > 0 ? 'text-amber-400 font-bold' : 'text-slate-400'}>
                                {r.metrics.nearMisses}
                              </span>
                            </td>
                            <td className="py-2.5 px-2 text-slate-300">
                              {r.metrics.minClearanceRecorded !== null ? `${r.metrics.minClearanceRecorded}m` : 'N/A'}
                            </td>
                            <td className="py-2.5 px-2">
                              <span
                                className={`font-black ${
                                  r.indicators.compositeSafetyScore >= 90
                                    ? 'text-emerald-400'
                                    : r.indicators.compositeSafetyScore >= 70
                                    ? 'text-amber-400'
                                    : 'text-rose-400'
                                }`}
                              >
                                {r.indicators.compositeSafetyScore}/100
                              </span>
                            </td>
                            <td className="py-2.5 px-2 text-right space-x-1.5">
                              <button
                                data-testid={`set-baseline-btn-${r.id}`}
                                onClick={() => setSelectedBaselineId(r.id)}
                                className={`px-2 py-0.5 rounded text-[10px] border font-bold transition-all ${
                                  isBaseline
                                    ? 'bg-cyan-500 text-black border-cyan-400'
                                    : 'bg-[#0d1322] hover:bg-[#19243d] text-cyan-300 border-cyan-800'
                                }`}
                              >
                                {isBaseline ? 'BASELINE ✓' : 'SET BASELINE'}
                              </button>

                              <button
                                data-testid={`set-candidate-btn-${r.id}`}
                                onClick={() => setSelectedCandidateId(r.id)}
                                className={`px-2 py-0.5 rounded text-[10px] border font-bold transition-all ${
                                  isCandidate
                                    ? 'bg-amber-500 text-black border-amber-400'
                                    : 'bg-[#0d1322] hover:bg-[#19243d] text-amber-300 border-amber-800'
                                }`}
                              >
                                {isCandidate ? 'CANDIDATE ✓' : 'SET CANDIDATE'}
                              </button>

                              <button
                                data-testid={`ai-advise-btn-${r.id}`}
                                onClick={() => {
                                  const incs = spatialRiskService.extractIncidentsFromBenchmarkRun(r);
                                  if (incs.length > 0) {
                                    setAdvisorSelectedIncident(incs[0]);
                                  } else {
                                    setAdvisorSelectedIncident({
                                      id: `INC-RUN-${r.id}`,
                                      type: r.result === 'FAILED' ? 'COLLISION' : 'NEAR_MISS',
                                      position: [r.startPosition[0], 0.22, r.startPosition[1]],
                                      simTime: r.metrics.durationSeconds,
                                      wallTime: r.createdAt,
                                      description: `Benchmark run ${r.name} (${r.result}) recorded ${r.metrics.collisions} collisions and ${r.metrics.nearMisses} near-misses.`,
                                      minClearance: r.metrics.minClearanceRecorded,
                                      ttc: 0.8,
                                      highestRiskObstacle: 'HAZARDOUS_OBSTACLE',
                                      linearVelocity: r.metrics.maxSpeedMps || 2.0,
                                      stoppingDistance: Math.pow(r.metrics.maxSpeedMps || 2.0, 2) / (2 * 4.0),
                                      sourceRunId: r.id,
                                    });
                                  }
                                  setOpen(false);
                                  setAdvisorOpen(true);
                                }}
                                className="px-2 py-0.5 rounded text-[10px] border font-bold transition-all bg-purple-950/60 hover:bg-purple-900/80 text-purple-300 border-purple-800 flex items-center space-x-1"
                                title="Analyze this run with AI Advisor"
                              >
                                <Sparkles className="w-3 h-3 text-amber-300" />
                                <span>AI ADVISE</span>
                              </button>

                              <button
                                onClick={() => {
                                  if (confirm(`Delete run "${r.name}"?`)) {
                                    benchmarkService.deleteRun(r.id);
                                    setRefreshTrigger((prev) => prev + 1);
                                  }
                                }}
                                className="p-1 rounded hover:bg-rose-950/60 text-slate-500 hover:text-rose-400 transition-colors"
                                title="Delete run"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: Side-by-Side Run Comparison */}
        {activeTab === 'comparison' && (
          <div className="flex-1 min-h-0 flex flex-col p-4 space-y-3 overflow-y-auto">
            {/* Run Selection Selectors */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-xl bg-[#090e1c] border border-[#1b263b] text-xs">
              <div>
                <span className="text-[10px] text-cyan-400 font-bold block mb-1">BASELINE RUN [A]</span>
                <select
                  data-testid="select-baseline-dropdown"
                  value={baselineRun?.id || ''}
                  onChange={(e) => setSelectedBaselineId(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded bg-[#050811] border border-cyan-800 text-slate-100 text-xs outline-none"
                >
                  <option value="">-- Choose Baseline Run --</option>
                  {displayRuns.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} ({r.metrics.durationSeconds}s, {r.indicators.compositeSafetyScore}/100)
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <span className="text-[10px] text-amber-400 font-bold block mb-1">CANDIDATE RUN [B]</span>
                <select
                  data-testid="select-candidate-dropdown"
                  value={candidateRun?.id || ''}
                  onChange={(e) => setSelectedCandidateId(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded bg-[#050811] border border-amber-800 text-slate-100 text-xs outline-none"
                >
                  <option value="">-- Choose Candidate Run --</option>
                  {displayRuns.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} ({r.metrics.durationSeconds}s, {r.indicators.compositeSafetyScore}/100)
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Comparability Warning or Verification Banner (Requirement 2) */}
            {comparison && (
              <>
                {!comparison.comparability.isComparable ? (
                  <div
                    data-testid="comparability-warning"
                    className="p-3 rounded-lg bg-amber-950/80 border border-amber-500/80 text-amber-200 text-xs space-y-1"
                  >
                    <div className="flex items-center space-x-1.5 font-bold text-amber-300">
                      <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                      <span>NOT DIRECTLY COMPARABLE: OPERATING CONDITIONS DIFFER</span>
                    </div>
                    <p className="text-[11px] text-amber-100">
                      {comparison.comparability.mismatchReasons.join(' • ')}
                    </p>
                    <p className="text-[10px] text-amber-300/80 italic">
                      Performance claims of improvement are disabled when environments or destinations mismatch.
                    </p>
                  </div>
                ) : (
                  <div
                    data-testid="comparability-success"
                    className="p-2.5 rounded-lg bg-emerald-950/60 border border-emerald-600/60 text-emerald-200 text-xs flex items-center justify-between"
                  >
                    <div className="flex items-center space-x-1.5 font-bold text-emerald-300">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                      <span>DIRECTLY COMPARABLE: MATCHING ENVIRONMENT, DIFFICULTY & DESTINATION</span>
                    </div>
                    <span className="text-[10px] text-emerald-400 font-bold uppercase">
                      {comparison.overallVerdict.replace('_', ' ')}
                    </span>
                  </div>
                )}

                {/* Overall Verdict Banner */}
                <div
                  data-testid="overall-verdict-banner"
                  className={`p-3 rounded-xl border text-xs flex items-center space-x-3 ${
                    comparison.overallVerdict === 'SIGNIFICANT_IMPROVEMENT' || comparison.overallVerdict === 'MODERATE_IMPROVEMENT'
                      ? 'bg-emerald-950/40 border-emerald-500 text-emerald-200'
                      : comparison.overallVerdict === 'SAFETY_REGRESSION'
                      ? 'bg-rose-950/70 border-rose-500 text-rose-200 animate-pulse'
                      : comparison.overallVerdict === 'PERFORMANCE_REGRESSION'
                      ? 'bg-rose-950/40 border-rose-600 text-rose-300'
                      : 'bg-[#0a0f1d] border-[#1b263b] text-slate-300'
                  }`}
                >
                  <Award className="w-6 h-6 shrink-0" />
                  <div>
                    <div className="font-extrabold uppercase text-xs tracking-wider">
                      VERDICT: {comparison.overallVerdict.replace(/_/g, ' ')}
                    </div>
                    <div className="text-[11px] opacity-90">{comparison.summarySentence}</div>
                  </div>
                </div>

                {/* Safety Regression Remediation CTA */}
                {comparison.overallVerdict === 'SAFETY_REGRESSION' && (
                  <div className="p-3 rounded-xl bg-purple-950/40 border border-purple-600/60 flex items-center justify-between text-xs">
                    <div className="flex items-center space-x-2">
                      <Sparkles className="w-4 h-4 text-purple-400" />
                      <span className="text-purple-200">
                        Safety regression detected. The AI Optimization Advisor can analyze the causes and propose corrective parameter bounds.
                      </span>
                    </div>
                    <button
                      onClick={() => {
                        setOpen(false);
                        setAdvisorOpen(true);
                      }}
                      className="px-3 py-1 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs shrink-0 ml-3 cursor-pointer"
                    >
                      OPEN AI ADVISOR
                    </button>
                  </div>
                )}

                {/* Side-by-Side Comparison Metrics Table */}
                <div className="rounded-xl bg-[#060a14] border border-[#1b263b] overflow-hidden">
                  <div className="px-4 py-2 bg-[#090e1c] border-b border-[#1b263b] flex items-center justify-between text-xs font-bold text-slate-300">
                    <span>COMPARATIVE PERFORMANCE DELTA MATRIX</span>
                    <span className="text-[10px] text-slate-500 font-normal">
                      [MEASURED] = Ground-Truth Telemetry • [CALCULATED] = Derivative Metric
                    </span>
                  </div>

                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-[#050811] text-slate-400 text-[10px] uppercase border-b border-[#1b263b]">
                      <tr>
                        <th className="py-2.5 px-3">Metric Name</th>
                        <th className="py-2.5 px-2">Type</th>
                        <th className="py-2.5 px-2">Baseline [A]</th>
                        <th className="py-2.5 px-2">Candidate [B]</th>
                        <th className="py-2.5 px-2">Absolute Delta (Δ)</th>
                        <th className="py-2.5 px-2">% Change</th>
                        <th className="py-2.5 px-3 text-right">Performance Verdict</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1b263b]/60">
                      {Object.values(comparison.deltas).map((d) => (
                        <tr key={d.metricKey} data-testid={`delta-row-${d.metricKey}`} className="hover:bg-[#0c1222]">
                          <td className="py-2.5 px-3 font-semibold text-slate-200">
                            {d.label}
                          </td>
                          <td className="py-2.5 px-2">
                            <span
                              className={`text-[9px] px-1 py-0.2 rounded border font-bold ${
                                d.isCalculated
                                  ? 'bg-amber-950 text-amber-300 border-amber-800'
                                  : 'bg-cyan-950 text-cyan-300 border-cyan-800'
                              }`}
                            >
                              {d.isCalculated ? 'CALCULATED' : 'MEASURED'}
                            </span>
                          </td>
                          <td className="py-2.5 px-2 font-bold text-cyan-300">
                            {d.baselineValue !== null ? `${d.baselineValue}${d.unit}` : 'N/A'}
                          </td>
                          <td className="py-2.5 px-2 font-bold text-amber-300">
                            {d.candidateValue !== null ? `${d.candidateValue}${d.unit}` : 'N/A'}
                          </td>
                          <td className="py-2.5 px-2 font-mono">
                            {d.absoluteDelta !== null ? (
                              <span>
                                {d.absoluteDelta > 0 ? `+${d.absoluteDelta}` : d.absoluteDelta}
                                {d.unit}
                              </span>
                            ) : (
                              'N/A'
                            )}
                          </td>
                          <td className="py-2.5 px-2 font-mono">
                            {d.percentageChange !== null ? (
                              <span
                                className={`font-bold ${
                                  d.verdict === 'improved'
                                    ? 'text-emerald-400'
                                    : d.verdict === 'deteriorated'
                                    ? 'text-rose-400'
                                    : 'text-slate-400'
                                }`}
                              >
                                {d.percentageChange > 0 ? `+${d.percentageChange}%` : `${d.percentageChange}%`}
                              </span>
                            ) : (
                              'N/A'
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-right">
                            <span
                              className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase border ${
                                d.verdict === 'improved'
                                  ? 'bg-emerald-950 text-emerald-300 border-emerald-600'
                                  : d.verdict === 'deteriorated'
                                  ? 'bg-rose-950 text-rose-300 border-rose-600'
                                  : 'bg-slate-800 text-slate-400 border-slate-700'
                              }`}
                            >
                              {d.verdict}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Safety Score Formula Integrity Notice (Requirement 3) */}
                <div className="p-3 rounded-xl bg-[#090e1c] border border-[#1b263b] text-[11px] text-slate-400 space-y-1">
                  <div className="flex items-center space-x-1.5 font-bold text-amber-300">
                    <Info className="w-3.5 h-3.5" />
                    <span>SAFETY SCORE FORMULA (CALCULATED, NOT CERTIFIED):</span>
                  </div>
                  <p className="font-mono text-[10px] text-slate-300 bg-[#050811] p-2 rounded border border-[#1b263b]">
                    Score = clamp(100 - (Collisions × 40 + NearMisses × 10 + CriticalTTC × 5 + ClearancePenalty(&lt;0.45m: 15)), 0, 100)
                  </p>
                  <p className="text-[10px] text-slate-500">
                    * NOTICE: This composite metric is an empirical engineering heuristic designed for relative algorithm comparisons. It is NOT an official ISO/ANSI certified industrial robotics safety standard. Any candidate run producing more collisions is automatically designated as a SAFETY REGRESSION.
                  </p>
                </div>
              </>
            )}

            {!comparison && (
              <div className="p-16 text-center text-slate-500 text-xs space-y-2">
                <BarChart3 className="w-8 h-8 mx-auto text-slate-600" />
                <p className="font-bold text-slate-400">Select two distinct benchmark runs above</p>
                <p className="text-[11px] text-slate-600 max-w-md mx-auto">
                  Compare safety, clearance, stopping dynamics and completion times side-by-side with automatic delta math.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Tab 3: Benchmark Analytics & SVG Charts */}
        {activeTab === 'analytics' && (
          <div className="flex-1 min-h-0 flex flex-col p-4 space-y-4 overflow-y-auto">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Comparative Bar Chart (Pure SVG, zero dependencies) */}
              <div className="p-3.5 rounded-xl bg-[#060a14] border border-[#1b263b] space-y-2">
                <div className="flex items-center justify-between text-xs font-bold text-slate-200">
                  <span>SAFETY & DURATION COMPARISON</span>
                  <span className="text-[10px] text-slate-500">Baseline [Cyan] vs Candidate [Amber]</span>
                </div>

                {baselineRun && candidateRun ? (
                  <div className="space-y-3 pt-2 text-[11px]">
                    {/* Collisions Bar */}
                    <div>
                      <div className="flex justify-between text-[10px] text-slate-400 mb-1">
                        <span>Physical Collisions (Lower is better)</span>
                        <span>[A] {baselineRun.metrics.collisions} vs [B] {candidateRun.metrics.collisions}</span>
                      </div>
                      <div className="space-y-1">
                        <div className="h-2 rounded bg-cyan-500" style={{ width: `${Math.min(100, (baselineRun.metrics.collisions + 0.1) * 25)}%` }} />
                        <div className="h-2 rounded bg-amber-500" style={{ width: `${Math.min(100, (candidateRun.metrics.collisions + 0.1) * 25)}%` }} />
                      </div>
                    </div>

                    {/* Near Misses Bar */}
                    <div>
                      <div className="flex justify-between text-[10px] text-slate-400 mb-1">
                        <span>Near-Miss Incidents (Lower is better)</span>
                        <span>[A] {baselineRun.metrics.nearMisses} vs [B] {candidateRun.metrics.nearMisses}</span>
                      </div>
                      <div className="space-y-1">
                        <div className="h-2 rounded bg-cyan-500" style={{ width: `${Math.min(100, (baselineRun.metrics.nearMisses + 0.1) * 15)}%` }} />
                        <div className="h-2 rounded bg-amber-500" style={{ width: `${Math.min(100, (candidateRun.metrics.nearMisses + 0.1) * 15)}%` }} />
                      </div>
                    </div>

                    {/* Minimum Clearance Bar */}
                    <div>
                      <div className="flex justify-between text-[10px] text-slate-400 mb-1">
                        <span>Min Clearance (Higher is better)</span>
                        <span>[A] {baselineRun.metrics.minClearanceRecorded || 0}m vs [B] {candidateRun.metrics.minClearanceRecorded || 0}m</span>
                      </div>
                      <div className="space-y-1">
                        <div className="h-2 rounded bg-cyan-500" style={{ width: `${Math.min(100, (baselineRun.metrics.minClearanceRecorded || 0) * 50)}%` }} />
                        <div className="h-2 rounded bg-amber-500" style={{ width: `${Math.min(100, (candidateRun.metrics.minClearanceRecorded || 0) * 50)}%` }} />
                      </div>
                    </div>

                    {/* Duration Bar */}
                    <div>
                      <div className="flex justify-between text-[10px] text-slate-400 mb-1">
                        <span>Mission Duration</span>
                        <span>[A] {baselineRun.metrics.durationSeconds}s vs [B] {candidateRun.metrics.durationSeconds}s</span>
                      </div>
                      <div className="space-y-1">
                        <div className="h-2 rounded bg-cyan-500" style={{ width: `${Math.min(100, (baselineRun.metrics.durationSeconds / 40) * 100)}%` }} />
                        <div className="h-2 rounded bg-amber-500" style={{ width: `${Math.min(100, (candidateRun.metrics.durationSeconds / 40) * 100)}%` }} />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="p-8 text-center text-slate-500 text-xs">
                    Select two runs in the Comparison tab to view comparative metrics.
                  </div>
                )}
              </div>

              {/* Historical Trend Chart across Chronological Runs */}
              <div className="p-3.5 rounded-xl bg-[#060a14] border border-[#1b263b] space-y-2">
                <div className="flex items-center justify-between text-xs font-bold text-slate-200">
                  <span>HISTORICAL PERFORMANCE TRENDS</span>
                  <span className="text-[10px] text-emerald-400">Safety Score (0 - 100)</span>
                </div>

                <div className="h-44 flex items-end space-x-2 pt-4 px-2 border-b border-[#1b263b]">
                  {displayRuns.slice(0, 10).reverse().map((r, i) => {
                    const heightPercent = r.indicators.compositeSafetyScore;
                    return (
                      <div key={r.id} className="flex-1 flex flex-col items-center gap-1 group relative">
                        <span className="text-[8px] text-slate-500 truncate w-full text-center">
                          {r.indicators.compositeSafetyScore}
                        </span>
                        <div
                          className={`w-full rounded-t transition-all ${
                            r.indicators.compositeSafetyScore >= 90
                              ? 'bg-emerald-500'
                              : r.indicators.compositeSafetyScore >= 70
                              ? 'bg-amber-500'
                              : 'bg-rose-500'
                          }`}
                          style={{ height: `${heightPercent}%` }}
                        />
                        <span className="text-[8px] text-slate-500">#{i + 1}</span>
                      </div>
                    );
                  })}
                </div>
                <div className="flex justify-between text-[9px] text-slate-500 px-2 pt-1">
                  <span>Earliest Runs</span>
                  <span>Latest Runs</span>
                </div>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};
