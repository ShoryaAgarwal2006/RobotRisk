import React, { useState, useMemo, useEffect } from 'react';
import {
  Sparkles,
  X,
  AlertTriangle,
  ShieldAlert,
  CheckCircle2,
  RotateCcw,
  Play,
  ArrowRight,
  Cpu,
  Award,
  Check,
} from 'lucide-react';
import { useSimulationStore } from '../state/useSimulationStore';
import {
  failureAnalysisService,
  FailureAnalysisReport,
} from '../services/failureAnalysisService';
import { spatialRiskService, SpatialIncident } from '../services/spatialRiskService';
import { flightRecorderService } from '../services/flightRecorder';
import { benchmarkService } from '../services/benchmarkService';

interface FailureAdvisorModalProps {
  forceOpen?: boolean;
}

export const FailureAdvisorModal: React.FC<FailureAdvisorModalProps> = ({ forceOpen }) => {
  const storeOpen = useSimulationStore((s) => s.isAdvisorOpen);
  const setOpen = useSimulationStore((s) => s.setAdvisorOpen);
  const robotConfig = useSimulationStore((s) => s.robotConfig);
  const navigationPreference = useSimulationStore((s) => s.navigationPreference);
  const setNavigationPreference = useSimulationStore((s) => s.setNavigationPreference);
  const updateRobotConfig = useSimulationStore((s) => s.updateRobotConfig);
  const rollbackRobotConfig = useSimulationStore((s) => s.rollbackRobotConfig);
  const configHistory = useSimulationStore((s) => s.configHistory);
  const baselineConfig = useSimulationStore((s) => s.baselineConfig);
  const activeScenarioSnapshot = useSimulationStore((s) => s.activeScenarioSnapshot);
  const saveScenarioSnapshot = useSimulationStore((s) => s.saveScenarioSnapshot);
  const rerunSameScenario = useSimulationStore((s) => s.rerunSameScenario);
  const setBenchmarkCenterOpen = useSimulationStore((s) => s.setBenchmarkCenterOpen);
  const selectedIncidentFromStore = useSimulationStore((s) => s.advisorSelectedIncident);
  const setSelectedIncidentInStore = useSimulationStore((s) => s.setAdvisorSelectedIncident);

  const isOpen = forceOpen !== undefined ? forceOpen : storeOpen;

  // Active workflow stage: 'select' | 'analyze' | 'recommendations' | 'rerun' | 'compare'
  const [activeTab, setActiveTab] = useState<'select' | 'analyze' | 'recommendations' | 'rerun' | 'compare'>('select');

  // Selected incident
  const [selectedIncident, setSelectedIncident] = useState<SpatialIncident | null>(null);

  // Analysis report state
  const [analysisReport, setAnalysisReport] = useState<FailureAnalysisReport | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [recommendationStates, setRecommendationStates] = useState<Record<string, 'APPROVED' | 'REJECTED' | 'PENDING'>>({});
  const [appliedSuccessMsg, setAppliedSuccessMsg] = useState<string | null>(null);

  // Retrieve incidents from active Flight Recording sessions and Benchmark history
  const allFlightSessions = flightRecorderService.getAllSessions();
  const benchmarkRuns = benchmarkService.getAllRuns();

  const availableIncidents: SpatialIncident[] = useMemo(() => {
    const list: SpatialIncident[] = [];
    for (const sess of allFlightSessions) {
      list.push(...spatialRiskService.extractIncidentsFromSession(sess));
    }
    for (const run of benchmarkRuns) {
      list.push(...spatialRiskService.extractIncidentsFromBenchmarkRun(run));
    }
    // De-duplicate by id
    const seen = new Set<string>();
    return list.filter((i) => {
      if (seen.has(i.id)) return false;
      seen.add(i.id);
      return true;
    });
  }, [allFlightSessions.length, benchmarkRuns.length]);

  // Sync with store selection
  useEffect(() => {
    if (selectedIncidentFromStore) {
      setSelectedIncident(selectedIncidentFromStore);
      setActiveTab('analyze');
      runAnalysis(selectedIncidentFromStore);
    } else if (availableIncidents.length > 0 && !selectedIncident) {
      setSelectedIncident(availableIncidents[0]);
    }
  }, [selectedIncidentFromStore, availableIncidents.length]);

  if (!isOpen) return null;

  const runAnalysis = async (inc: SpatialIncident) => {
    setIsAnalyzing(true);
    setAppliedSuccessMsg(null);
    try {
      const report = await failureAnalysisService.analyzeFailure(
        inc,
        robotConfig,
        navigationPreference
      );
      setAnalysisReport(report);
      // Initialize recommendation states
      const states: Record<string, 'APPROVED' | 'REJECTED' | 'PENDING'> = {};
      for (const rec of report.recommendations) {
        states[rec.id] = 'PENDING';
      }
      setRecommendationStates(states);
    } catch (err) {
      console.error('Failed to run failure analysis:', err);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleSelectIncident = (inc: SpatialIncident) => {
    setSelectedIncident(inc);
    setSelectedIncidentInStore(inc);
    setActiveTab('analyze');
    runAnalysis(inc);
  };

  const handleApproveRec = (recId: string) => {
    setRecommendationStates((prev) => ({ ...prev, [recId]: 'APPROVED' }));
  };

  const handleRejectRec = (recId: string) => {
    setRecommendationStates((prev) => ({ ...prev, [recId]: 'REJECTED' }));
  };

  const handleApplyApproved = () => {
    if (!analysisReport) return;

    // Save baseline snapshot if not already saved
    if (!activeScenarioSnapshot) {
      saveScenarioSnapshot();
    }

    const appliedKeys: string[] = [];

    for (const rec of analysisReport.recommendations) {
      if (recommendationStates[rec.id] === 'APPROVED' && !rec.isHardwareAdvisory) {
        for (const change of rec.proposedChanges) {
          const valRes = failureAnalysisService.validateParameter(
            change.parameterKey,
            change.proposedValue
          );

          if (valRes.valid) {
            if (change.parameterKey === 'navigationPreference') {
              setNavigationPreference(valRes.clampedValue);
              appliedKeys.push(`Navigation Preference -> ${valRes.clampedValue}`);
            } else {
              updateRobotConfig({ [change.parameterKey]: valRes.clampedValue });
              appliedKeys.push(`${change.label} -> ${valRes.clampedValue}${change.unit || ''}`);
            }
          }
        }
      }
    }

    if (appliedKeys.length > 0) {
      setAppliedSuccessMsg(`Successfully applied ${appliedKeys.length} parameter optimization(s): ${appliedKeys.join(', ')}.`);
      setActiveTab('rerun');
    } else {
      alert('Please approve at least one software recommendation before applying changes.');
    }
  };

  const handleRerun = () => {
    setOpen(false);
    rerunSameScenario();
  };

  return (
    <div
      data-testid="failure-advisor-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/85 backdrop-blur-md select-none font-mono"
    >
      <div className="relative w-full max-w-[1320px] h-[90vh] flex flex-col bg-[#070b16] border border-[#1e2942] rounded-2xl shadow-2xl shadow-cyan-950/40 overflow-hidden text-slate-200">
        
        {/* 1. Modal Header Bar */}
        <div className="shrink-0 flex items-center justify-between px-6 py-3 border-b border-[#1b263b] bg-[#090e1c]">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-lg bg-gradient-to-br from-cyan-500/20 via-blue-500/20 to-purple-500/20 border border-cyan-500/40 text-cyan-400">
              <Sparkles className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-base font-extrabold tracking-wider bg-gradient-to-r from-cyan-400 via-teal-300 to-purple-400 bg-clip-text text-transparent uppercase">
                  AI Failure Analysis & Optimization Advisor
                </h2>
                <span className="text-[10px] px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800 font-bold">
                  PHASE 5.4 CORE
                </span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700 hidden sm:inline">
                  HUMAN-IN-THE-LOOP APPROVAL
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Ground-truth physics failure analysis, actionable software tuning, scenario reproduction & benchmark verification.
              </p>
            </div>
          </div>

          <button
            data-testid="close-advisor-modal"
            onClick={() => setOpen(false)}
            className="p-1.5 rounded-lg hover:bg-slate-800/80 text-slate-400 hover:text-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 2. End-to-End Workflow Navigation Tabs */}
        <div className="shrink-0 flex items-center justify-between px-6 py-2.5 bg-[#0a1020] border-b border-[#1b263b] text-xs">
          <div className="flex items-center space-x-2 overflow-x-auto">
            {[
              { key: 'select', label: '1. SELECT INCIDENT', count: availableIncidents.length },
              { key: 'analyze', label: '2. FAILURE ANALYSIS', disabled: !selectedIncident },
              { key: 'recommendations', label: '3. RECOMMENDATIONS', disabled: !analysisReport },
              { key: 'rerun', label: '4. RERUN SCENARIO', disabled: !activeScenarioSnapshot },
              { key: 'compare', label: '5. BENCHMARK COMPARISON', disabled: benchmarkRuns.length < 2 },
            ].map((tab) => (
              <button
                key={tab.key}
                disabled={tab.disabled}
                onClick={() => setActiveTab(tab.key as any)}
                className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg border text-xs font-bold transition-all shrink-0 ${
                  activeTab === tab.key
                    ? 'bg-cyan-950 text-cyan-300 border-cyan-500 shadow-md shadow-cyan-900/30'
                    : tab.disabled
                    ? 'opacity-40 cursor-not-allowed border-transparent text-slate-500'
                    : 'bg-[#060a14] hover:bg-[#101728] text-slate-400 hover:text-slate-200 border-[#1e2942]'
                }`}
              >
                <span>{tab.label}</span>
                {tab.count !== undefined && (
                  <span className="text-[10px] px-1 py-0.2 rounded bg-slate-800 text-slate-300 ml-1">
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Active Configuration Version Badge & Rollback Action */}
          <div className="flex items-center space-x-2">
            <div className="text-[11px] text-slate-400 hidden lg:flex items-center space-x-1">
              <span>CONFIG:</span>
              <span className="text-cyan-300 font-bold">{robotConfig.maxLinearSpeed} m/s</span>
              <span>/</span>
              <span className="text-cyan-300 font-bold">{robotConfig.linearAcceleration} m/s²</span>
            </div>

            {baselineConfig && (
              <div>
                <span className="text-slate-500 text-[10px]">BASELINE: </span>
                <span className="text-slate-300 font-bold">{baselineConfig.maxLinearSpeed} m/s</span>
              </div>
            )}

            {configHistory.length > 0 && (
              <button
                data-testid="rollback-config-button"
                onClick={rollbackRobotConfig}
                className="flex items-center space-x-1 px-2.5 py-1 rounded bg-[#0e1629] hover:bg-amber-950/60 text-amber-300 border border-amber-800/60 text-[11px] font-bold transition-colors"
                title="Rollback configuration to previous baseline"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>ROLLBACK BASELINE</span>
              </button>
            )}
          </div>
        </div>

        {/* 3. Main Workspace Area */}
        <div className="flex-1 p-6 overflow-y-auto bg-[#04060c]">
          
          {/* TAB 1: SELECT INCIDENT */}
          {activeTab === 'select' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-slate-200 text-sm">SELECT RECORDED INCIDENT FOR AI ROOT-CAUSE AUDIT</h3>
                  <p className="text-xs text-slate-400">Choose a collision, near-miss, or emergency braking event captured by Flight Recorder.</p>
                </div>
                <span className="text-xs text-cyan-400 font-bold">{availableIncidents.length} Incident(s) Recorded</span>
              </div>

              {availableIncidents.length === 0 ? (
                <div className="p-8 rounded-xl bg-[#070b16] border border-[#1e2942] text-center space-y-2 text-slate-500 text-xs">
                  <ShieldAlert className="w-8 h-8 mx-auto text-emerald-400 opacity-60" />
                  <p className="text-sm font-bold text-slate-300">NO INCIDENTS RECORDED IN ACTIVE TELEMETRY.</p>
                  <p>Run an autonomous mission or spawn dynamic obstacles to observe failure modes and generate telemetry.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {availableIncidents.map((inc) => {
                    const isSelected = selectedIncident?.id === inc.id;
                    const badgeColor = inc.type === 'COLLISION'
                      ? 'bg-rose-950 text-rose-300 border-rose-600'
                      : inc.type === 'NEAR_MISS'
                      ? 'bg-amber-950 text-amber-300 border-amber-600'
                      : 'bg-purple-950 text-purple-300 border-purple-600';

                    return (
                      <div
                        key={inc.id}
                        onClick={() => handleSelectIncident(inc)}
                        className={`p-4 rounded-xl border cursor-pointer transition-all space-y-2.5 ${
                          isSelected
                            ? 'bg-cyan-950/40 border-cyan-500 shadow-lg shadow-cyan-950/40'
                            : 'bg-[#070b16] hover:bg-[#0c1224] border-[#1e2942]'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${badgeColor}`}>
                            {inc.type}
                          </span>
                          <span className="text-[10px] text-slate-400 font-bold">t = {inc.simTime.toFixed(1)}s</span>
                        </div>

                        <div>
                          <span className="text-xs font-bold text-slate-200 block truncate">{inc.description}</span>
                          <span className="text-[10px] text-slate-400">Threat: {inc.highestRiskObstacle || 'Corridor Obstacle'}</span>
                        </div>

                        <div className="grid grid-cols-2 gap-1.5 pt-2 border-t border-[#1e2942] text-[10px]">
                          <div>
                            <span className="text-slate-500 block">Speed:</span>
                            <span className="font-bold text-slate-200">
                              {inc.linearVelocity !== null ? `${inc.linearVelocity.toFixed(2)} m/s` : 'N/A'}
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-500 block">Clearance:</span>
                            <span className="font-bold text-amber-400">
                              {inc.minClearance !== null ? `${inc.minClearance.toFixed(2)} m` : 'N/A'}
                            </span>
                          </div>
                        </div>

                        <button className="w-full mt-2 py-1.5 px-3 rounded bg-cyan-950/80 hover:bg-cyan-900/80 text-cyan-300 border border-cyan-700/60 text-xs font-bold flex items-center justify-center space-x-1">
                          <span>ANALYZE WITH AI</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: FAILURE ANALYSIS */}
          {activeTab === 'analyze' && (
            <div className="space-y-4">
              {isAnalyzing ? (
                <div className="p-12 text-center space-y-3">
                  <Sparkles className="w-8 h-8 mx-auto text-cyan-400 animate-spin" />
                  <p className="text-sm font-bold text-slate-200">EXTRACTING FLIGHT TELEMETRY & RUNNING PHYSICS AUDIT...</p>
                  <p className="text-xs text-slate-400">Auditing stopping distances, kinetic momentum, obstacle clearances, and spatial risk layers.</p>
                </div>
              ) : analysisReport ? (
                <div className="space-y-4">
                  {/* Analysis Header Card */}
                  <div className="p-4 rounded-xl bg-[#070b16] border border-cyan-800/40 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <ShieldAlert className="w-4 h-4 text-cyan-400" />
                        <span className="text-xs text-slate-400 font-bold uppercase">PRIMARY FAILURE MODE:</span>
                        <span className="text-xs font-bold text-rose-400 px-2 py-0.5 rounded bg-rose-950 border border-rose-800">
                          {analysisReport.primaryFailureMode}
                        </span>
                      </div>
                      <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                        {analysisReport.isDeterministicFallback ? 'DETERMINISTIC PHYSICS ENGINE' : 'FASTAPI ADVISOR CORE'}
                      </span>
                    </div>

                    <p className="text-xs text-slate-300 leading-relaxed font-semibold">
                      {analysisReport.summaryExplanation}
                    </p>
                  </div>

                  {/* Contributing Factors & Hypotheses */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-4 rounded-xl bg-[#070b16] border border-[#1e2942] space-y-2">
                      <span className="text-xs font-bold text-amber-400 flex items-center space-x-1.5">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        <span>CONTRIBUTING FACTORS</span>
                      </span>
                      <ul className="space-y-1.5 text-xs text-slate-300">
                        {analysisReport.contributingFactors.map((f, i) => (
                          <li key={i} className="flex items-start space-x-2">
                            <span className="text-cyan-400 font-bold">•</span>
                            <span>{f}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="p-4 rounded-xl bg-[#070b16] border border-[#1e2942] space-y-2">
                      <span className="text-xs font-bold text-purple-400 flex items-center space-x-1.5">
                        <Cpu className="w-3.5 h-3.5" />
                        <span>AI HYPOTHESIZED CAUSES</span>
                      </span>
                      <ul className="space-y-1.5 text-xs text-slate-300">
                        {analysisReport.hypothesizedCauses.map((h, i) => (
                          <li key={i} className="flex items-start space-x-2">
                            <span className="text-purple-400 font-bold">•</span>
                            <span>{h}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  {/* Measured Evidence Grid (Ground Truth) */}
                  <div className="p-4 rounded-xl bg-[#070b16] border border-[#1e2942] space-y-3">
                    <span className="text-xs font-bold text-slate-200 flex items-center space-x-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                      <span>MEASURED FLIGHT TELEMETRY EVIDENCE (NO VALUE INVENTED)</span>
                    </span>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
                      {analysisReport.measuredEvidence.map((ev, i) => (
                        <div key={i} className="p-3 rounded-lg bg-[#04060c] border border-[#1e2942] space-y-1">
                          <span className="text-[10px] text-slate-400 block truncate">{ev.metricName}</span>
                          <span className="text-sm font-black text-cyan-300 block">{ev.measuredValue}</span>
                          <span className="text-[10px] text-slate-500 block truncate">{ev.thresholdOrBaseline}</span>
                          <span className="text-[9px] font-bold text-slate-400 px-1 py-0.2 rounded bg-slate-800/80 inline-block mt-1">
                            {ev.evidenceType}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Action Bar */}
                  <div className="flex items-center justify-between pt-2">
                    <button
                      onClick={() => setActiveTab('select')}
                      className="px-4 py-2 rounded-lg bg-[#0e1629] text-slate-300 border border-[#1e2942] text-xs font-bold"
                    >
                      ← SELECT DIFFERENT INCIDENT
                    </button>
                    <button
                      onClick={() => setActiveTab('recommendations')}
                      className="px-5 py-2 rounded-lg bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white text-xs font-bold shadow-lg shadow-cyan-600/30 flex items-center space-x-1.5"
                    >
                      <span>VIEW ACTIONABLE RECOMMENDATIONS</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          )}

          {/* TAB 3: RECOMMENDATIONS & HUMAN APPROVAL */}
          {activeTab === 'recommendations' && analysisReport && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-slate-200 text-sm">PROPOSED OPTIMIZATION RECOMMENDATIONS</h3>
                  <p className="text-xs text-slate-400">Review problem statements, supporting evidence, proposed values, and expected trade-offs.</p>
                </div>
                <span className="text-xs text-amber-400 font-bold">HUMAN APPROVAL MANDATORY</span>
              </div>

              {appliedSuccessMsg && (
                <div className="p-3 rounded-lg bg-emerald-950/80 border border-emerald-500 text-emerald-300 text-xs font-bold flex items-center space-x-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>{appliedSuccessMsg}</span>
                </div>
              )}

              <div className="space-y-3">
                {analysisReport.recommendations.map((rec) => {
                  const state = recommendationStates[rec.id] || 'PENDING';
                  const isApproved = state === 'APPROVED';
                  const isRejected = state === 'REJECTED';

                  return (
                    <div
                      key={rec.id}
                      className={`p-4 rounded-xl border space-y-3 transition-all ${
                        isApproved
                          ? 'bg-emerald-950/30 border-emerald-500/80'
                          : isRejected
                          ? 'bg-rose-950/20 border-rose-900/60 opacity-60'
                          : 'bg-[#070b16] border-[#1e2942]'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
                            rec.isHardwareAdvisory
                              ? 'bg-purple-950 text-purple-300 border-purple-700'
                              : 'bg-cyan-950 text-cyan-300 border-cyan-700'
                          }`}>
                            {rec.category}
                          </span>
                          <h4 className="text-xs font-bold text-slate-200">{rec.title}</h4>
                        </div>

                        {rec.isHardwareAdvisory ? (
                          <span className="text-[10px] text-amber-400 font-bold px-2 py-0.5 rounded bg-amber-950/60 border border-amber-800">
                            ADVISORY ONLY
                          </span>
                        ) : (
                          <div className="flex items-center space-x-2">
                            <button
                              onClick={() => handleApproveRec(rec.id)}
                              className={`flex items-center space-x-1 px-3 py-1 rounded text-xs font-bold border transition-colors ${
                                isApproved
                                  ? 'bg-emerald-600 text-white border-emerald-400'
                                  : 'bg-[#050811] hover:bg-emerald-950 text-emerald-300 border-emerald-800/60'
                              }`}
                            >
                              <Check className="w-3.5 h-3.5" />
                              <span>APPROVE</span>
                            </button>
                            <button
                              onClick={() => handleRejectRec(rec.id)}
                              className={`flex items-center space-x-1 px-3 py-1 rounded text-xs font-bold border transition-colors ${
                                isRejected
                                  ? 'bg-rose-600 text-white border-rose-400'
                                  : 'bg-[#050811] hover:bg-rose-950 text-rose-300 border-rose-800/60'
                              }`}
                            >
                              <X className="w-3.5 h-3.5" />
                              <span>REJECT</span>
                            </button>
                          </div>
                        )}
                      </div>

                      <p className="text-xs text-slate-300">{rec.problemExplanation}</p>

                      {/* Side-by-Side Parameter Comparison */}
                      {rec.proposedChanges.length > 0 && (
                        <div className="p-3 rounded-lg bg-[#04060c] border border-[#1e2942] grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                          {rec.proposedChanges.map((ch, idx) => (
                            <div key={idx} className="flex items-center justify-between">
                              <span className="text-slate-400">{ch.label}:</span>
                              <div className="flex items-center space-x-2 font-bold">
                                <span className="text-rose-400">{ch.currentValue} {ch.unit || ''}</span>
                                <ArrowRight className="w-3.5 h-3.5 text-slate-500" />
                                <span className="text-emerald-400">{ch.proposedValue} {ch.unit || ''}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Benefits & Trade-offs */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[11px] pt-1 border-t border-[#1e2942]/60">
                        <div>
                          <span className="text-emerald-400 font-bold block">EXPECTED BENEFIT:</span>
                          <span className="text-slate-300">{rec.expectedBenefit}</span>
                        </div>
                        <div>
                          <span className="text-amber-400 font-bold block">POTENTIAL TRADE-OFFS:</span>
                          <span className="text-slate-300">{rec.potentialTradeoffs}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Approval Action Bar */}
              <div className="flex items-center justify-between pt-3 border-t border-[#1e2942]">
                <button
                  onClick={() => setActiveTab('analyze')}
                  className="px-4 py-2 rounded-lg bg-[#0e1629] text-slate-300 border border-[#1e2942] text-xs font-bold"
                >
                  ← BACK TO ANALYSIS
                </button>

                <button
                  data-testid="apply-approved-button"
                  onClick={handleApplyApproved}
                  className="px-6 py-2.5 rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold shadow-lg shadow-emerald-950 flex items-center space-x-2"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>APPLY APPROVED SOFTWARE CHANGES</span>
                </button>
              </div>
            </div>
          )}

          {/* TAB 4: RERUN SAME SCENARIO */}
          {activeTab === 'rerun' && (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-cyan-950/30 border border-cyan-700/60 space-y-2">
                <h3 className="font-bold text-cyan-300 text-sm flex items-center space-x-2">
                  <Play className="w-4 h-4 text-cyan-400 fill-current" />
                  <span>READY TO RERUN SAME SCENARIO</span>
                </h3>
                <p className="text-xs text-slate-300">
                  The approved candidate configuration has been applied. The robot will restart from the exact same starting position, environment, and obstacles to verify if the failure is mitigated.
                </p>
              </div>

              {activeScenarioSnapshot && (
                <div className="p-4 rounded-xl bg-[#070b16] border border-[#1e2942] space-y-3 text-xs">
                  <span className="font-bold text-slate-200 block border-b border-[#1b263b] pb-2">
                    SCENARIO PRESERVATION AUDIT (EXACT REPRODUCTION PROTOCOL)
                  </span>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-[11px]">
                    <div>
                      <span className="text-slate-500 block">Environment:</span>
                      <span className="font-bold text-slate-200">{activeScenarioSnapshot.environmentName}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Destination:</span>
                      <span className="font-bold text-cyan-300">{activeScenarioSnapshot.destinationName}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Barriers & Hazards:</span>
                      <span className="font-bold text-slate-200">
                        {activeScenarioSnapshot.activeBarriers.length} barriers, {activeScenarioSnapshot.interactiveObjects.length} hazards
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Start Position:</span>
                      <span className="font-bold text-slate-200">
                        [{activeScenarioSnapshot.startPosition[0].toFixed(1)}, {activeScenarioSnapshot.startPosition[2].toFixed(1)}]
                      </span>
                    </div>
                  </div>

                  <div className="p-3 rounded-lg bg-[#04060c] border border-cyan-900/60 flex items-center justify-between text-xs font-bold">
                    <span className="text-slate-400">Baseline Speed vs Candidate Speed:</span>
                    <span>
                      <span className="text-rose-400">{activeScenarioSnapshot.baselineConfig.maxLinearSpeed} m/s</span>
                      <span className="text-slate-500 mx-2">→</span>
                      <span className="text-emerald-400">{robotConfig.maxLinearSpeed} m/s</span>
                    </span>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between pt-4">
                <button
                  onClick={() => setActiveTab('recommendations')}
                  className="px-4 py-2 rounded-lg bg-[#0e1629] text-slate-300 border border-[#1e2942] text-xs font-bold"
                >
                  ← BACK TO RECOMMENDATIONS
                </button>

                <button
                  data-testid="rerun-scenario-button"
                  onClick={handleRerun}
                  className="px-6 py-3 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-extrabold text-xs shadow-lg shadow-cyan-600/30 flex items-center space-x-2"
                >
                  <Play className="w-4 h-4 fill-current" />
                  <span>RERUN SCENARIO WITH CANDIDATE CONFIG</span>
                </button>
              </div>
            </div>
          )}

          {/* TAB 5: BENCHMARK COMPARISON */}
          {activeTab === 'compare' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-slate-200 text-sm">BEFORE & AFTER BENCHMARK VERIFICATION</h3>
                  <p className="text-xs text-slate-400">Directly inspect measured deltas between the baseline run and the candidate optimized run.</p>
                </div>
                <button
                  onClick={() => {
                    setOpen(false);
                    setBenchmarkCenterOpen(true);
                  }}
                  className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-amber-950 text-amber-300 border border-amber-600 text-xs font-bold"
                >
                  <Award className="w-3.5 h-3.5" />
                  <span>OPEN IN BENCHMARK CENTER</span>
                </button>
              </div>

              {benchmarkRuns.length >= 2 ? (
                <div className="p-4 rounded-xl bg-[#070b16] border border-[#1e2942] space-y-3">
                  <div className="grid grid-cols-2 gap-4 text-xs font-bold border-b border-[#1b263b] pb-2">
                    <span className="text-cyan-400">BASELINE: {benchmarkRuns[0].name}</span>
                    <span className="text-emerald-400">CANDIDATE: {benchmarkRuns[1].name}</span>
                  </div>

                  <div className="space-y-2 text-xs">
                    <div className="flex items-center justify-between p-2 rounded bg-[#04060c]">
                      <span className="text-slate-400">Collisions:</span>
                      <div>
                        <span className="text-rose-400 font-bold">{benchmarkRuns[0].metrics.collisions}</span>
                        <span className="text-slate-500 mx-2">vs</span>
                        <span className="text-emerald-400 font-bold">{benchmarkRuns[1].metrics.collisions}</span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between p-2 rounded bg-[#04060c]">
                      <span className="text-slate-400">Near-Misses:</span>
                      <div>
                        <span className="text-amber-400 font-bold">{benchmarkRuns[0].metrics.nearMisses}</span>
                        <span className="text-slate-500 mx-2">vs</span>
                        <span className="text-emerald-400 font-bold">{benchmarkRuns[1].metrics.nearMisses}</span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between p-2 rounded bg-[#04060c]">
                      <span className="text-slate-400">Min Obstacle Clearance:</span>
                      <div>
                        <span className="text-slate-200 font-bold">{benchmarkRuns[0].metrics.minClearanceRecorded ?? 'N/A'} m</span>
                        <span className="text-slate-500 mx-2">vs</span>
                        <span className="text-emerald-400 font-bold">{benchmarkRuns[1].metrics.minClearanceRecorded ?? 'N/A'} m</span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between p-2 rounded bg-[#04060c]">
                      <span className="text-slate-400">Mission Duration:</span>
                      <div>
                        <span className="text-slate-200 font-bold">{benchmarkRuns[0].metrics.durationSeconds}s</span>
                        <span className="text-slate-500 mx-2">vs</span>
                        <span className="text-slate-200 font-bold">{benchmarkRuns[1].metrics.durationSeconds}s</span>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-8 rounded-xl bg-[#070b16] border border-[#1e2942] text-center space-y-2 text-slate-500 text-xs">
                  <p>At least two benchmark runs are required for side-by-side comparison.</p>
                  <p>Complete the rerun scenario to produce the candidate run.</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
