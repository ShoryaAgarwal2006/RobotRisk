import React, { useState, useRef, useEffect } from 'react';
import {
  Bot,
  Send,
  User,
  CheckCircle2,
  XCircle,
  Play,
  Pause,
  Box,
  Users,
  ShieldAlert,
  Flame,
  HelpCircle,
  Trash2,
  Sparkles,
  Layers,
} from 'lucide-react';
import { useSimulationStore } from '../state/useSimulationStore';
import { ParsedCommand, CommandActionType } from '../types/command';

const SUGGESTED_COMMANDS = [
  { label: '🏗️ Falling Pallet Test', prompt: 'Run adversarial falling pallet vertical impact test.' },
  { label: '🔥 Extreme & Shortest', prompt: 'Make it tough and take it through the shortest path.' },
  { label: '👥 Crowded & Block', prompt: 'Create a crowded warehouse, block aisle two and start the robot.' },
  { label: '📦 Box 3m Ahead', prompt: 'Place a box three metres ahead of the robot.' },
  { label: '🚧 Block Aisle 2', prompt: 'Block the entire second aisle.' },
  { label: '🔓 Clear Barriers', prompt: 'Remove the aisle blockage.' },
  { label: '❓ Explain Stoppage', prompt: 'Explain why the robot stopped.' },
  { label: '⏸ Pause Sim', prompt: 'Pause the simulation.' },
  { label: '▶ Resume Sim', prompt: 'Resume the simulation.' },
  { label: '📊 Safety Events', prompt: 'Show me the latest collision and safety events.' },
];

interface AICommandCenterPanelProps {
  forceMode?: string;
}

export const AICommandCenterPanel: React.FC<AICommandCenterPanelProps> = ({ forceMode }) => {
  const storeMode = useSimulationStore((s) => s.mode);
  const mode = forceMode || storeMode;
  const chatMessages = useSimulationStore((s) => s.chatMessages);
  const isAiThinking = useSimulationStore((s) => s.isAiThinking);
  const sendChatMessage = useSimulationStore((s) => s.sendChatMessage);
  const approveCommand = useSimulationStore((s) => s.approveCommand);
  const rejectCommand = useSimulationStore((s) => s.rejectCommand);
  const clearChatMessages = useSimulationStore((s) => s.clearChatMessages);

  const [inputPrompt, setInputPrompt] = useState('');
  const chatBottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll chat to bottom on new messages
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, isAiThinking]);

  // Focus input on mount if in ai_command mode
  useEffect(() => {
    if (mode === 'ai_command') {
      inputRef.current?.focus();
    }
  }, [mode]);

  if (mode !== 'ai_command') return null;

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const prompt = inputPrompt.trim();
    if (!prompt || isAiThinking) return;

    setInputPrompt('');
    await sendChatMessage(prompt);
  };

  const handleSuggestionClick = async (prompt: string) => {
    if (isAiThinking) return;
    await sendChatMessage(prompt);
  };

  const getActionIcon = (action: CommandActionType) => {
    switch (action) {
      case 'spawn_obstacle':
        return <Box className="w-4 h-4 text-cyan-400" />;
      case 'spawn_workers':
        return <Users className="w-4 h-4 text-amber-400" />;
      case 'block_aisle':
        return <ShieldAlert className="w-4 h-4 text-rose-400" />;
      case 'unblock_aisle':
        return <CheckCircle2 className="w-4 h-4 text-emerald-400" />;
      case 'clear_obstacles':
        return <Trash2 className="w-4 h-4 text-slate-400" />;
      case 'set_simulation_state':
        return <Pause className="w-4 h-4 text-blue-400" />;
      case 'emergency_stop':
        return <ShieldAlert className="w-4 h-4 text-rose-500" />;
      case 'pause_mission':
        return <Pause className="w-4 h-4 text-amber-400" />;
      case 'resume_mission':
        return <Play className="w-4 h-4 text-emerald-400" />;
      case 'start_mission':
        return <Play className="w-4 h-4 text-emerald-400" />;
      case 'set_difficulty':
        return <Flame className="w-4 h-4 text-purple-400" />;
      case 'query_explanation':
      case 'query_events':
        return <HelpCircle className="w-4 h-4 text-cyan-400" />;
      default:
        return <Sparkles className="w-4 h-4 text-slate-400" />;
    }
  };

  return (
    <div
      data-testid="ai-command-panel"
      className="absolute top-20 bottom-6 right-6 z-20 w-[420px] max-w-[calc(100vw-2rem)] flex flex-col font-mono select-none pointer-events-auto"
    >
      {/* Outer Panel Container */}
      <div className="flex-1 min-h-0 flex flex-col rounded-xl bg-[#090d18]/95 backdrop-blur-md border border-cyan-800/60 shadow-2xl shadow-cyan-950/50 overflow-hidden">
        {/* Panel Header */}
        <div className="shrink-0 px-4 py-3 bg-[#0d1424] border-b border-[#1e2942] flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <div className="p-1.5 rounded-lg bg-cyan-950/80 border border-cyan-700/60">
              <Bot className="w-4 h-4 text-cyan-400" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-extrabold text-slate-100 text-xs tracking-wider">AI COMMAND CENTER</span>
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800 font-semibold">
                  HUMAN-IN-THE-LOOP
                </span>
              </div>
              <p className="text-[10px] text-slate-400">Natural language simulation orchestration</p>
            </div>
          </div>

          <button
            onClick={clearChatMessages}
            title="Clear chat history"
            className="p-1.5 rounded hover:bg-[#1e2942] text-slate-400 hover:text-rose-300 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Suggested Quick Action Chips */}
        <div className="shrink-0 px-3 py-2 bg-[#060a14] border-b border-[#1e2942]/60 overflow-x-auto no-scrollbar flex items-center space-x-1.5">
          <span className="text-[9px] text-slate-500 uppercase font-semibold shrink-0 mr-1 flex items-center space-x-1">
            <Sparkles className="w-2.5 h-2.5 text-cyan-400" />
            <span>QUICK:</span>
          </span>
          {SUGGESTED_COMMANDS.map((chip, idx) => (
            <button
              key={idx}
              onClick={() => handleSuggestionClick(chip.prompt)}
              disabled={isAiThinking}
              className="text-[10px] px-2.5 py-1 rounded-full bg-[#11192e] hover:bg-cyan-950/60 border border-[#1e2942] hover:border-cyan-600/60 text-slate-300 hover:text-cyan-200 whitespace-nowrap transition-colors shrink-0 disabled:opacity-50"
            >
              {chip.label}
            </button>
          ))}
        </div>

        {/* Chat Stream History */}
        <div
          data-testid="ai-chat-history"
          className="flex-1 min-h-0 p-3 overflow-y-auto space-y-3.5 text-xs"
        >
          {chatMessages.map((msg) => {
            const isUser = msg.sender === 'user';

            return (
              <div
                key={msg.id}
                className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} space-y-1`}
              >
                {/* Message Header */}
                <div className="flex items-center space-x-1.5 text-[10px] text-slate-400 px-1">
                  {isUser ? (
                    <>
                      <span>OPERATOR</span>
                      <User className="w-3 h-3 text-cyan-400" />
                    </>
                  ) : (
                    <>
                      <Bot className="w-3 h-3 text-cyan-400" />
                      <span>AI COPILOT</span>
                    </>
                  )}
                  <span className="text-[9px] text-slate-600">
                    {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                </div>

                {/* Message Text Bubble */}
                <div
                  className={`p-3 rounded-xl max-w-[92%] leading-relaxed ${
                    isUser
                      ? 'bg-gradient-to-r from-cyan-950 to-blue-950 border border-cyan-700/60 text-cyan-100 shadow-md shadow-cyan-950/30'
                      : 'bg-[#0d1424] border border-[#1e2942] text-slate-200'
                  }`}
                >
                  <div className="whitespace-pre-wrap font-sans text-xs">
                    {msg.text}
                  </div>

                  {/* Structured Action Preview Card for Human Approval */}
                  {msg.parsedCommand && (
                    <ActionPreviewCard
                      command={msg.parsedCommand}
                      status={msg.status}
                      executionResult={msg.executionResult}
                      onApprove={() => approveCommand(msg.parsedCommand!.id)}
                      onReject={() => rejectCommand(msg.parsedCommand!.id)}
                      getActionIcon={getActionIcon}
                    />
                  )}
                </div>
              </div>
            );
          })}

          {/* AI Thinking Spinner */}
          {isAiThinking && (
            <div className="flex items-center space-x-2 text-cyan-400 text-xs p-2 rounded-lg bg-[#0d1424]/80 border border-cyan-900/40 animate-pulse">
              <Bot className="w-4 h-4 animate-bounce" />
              <span className="text-[11px] font-mono">Analyzing instruction & validating simulation schema...</span>
            </div>
          )}

          <div ref={chatBottomRef} />
        </div>

        {/* Pinned Input Bar */}
        <form
          id="ai-command-form"
          data-testid="ai-command-form"
          onSubmit={handleSubmit}
          className="shrink-0 sticky bottom-0 z-10 p-3 bg-[#0d1424] border-t border-[#1e2942] flex items-center space-x-2"
        >
          <input
            id="ai-command-input"
            data-testid="ai-command-input"
            aria-label="Simulation Command Input"
            ref={inputRef}
            type="text"
            value={inputPrompt}
            onChange={(e) => setInputPrompt(e.target.value)}
            disabled={isAiThinking}
            placeholder="Type simulation command (e.g. 'Place a box 3m ahead')..."
            className="flex-1 bg-[#060a14] border border-[#1e2942] text-cyan-200 text-xs rounded-lg px-3 py-2.5 focus:outline-none focus:border-cyan-500 disabled:opacity-50 transition-colors"
          />
          <button
            id="ai-command-send-button"
            data-testid="ai-command-send-button"
            aria-label="Send AI Command"
            type="submit"
            disabled={!inputPrompt.trim() || isAiThinking}
            className="flex items-center justify-center p-2.5 rounded-lg bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-bold disabled:opacity-40 transition-all shrink-0 shadow-lg shadow-cyan-600/30 cursor-pointer"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
};

interface ActionPreviewCardProps {
  command: ParsedCommand;
  status?: string;
  executionResult?: {
    success: boolean;
    message: string;
    details?: string;
    stepResults?: Array<{
      stepId: string;
      intent: string;
      step?: number;
      action?: string;
      success: boolean;
      message: string;
    }>;
  };
  onApprove: () => void;
  onReject: () => void;
  getActionIcon: (action: CommandActionType) => React.ReactNode;
}

const ActionPreviewCard: React.FC<ActionPreviewCardProps> = ({
  command,
  status,
  executionResult,
  onApprove,
  onReject,
  getActionIcon,
}) => {
  const isPending = status === 'pending_approval';
  const isApproved = status === 'approved';
  const isRejected = status === 'rejected';
  const isFailed = status === 'failed';
  const isMulti = Boolean(command.isMultiIntent && command.subActions && command.subActions.length > 1);

  return (
    <div className="mt-3 p-3 rounded-lg bg-[#070b16] border border-cyan-900/60 font-mono text-[11px] space-y-2.5">
      {/* Action Header */}
      <div className="flex items-center justify-between border-b border-[#1e2942] pb-1.5">
        <div className="flex items-center space-x-1.5 font-bold text-cyan-300">
          {isMulti ? (
            <>
              <Layers className="w-4 h-4 text-purple-400" />
              <span className="uppercase tracking-wider text-purple-300">
                COMPOSITE WORKFLOW ({command.subActions!.length} ACTIONS)
              </span>
            </>
          ) : (
            <>
              {getActionIcon(command.action)}
              <span className="uppercase tracking-wider">{command.action.replace('_', ' ')}</span>
            </>
          )}
        </div>
        <div className="flex items-center space-x-1.5">
          {command.parserMode && (
            <span className="text-[8px] px-1 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800">
              {command.parserMode === 'gemini_llm' ? 'GEMINI' : 'PIPELINE'}
            </span>
          )}
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
            CONFIDENCE: {(command.confidence * 100).toFixed(0)}%
          </span>
        </div>
      </div>

      {/* Target Details / Intent */}
      <div className="space-y-1 text-slate-300">
        <div className="flex items-center justify-between text-[10px]">
          <span className="text-slate-500">INTENT:</span>
          <span className="font-bold text-cyan-200">{command.intent}</span>
        </div>

        {command.parameters.navigationPreference && (
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-slate-500">NAV PREFERENCE:</span>
            <span className="font-bold text-emerald-300">
              {command.parameters.navigationPreference === 'shortest_safe_path'
                ? 'SHORTEST SAFE ROUTE (0.54m Clearance)'
                : String(command.parameters.navigationPreference || 'default').toUpperCase()}
            </span>
          </div>
        )}

        {command.parameters.position && (
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-slate-500">TARGET COORDS:</span>
            <span className="font-bold text-amber-300">
              [{command.parameters.position[0].toFixed(1)}, {command.parameters.position[2].toFixed(1)}]
            </span>
          </div>
        )}

        {command.parameters.relativeToRobot && (
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-slate-500">RELATIVE OFFSET:</span>
            <span className="font-bold text-amber-300">
              {command.parameters.relativeToRobot.distanceAhead.toFixed(1)}m ahead of AMR
            </span>
          </div>
        )}

        {command.parameters.aisleName && (
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-slate-500">AFFECTED AISLE:</span>
            <span className="font-bold text-rose-300">{command.parameters.aisleName}</span>
          </div>
        )}

        {command.parameters.count && (
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-slate-500">WORKER COUNT:</span>
            <span className="font-bold text-purple-300">{command.parameters.count} autonomous actors</span>
          </div>
        )}

        {command.parameters.difficulty && (
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-slate-500">DIFFICULTY PRESET:</span>
            <span className="font-bold text-rose-400 uppercase">{command.parameters.difficulty}</span>
          </div>
        )}
      </div>

      {/* Sequential Multi-Action Steps List */}
      {isMulti && (
        <div className="p-2 rounded bg-[#0d1424] border border-[#1e2942]/60 space-y-1.5 text-[10px]">
          <div className="text-slate-400 flex items-center space-x-1 font-semibold">
            <Layers className="w-3 h-3 text-purple-400" />
            <span className="text-slate-200">EXECUTION ORDER ({command.subActions!.length} SUB-ACTIONS):</span>
          </div>
          <div className="space-y-1 pl-1">
            {command.subActions!.map((sub, idx) => (
              <div key={idx} className="flex items-center justify-between p-1 rounded bg-[#070b16] border border-[#1e2942]/40">
                <div className="flex items-center space-x-1.5 text-slate-300">
                  <span className="w-4 h-4 rounded-full bg-cyan-950 border border-cyan-800 text-cyan-300 flex items-center justify-center text-[9px] font-bold shrink-0">
                    {idx + 1}
                  </span>
                  {getActionIcon(sub.action)}
                  <span className="font-medium text-slate-200">{sub.intent}</span>
                </div>
                <span className="text-[9px] text-slate-500 uppercase">{sub.action.replace('_', ' ')}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Impact Summary */}
      <div className="p-2 rounded bg-[#0d1424] border border-[#1e2942]/60 text-[10px] space-y-1">
        <div className="text-slate-400 flex items-center space-x-1">
          <Layers className="w-3 h-3 text-cyan-400" />
          <span className="font-semibold text-slate-300">SIMULATION IMPACT:</span>
        </div>
        <p className="text-slate-200 pl-4">{command.impactSummary}</p>
      </div>

      {/* Proposed Changes Checklist */}
      {command.proposedChanges.length > 0 && (
        <div className="space-y-1 text-[10px] text-slate-400">
          <span className="font-semibold text-slate-300">PROPOSED CHANGES:</span>
          {command.proposedChanges.map((change, idx) => (
            <div key={idx} className="flex items-start space-x-1.5 pl-1 text-slate-300">
              <span className="text-cyan-400 text-xs leading-none">•</span>
              <span>{change}</span>
            </div>
          ))}
        </div>
      )}

      {/* Human Approval Controls */}
      {isPending && (
        <div className="pt-2 border-t border-[#1e2942] grid grid-cols-2 gap-2">
          <button
            onClick={onApprove}
            className="flex items-center justify-center space-x-1.5 py-1.5 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-md shadow-emerald-950 transition-colors"
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>{isMulti ? `APPROVE & RUN ALL (${command.subActions!.length})` : 'APPROVE & RUN'}</span>
          </button>
          <button
            onClick={onReject}
            className="flex items-center justify-center space-x-1.5 py-1.5 px-3 rounded-lg bg-[#141d33] hover:bg-rose-950 text-slate-300 hover:text-rose-300 border border-[#1e2942] text-xs transition-colors"
          >
            <XCircle className="w-3.5 h-3.5" />
            <span>REJECT</span>
          </button>
        </div>
      )}

      {/* Execution Feedback Status */}
      {isApproved && (
        <div className="p-2 rounded bg-emerald-950/70 border border-emerald-600/70 text-emerald-200 text-[10px] space-y-1.5">
          <div className="flex items-center space-x-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <div>
              <div className="font-bold text-emerald-300">APPROVED & EXECUTED</div>
              <div>{executionResult?.message || 'Applied to shared 3D simulation.'}</div>
            </div>
          </div>

          {/* Sequential Step Execution Breakdown */}
          {executionResult?.stepResults && executionResult.stepResults.length > 0 && (
            <div className="pt-1 border-t border-emerald-800/40 space-y-1 pl-1">
              {executionResult.stepResults.map((step, idx) => (
                <div key={idx} className="flex items-center space-x-1.5 text-[9px]">
                  {step.success ? (
                    <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                  ) : (
                    <XCircle className="w-3 h-3 text-rose-400 shrink-0" />
                  )}
                  <span className="font-semibold text-emerald-200">Step {step.step || idx + 1}:</span>
                  <span className="text-emerald-100">{step.message}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {isFailed && (
        <div className="p-2 rounded bg-rose-950/70 border border-rose-600/70 text-rose-200 text-[10px] flex items-center space-x-2">
          <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
          <div>
            <div className="font-bold text-rose-300">EXECUTION FAILED</div>
            <div>{executionResult?.message || 'An error occurred during execution.'}</div>
          </div>
        </div>
      )}

      {isRejected && (
        <div className="p-2 rounded bg-rose-950/70 border border-rose-600/70 text-rose-200 text-[10px] flex items-center space-x-2">
          <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
          <div>
            <div className="font-bold text-rose-300">REJECTED BY OPERATOR</div>
            <div>{executionResult?.message || 'Simulation left unchanged.'}</div>
          </div>
        </div>
      )}
    </div>
  );
};
