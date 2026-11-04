import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  Bot,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Play,
  RotateCcw,
  Save,
  Trash2,
  Download,
  Upload,
  Layers,
  ShieldAlert,
  Cpu,
  User,
  Sliders,
  X,
  RefreshCw,
} from 'lucide-react';
import { useSimulationStore } from '../state/useSimulationStore';
import {
  GeneratedScenario,
  ScenarioValidationResult,
  ScenarioDifficulty,
} from '../types/scenario';
import { generateScenario, validateScenario } from '../services/scenarioApi';
import { scenarioStorageService, StoredScenarioRecord } from '../services/scenarioStorageService';

const SUGGESTED_PROMPTS = [
  {
    title: 'Dual Forklifts High Speed',
    prompt: 'Two heavy industrial forklifts patrolling Corridor 2 at 1.8 m/s with opposite patrol headings.',
    corridor: 'aisle-2',
    difficulty: 'hard' as ScenarioDifficulty,
  },
  {
    title: 'Blind Corner Encounter',
    prompt: 'Worker stepping out of aisle 1 crosswalk while AMR turns the corner with a static tote pile blocking clearance.',
    corridor: 'aisle-1',
    difficulty: 'hard' as ScenarioDifficulty,
  },
  {
    title: 'Crowded Warehouse Congestion',
    prompt: 'Multiple workers and forklifts crossing central corridor creating dynamic bottlenecks.',
    corridor: 'aisle-2',
    difficulty: 'extreme' as ScenarioDifficulty,
  },
  {
    title: 'Blocked Corridor Reroute',
    prompt: 'Emergency safety barrier blocking Corridor 2, forcing AMR to reroute through Corridor 3.',
    corridor: 'aisle-2',
    difficulty: 'normal' as ScenarioDifficulty,
  },
  {
    title: 'Head-on Forklift Impasse',
    prompt: 'Forklift driving directly towards robot starting point in Corridor 1 at 1.4 m/s.',
    corridor: 'aisle-1',
    difficulty: 'extreme' as ScenarioDifficulty,
  },
];

export const ScenarioGeneratorModal: React.FC = () => {
  const isOpen = useSimulationStore((s) => s.isScenarioGeneratorOpen);
  const setOpen = useSimulationStore((s) => s.setScenarioGeneratorOpen);
  const isMultiplayerActive = useSimulationStore((s) => s.isMultiplayerActive);
  const isRecordingFlightData = useSimulationStore((s) => s.isRecordingFlightData);
  const stagingStatus = useSimulationStore((s) => s.stagingStatus);
  const stagingError = useSimulationStore((s) => s.stagingError);
  const applyScenario = useSimulationStore((s) => s.applyScenario);

  // Input states
  const [prompt, setPrompt] = useState('');
  const [preferredCorridor, setPreferredCorridor] = useState<string>('aisle-2');
  const [difficulty, setDifficulty] = useState<ScenarioDifficulty>('normal');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  // Generated scenario & validation state
  const [activeScenario, setActiveScenario] = useState<GeneratedScenario | null>(null);
  const [validationResult, setValidationResult] = useState<ScenarioValidationResult | null>(null);
  const [autoLaunch, setAutoLaunch] = useState(true);

  // Storage states
  const [savedScenarios, setSavedScenarios] = useState<StoredScenarioRecord[]>([]);
  const [selectedSavedId, setSelectedSavedId] = useState<string>('');
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);

  // Load saved scenarios on mount or when modal opens
  useEffect(() => {
    if (isOpen) {
      refreshSavedScenarios();
    }
  }, [isOpen]);

  const refreshSavedScenarios = () => {
    const list = scenarioStorageService.listScenarios();
    setSavedScenarios(list);
  };

  const handleGenerate = async (
    overridePrompt?: string,
    overrideCorridor?: string,
    overrideDifficulty?: ScenarioDifficulty
  ) => {
    const p = (overridePrompt !== undefined ? overridePrompt : prompt).trim();
    const c = overrideCorridor !== undefined ? overrideCorridor : preferredCorridor;
    const d = overrideDifficulty !== undefined ? overrideDifficulty : difficulty;
    if (!p) return;

    setIsGenerating(true);
    setGenerateError(null);
    setSaveSuccessMsg(null);
    console.log('[SCENARIO_DEBUG] Initiating scenario generation:', { prompt: p, corridor: c, difficulty: d });

    try {
      const response = await generateScenario({
        prompt: p,
        preferred_corridor: c || undefined,
        difficulty: d,
      });

      console.log('[SCENARIO_DEBUG] Scenario generated successfully:', {
        scenario_id: response.scenario.scenario_id,
        title: response.scenario.title,
        engine: response.scenario.generator_engine,
        actorCount: response.scenario.actors.length,
        hazardCount: response.scenario.static_hazards.length,
        isValid: response.validation.is_valid,
      });

      setActiveScenario(response.scenario);
      setValidationResult(response.validation);
    } catch (err: any) {
      console.error('[SCENARIO_DEBUG] Scenario generation error:', err);
      setGenerateError(err.message || 'Failed to generate scenario');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleApply = async () => {
    if (!activeScenario || !validationResult?.is_valid) return;
    try {
      console.log('[SCENARIO_DEBUG] Applying scenario:', {
        id: activeScenario.scenario_id,
        title: activeScenario.title,
        autoLaunch,
      });
      await applyScenario(activeScenario, autoLaunch);
      if (autoLaunch) {
        setOpen(false);
      }
    } catch (err: any) {
      console.error('[SCENARIO_DEBUG] Failed to stage scenario:', err);
    }
  };

  const handleSaveToStorage = () => {
    if (!activeScenario) return;
    try {
      scenarioStorageService.saveScenario(activeScenario);
      setSaveSuccessMsg(`Saved "${activeScenario.title}" to browser library`);
      refreshSavedScenarios();
      setSelectedSavedId(activeScenario.scenario_id);
      setTimeout(() => setSaveSuccessMsg(null), 3000);
    } catch (err: any) {
      alert(`Save failed: ${err.message}`);
    }
  };

  const handleLoadSaved = (id: string) => {
    setSelectedSavedId(id);
    if (!id) return;
    const scenario = scenarioStorageService.getScenario(id);
    if (scenario) {
      setActiveScenario(scenario);
      // Validate loaded scenario
      validateScenario(scenario)
        .then((res) => setValidationResult(res))
        .catch(() => {
          setValidationResult({
            is_valid: true,
            issues: [],
            tested_footprints_count: 0,
            swept_path_segments_count: 0,
          });
        });
      setGenerateError(null);
      setSaveSuccessMsg(`Loaded "${scenario.title}" from library`);
      setTimeout(() => setSaveSuccessMsg(null), 3000);
    }
  };

  const handleDeleteSaved = (id: string) => {
    if (!id) return;
    scenarioStorageService.deleteScenario(id);
    refreshSavedScenarios();
    if (selectedSavedId === id) {
      setSelectedSavedId('');
    }
  };

  const handleExportJson = () => {
    if (!activeScenario) return;
    const jsonStr = JSON.stringify(activeScenario, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `scenario_${activeScenario.scenario_id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportJson = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string);
        setActiveScenario(parsed);
        const valRes = await validateScenario(parsed);
        setValidationResult(valRes);
        setSaveSuccessMsg('Imported scenario successfully');
        setTimeout(() => setSaveSuccessMsg(null), 3000);
      } catch (err: any) {
        alert(`Failed to import JSON: ${err.message}`);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  if (!isOpen) return null;

  const isStaging = stagingStatus === 'STAGING';
  const isRollingBack = stagingStatus === 'ROLLING_BACK';
  const isApplyDisabled =
    !activeScenario ||
    !validationResult?.is_valid ||
    isMultiplayerActive ||
    isRecordingFlightData ||
    isStaging ||
    isRollingBack;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 overflow-y-auto">
      <div className="relative w-full max-w-5xl bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl flex flex-col max-h-[92vh] overflow-hidden text-slate-100">
        {/* === HEADER === */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/60">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
              <Sparkles className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <h2 className="text-lg font-bold tracking-wide text-white flex items-center space-x-2">
                <span>AI Scenario Generator</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-cyan-900/60 text-cyan-300 border border-cyan-700/50 uppercase">
                  Digital Twin Staging
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                Natural-language scenario synthesis with Rapier physics mount verification & transactional rollback
              </p>
            </div>
          </div>
          <button
            onClick={() => setOpen(false)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* === BODY CONTENT === */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Section 1: Generation Controls */}
          <div className="bg-slate-800/40 border border-slate-700/60 rounded-xl p-4 space-y-4">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-300 flex items-center space-x-1.5">
                <Bot className="w-4 h-4 text-cyan-400" />
                <span>Describe Simulation Scenario</span>
              </label>
              {/* Library Dropdown */}
              <div className="flex items-center space-x-2">
                <span className="text-xs text-slate-400">Saved:</span>
                <select
                  value={selectedSavedId}
                  onChange={(e) => handleLoadSaved(e.target.value)}
                  className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
                >
                  <option value="">-- Load from Library ({savedScenarios.length}) --</option>
                  {savedScenarios.map((item) => (
                    <option key={item.scenario.scenario_id} value={item.scenario.scenario_id}>
                      {item.scenario.title} ({item.scenario.difficulty})
                    </option>
                  ))}
                </select>
                {selectedSavedId && (
                  <button
                    onClick={() => handleDeleteSaved(selectedSavedId)}
                    title="Delete saved scenario"
                    className="p-1.5 text-rose-400 hover:bg-rose-950/40 rounded-md transition"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="e.g. Dual high-speed forklifts crossing in Corridor 2 with narrow clearance, or a blind corner obstacle in Corridor 1..."
              rows={3}
              className="w-full bg-slate-950/80 border border-slate-700/80 rounded-xl p-3 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500 resize-none font-sans"
            />

            {/* Quick Presets */}
            <div className="space-y-1.5">
              <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wide">
                Suggested Scenarios:
              </span>
              <div className="flex flex-wrap gap-2">
                {SUGGESTED_PROMPTS.map((item, idx) => {
                  const isSelected = prompt === item.prompt;
                  return (
                    <button
                      key={idx}
                      disabled={isGenerating}
                      onClick={() => {
                        setPrompt(item.prompt);
                        setPreferredCorridor(item.corridor);
                        setDifficulty(item.difficulty);
                        handleGenerate(item.prompt, item.corridor, item.difficulty);
                      }}
                      className={`text-xs px-2.5 py-1.5 rounded-lg border transition flex items-center space-x-1.5 ${
                        isSelected
                          ? 'bg-cyan-950/80 text-cyan-200 border-cyan-500 shadow-sm shadow-cyan-900/50'
                          : 'bg-slate-800/80 hover:bg-slate-700/80 text-slate-300 border-slate-700'
                      }`}
                    >
                      <Sparkles className={`w-3 h-3 ${isSelected ? 'text-cyan-400' : 'text-slate-400'}`} />
                      <span>{item.title}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Parameter Selectors */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2 border-t border-slate-700/40">
              <div>
                <label className="text-xs text-slate-400 block mb-1">Preferred Corridor</label>
                <select
                  value={preferredCorridor}
                  onChange={(e) => setPreferredCorridor(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
                >
                  <option value="aisle-1">Corridor 1 (Aisle 1 Storage Bay)</option>
                  <option value="aisle-2">Corridor 2 (Center Crossing)</option>
                  <option value="aisle-3">Corridor 3 (Aisle 3 Storage Bay)</option>
                </select>
              </div>

              <div>
                <label className="text-xs text-slate-400 block mb-1">Difficulty</label>
                <select
                  value={difficulty}
                  onChange={(e) => setDifficulty(e.target.value as ScenarioDifficulty)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
                >
                  <option value="normal">Normal (Standard safety buffers)</option>
                  <option value="hard">Hard (Narrow clearance, active actors)</option>
                  <option value="extreme">Extreme (Maximum dynamic density)</option>
                </select>
              </div>

              <div className="flex items-end">
                <button
                  onClick={() => handleGenerate()}
                  disabled={isGenerating || !prompt.trim()}
                  className="w-full flex items-center justify-center space-x-2 py-2 px-4 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-medium text-xs shadow-lg shadow-cyan-900/30 transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isGenerating ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Synthesizing Scenario...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      <span>Generate Scenario</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {generateError && (
              <div className="p-3 rounded-lg bg-rose-950/40 border border-rose-800/60 text-xs text-rose-300 flex items-center space-x-2">
                <AlertTriangle className="w-4 h-4 text-rose-400 flex-shrink-0" />
                <span>{generateError}</span>
              </div>
            )}

            {saveSuccessMsg && (
              <div className="p-2.5 rounded-lg bg-emerald-950/40 border border-emerald-800/60 text-xs text-emerald-300 flex items-center space-x-2">
                <CheckCircle className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                <span>{saveSuccessMsg}</span>
              </div>
            )}
          </div>

          {/* Section 2: Human-in-the-Loop Scenario Preview */}
          {activeScenario && (
            <div className="space-y-4">
              {/* Header card with Engine Badge */}
              <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center space-x-2.5">
                    <h3 className="text-base font-bold text-white">{activeScenario.title}</h3>
                    {activeScenario.generator_engine === 'GEMINI_1_5_FLASH' ? (
                      <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-cyan-950 border border-cyan-500/50 text-cyan-300">
                        <Sparkles className="w-3 h-3 text-cyan-400" />
                        <span>GEMINI 1.5 FLASH AI</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-950 border border-amber-500/50 text-amber-300">
                        <Cpu className="w-3 h-3 text-amber-400" />
                        <span>DETERMINISTIC FALLBACK</span>
                      </span>
                    )}
                    <span className="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700 uppercase">
                      {activeScenario.difficulty}
                    </span>
                  </div>
                  <p className="text-xs text-slate-300">{activeScenario.description}</p>
                </div>

                {/* Storage & Export actions */}
                <div className="flex items-center space-x-2 flex-shrink-0">
                  <button
                    onClick={handleSaveToStorage}
                    className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 border border-slate-700 transition"
                  >
                    <Save className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Save</span>
                  </button>
                  <button
                    onClick={handleExportJson}
                    className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 border border-slate-700 transition"
                  >
                    <Download className="w-3.5 h-3.5 text-slate-400" />
                    <span>Export JSON</span>
                  </button>
                  <label className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 border border-slate-700 transition cursor-pointer">
                    <Upload className="w-3.5 h-3.5 text-slate-400" />
                    <span>Import</span>
                    <input type="file" accept=".json" onChange={handleImportJson} className="hidden" />
                  </label>
                </div>
              </div>

              {/* Physical Validation Status Card */}
              {validationResult && (
                <div
                  className={`p-4 rounded-xl border flex flex-col space-y-2 ${
                    validationResult.is_valid
                      ? 'bg-emerald-950/20 border-emerald-800/60'
                      : 'bg-rose-950/20 border-rose-800/60'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      {validationResult.is_valid ? (
                        <CheckCircle className="w-5 h-5 text-emerald-400" />
                      ) : (
                        <XCircle className="w-5 h-5 text-rose-400" />
                      )}
                      <span className="text-xs font-bold uppercase tracking-wider text-white">
                        Physical Feasibility:{' '}
                        {validationResult.is_valid ? 'PASSED (STAGING PERMITTED)' : 'REJECTED (COLLISION DETECTED)'}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-400 space-x-3">
                      <span>Tested Footprints: {validationResult.tested_footprints_count}</span>
                      <span>Swept Path Segments: {validationResult.swept_path_segments_count}</span>
                    </div>
                  </div>

                  {validationResult.issues.length > 0 && (
                    <div className="space-y-1.5 pt-2 border-t border-slate-800">
                      {validationResult.issues.map((iss, i) => (
                        <div
                          key={i}
                          className={`text-xs flex items-start space-x-2 ${
                            iss.severity === 'ERROR' ? 'text-rose-300' : 'text-amber-300'
                          }`}
                        >
                          <span
                            className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
                              iss.severity === 'ERROR' ? 'bg-rose-950 text-rose-400' : 'bg-amber-950 text-amber-400'
                            }`}
                          >
                            {iss.severity}
                          </span>
                          <span className="font-mono text-[11px]">[{iss.code}]</span>
                          <span>{iss.message}</span>
                          {iss.affected_entity_id && (
                            <span className="text-slate-400">({iss.affected_entity_id})</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Object Generation & Requested vs Generated Quantity Verification (Phase 5.5C) */}
              {(() => {
                const WORD_TO_NUM: Record<string, number> = {
                  one: 1, two: 2, three: 3, four: 4, five: 5,
                  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
                  a: 1, an: 1,
                };
                const reqList: string[] = [];
                const regex = /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|a|an)\s+([a-zA-Z\-_]+)\b/gi;
                let match;
                while ((match = regex.exec(prompt)) !== null) {
                  const rawCount = match[1].toLowerCase();
                  const entity = match[2].toLowerCase();
                  const count = WORD_TO_NUM[rawCount] !== undefined ? WORD_TO_NUM[rawCount] : parseInt(rawCount, 10);
                  if (!isNaN(count) && count > 0) {
                    if (['box', 'boxes', 'barrier', 'barriers', 'worker', 'workers', 'forklift', 'forklifts', 'obstacle', 'obstacles'].some(k => entity.includes(k))) {
                      reqList.push(`${count} ${entity}`);
                    }
                  }
                }

                const genList: string[] = [];
                const boxCount = activeScenario.static_hazards.filter((h) => (h.hazard_type as string) === 'box' || h.hazard_type === 'cube' || h.name.toLowerCase().includes('box')).length;
                const barrierCount = activeScenario.static_hazards.filter((h) => h.hazard_type === 'barrier' || h.name.toLowerCase().includes('barrier')).length;
                const otherStatic = activeScenario.static_hazards.length - boxCount - barrierCount;
                if (boxCount > 0) genList.push(`${boxCount} ${boxCount === 1 ? 'box' : 'boxes'}`);
                if (barrierCount > 0) genList.push(`${barrierCount} ${barrierCount === 1 ? 'barrier' : 'barriers'}`);
                if (otherStatic > 0) genList.push(`${otherStatic} obstacle${otherStatic === 1 ? '' : 's'}`);

                const workerCount = activeScenario.actors.filter((a) => a.actor_type === 'worker').length;
                const forkliftCount = activeScenario.actors.filter((a) => a.actor_type === 'forklift').length;
                if (workerCount > 0) genList.push(`${workerCount} worker${workerCount === 1 ? '' : 's'}`);
                if (forkliftCount > 0) genList.push(`${forkliftCount} forklift${forkliftCount === 1 ? '' : 's'}`);

                const reqStr = reqList.length > 0 ? reqList.join(', ') : `${activeScenario.static_hazards.length + activeScenario.actors.length} objects`;
                const genStr = genList.length > 0 ? genList.join(', ') : `${activeScenario.static_hazards.length + activeScenario.actors.length} entities`;

                return (
                  <div
                    data-testid="requested-vs-generated-card"
                    className="p-3.5 rounded-xl bg-cyan-950/30 border border-cyan-800/60 space-y-2"
                  >
                    <div className="flex items-center justify-between text-xs font-semibold text-cyan-300">
                      <div className="flex items-center space-x-2">
                        <Bot className="w-4 h-4 text-cyan-400" />
                        <span>Object Generation & Quantity Verification</span>
                      </div>
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-cyan-950 text-cyan-300 border border-cyan-700">
                        {validationResult?.is_valid ? 'PHYSICAL MATCH CONFIRMED' : 'VALIDATION ISSUES'}
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-2 text-xs">
                      <div className="px-3 py-1.5 rounded-lg bg-slate-900/90 border border-slate-700/80 flex items-center space-x-2">
                        <span className="text-slate-400">Requested:</span>
                        <span className="font-bold text-slate-100">{reqStr}</span>
                        <span className="text-slate-500">•</span>
                        <span className="text-slate-400">Generated:</span>
                        <span className="font-bold text-emerald-300">{genStr}</span>
                      </div>
                      <div className="px-3 py-1.5 rounded-lg bg-slate-900/90 border border-slate-700/80 flex items-center space-x-2">
                        <span className="text-slate-400">Entities:</span>
                        <span className="font-bold text-cyan-300">
                          {activeScenario.static_hazards.length} static, {activeScenario.actors.length} dynamic
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Grid: Robot Mission & Entities */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Robot Setup */}
                <div className="bg-slate-800/40 border border-slate-700/60 rounded-xl p-3.5 space-y-2">
                  <div className="flex items-center space-x-2 text-xs font-semibold text-slate-300">
                    <User className="w-4 h-4 text-cyan-400" />
                    <span>Robot Mission Configuration</span>
                  </div>
                  <div className="space-y-1 text-xs text-slate-300">
                    <div>
                      <span className="text-slate-400">Start Position:</span> [
                      {activeScenario.robot_setup.start_position.map((v) => v.toFixed(2)).join(', ')}] (Yaw:{' '}
                      {activeScenario.robot_setup.start_rotation_rad.toFixed(2)} rad)
                    </div>
                    <div>
                      <span className="text-slate-400">Destination:</span>{' '}
                      {activeScenario.robot_setup.destination_name} (
                      {activeScenario.robot_setup.destination_id})
                    </div>
                    <div>
                      <span className="text-slate-400">Navigation Preference:</span>{' '}
                      <span className="font-mono text-cyan-400">
                        {activeScenario.robot_setup.navigation_preference}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Actors & Dynamic Objects */}
                <div className="bg-slate-800/40 border border-slate-700/60 rounded-xl p-3.5 space-y-2">
                  <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
                    <div className="flex items-center space-x-2">
                      <Layers className="w-4 h-4 text-cyan-400" />
                      <span>Dynamic Actors ({activeScenario.actors.length})</span>
                    </div>
                  </div>
                  <div className="space-y-1.5 max-h-36 overflow-y-auto">
                    {activeScenario.actors.map((actor) => (
                      <div
                        key={actor.id}
                        className="p-2 rounded-lg bg-slate-900/60 border border-slate-800 text-xs flex items-center justify-between"
                      >
                        <div>
                          <div className="font-medium text-slate-200">
                            {actor.name} <span className="text-slate-400">({actor.actor_type})</span>
                          </div>
                          <div className="text-[11px] text-slate-400">
                            Patrol: [{actor.patrol_start.join(', ')}] &rarr; [{actor.patrol_end.join(', ')}] @{' '}
                            {actor.patrol_speed.toFixed(1)} m/s
                          </div>
                        </div>
                        <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 font-mono text-slate-300">
                          {actor.id}
                        </span>
                      </div>
                    ))}
                    {activeScenario.actors.length === 0 && (
                      <div className="text-xs text-slate-400 italic">No dynamic actors in scenario</div>
                    )}
                  </div>
                </div>
              </div>

              {/* Static Hazards */}
              <div className="bg-slate-800/40 border border-slate-700/60 rounded-xl p-3.5 space-y-2">
                <div className="flex items-center space-x-2 text-xs font-semibold text-slate-300">
                  <AlertTriangle className="w-4 h-4 text-amber-400" />
                  <span>Static Hazards & Obstacles ({activeScenario.static_hazards.length})</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                  {activeScenario.static_hazards.map((hazard) => {
                    const rawDims = hazard.dimensions || hazard.size;
                    const dims =
                      rawDims && rawDims.length >= 3
                        ? `${rawDims[0].toFixed(2)}m × ${rawDims[1].toFixed(2)}m × ${rawDims[2].toFixed(2)}m`
                        : hazard.hazard_type === 'barrier'
                        ? '2.40m × 1.10m × 0.40m'
                        : '0.80m × 0.80m × 0.80m';
                    return (
                      <div
                        key={hazard.id}
                        className="p-2 rounded-lg bg-slate-900/60 border border-slate-800 text-xs space-y-1"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-slate-200 truncate">{hazard.name}</span>
                          <span className="px-1 py-0.2 rounded text-[8px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-800">
                            RAPIER
                          </span>
                        </div>
                        <div className="text-[10px] text-slate-400 font-mono space-y-0.5">
                          <div>
                            Type: <span className="text-amber-300 capitalize">{hazard.hazard_type}</span>
                          </div>
                          <div>
                            Dims: <span className="text-cyan-300">{dims}</span>
                          </div>
                          <div>
                            Pos: [{hazard.position.map((p) => p.toFixed(2)).join(', ')}]
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {activeScenario.static_hazards.length === 0 && (
                    <div className="text-xs text-slate-400 italic col-span-3">
                      No static hazards in scenario
                    </div>
                  )}
                </div>
              </div>

              {/* Parameter Provenance Audit */}
              {activeScenario.provenance_audit.length > 0 && (
                <div className="bg-slate-800/40 border border-slate-700/60 rounded-xl p-3.5 space-y-2">
                  <div className="flex items-center space-x-2 text-xs font-semibold text-slate-300">
                    <Sliders className="w-4 h-4 text-cyan-400" />
                    <span>Parameter Provenance Audit</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-slate-700/60 text-slate-400 text-[11px]">
                          <th className="pb-1">Field</th>
                          <th className="pb-1">Provenance</th>
                          <th className="pb-1">Rationale</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800 text-slate-300">
                        {activeScenario.provenance_audit.map((prov, idx) => (
                          <tr key={idx}>
                            <td className="py-1 font-mono text-[11px] text-slate-300">{prov.field_name}</td>
                            <td className="py-1">
                              {prov.provenance === 'EXPLICIT_USER' && (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-950 text-emerald-400 border border-emerald-800">
                                  EXPLICIT_USER
                                </span>
                              )}
                              {prov.provenance === 'INFERRED_DEFAULT' && (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-800 text-slate-300 border border-slate-700">
                                  INFERRED_DEFAULT
                                </span>
                              )}
                              {prov.provenance === 'SYSTEM_CONSTRAINED' && (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-950 text-amber-400 border border-amber-800">
                                  SYSTEM_CONSTRAINED
                                </span>
                              )}
                            </td>
                            <td className="py-1 text-[11px] text-slate-400">{prov.rationale || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Unsupported Features Warning (if any) */}
              {activeScenario.unsupported_features.length > 0 && (
                <div className="p-3 rounded-lg bg-amber-950/30 border border-amber-800/60 text-xs text-amber-300 space-y-1">
                  <div className="font-semibold flex items-center space-x-1.5">
                    <AlertTriangle className="w-4 h-4 text-amber-400" />
                    <span>Unsupported Natural-Language Requests Noted:</span>
                  </div>
                  <ul className="list-disc list-inside space-y-0.5 text-[11px] text-amber-200/80">
                    {activeScenario.unsupported_features.map((feat, idx) => (
                      <li key={idx}>{feat}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        {/* === FOOTER: Execution Controls & Safety Guards === */}
        <div className="border-t border-slate-800 bg-slate-950/80 px-6 py-4 space-y-3">
          {/* Multiplayer Alert */}
          {isMultiplayerActive && (
            <div className="p-2.5 rounded-lg bg-amber-950/40 border border-amber-800/60 text-xs text-amber-300 flex items-center space-x-2">
              <ShieldAlert className="w-4 h-4 text-amber-400 flex-shrink-0" />
              <span>
                Multiplayer session active. Custom AI scenarios can only be staged in local single-operator mode.
              </span>
            </div>
          )}

          {/* Active Flight Recording Alert */}
          {isRecordingFlightData && (
            <div className="p-2.5 rounded-lg bg-cyan-950/40 border border-cyan-800/60 text-xs text-cyan-300 flex items-center space-x-2">
              <AlertTriangle className="w-4 h-4 text-cyan-400 flex-shrink-0" />
              <span>
                Black Box Flight Recording is active. Stop recording before staging a new scenario.
              </span>
            </div>
          )}

          {/* Staging Error & Rollback Status Alert */}
          {stagingError && (
            <div
              className={`p-2.5 rounded-lg text-xs flex items-center space-x-2 ${
                stagingStatus === 'RECOVERY_FAILED'
                  ? 'bg-rose-950/60 border border-rose-800 text-rose-300'
                  : 'bg-amber-950/40 border border-amber-800 text-amber-300'
              }`}
            >
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              <span>{stagingError}</span>
            </div>
          )}

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <label className="flex items-center space-x-2 cursor-pointer text-xs text-slate-300">
              <input
                type="checkbox"
                checked={autoLaunch}
                onChange={(e) => setAutoLaunch(e.target.checked)}
                className="w-4 h-4 rounded bg-slate-900 border-slate-700 text-cyan-500 focus:ring-0"
              />
              <span>Auto-start autonomous mission upon physics verification</span>
            </label>

            <div className="flex items-center space-x-3">
              <button
                onClick={() => setOpen(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition"
              >
                Close
              </button>

              <button
                onClick={handleApply}
                disabled={isApplyDisabled}
                className="flex items-center space-x-2 px-5 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold shadow-lg shadow-emerald-950/40 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isStaging ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Verifying Rapier Mount...</span>
                  </>
                ) : isRollingBack ? (
                  <>
                    <RotateCcw className="w-4 h-4 animate-spin text-amber-400" />
                    <span>Rolling Back Scene...</span>
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 fill-current" />
                    <span>Approve & Apply Scenario</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
