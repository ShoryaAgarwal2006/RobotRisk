import React, { useState } from 'react';
import {
  Users,
  Copy,
  Check,
  QrCode,
  LogOut,
  X,
  Shield,
  Radio,
  ExternalLink,
  ChevronRight,
  UserCheck,
} from 'lucide-react';
import { useSimulationStore } from '../state/useSimulationStore';
import { UserRole } from '../types/multiplayer';
import { generateQrSvg } from '../utils/qrGenerator';

interface MultiplayerModalProps {
  forceOpen?: boolean;
  forceActive?: boolean;
  forceSessionId?: string;
  forceUserRole?: UserRole;
  forceParticipants?: any[];
}

export const MultiplayerModal: React.FC<MultiplayerModalProps> = ({
  forceOpen,
  forceActive,
  forceSessionId,
  forceUserRole,
  forceParticipants,
}) => {
  const storeModalOpen = useSimulationStore((s) => s.isMultiplayerModalOpen);
  const isModalOpen = forceOpen !== undefined ? forceOpen : storeModalOpen;
  const setModalOpen = useSimulationStore((s) => s.setMultiplayerModalOpen);
  const storeActive = useSimulationStore((s) => s.isMultiplayerActive);
  const isMultiplayerActive = forceActive !== undefined ? forceActive : storeActive;
  const storeSessionId = useSimulationStore((s) => s.sessionId);
  const sessionId = forceSessionId !== undefined ? forceSessionId : storeSessionId;
  const storeUserRole = useSimulationStore((s) => s.userRole);
  const userRole = forceUserRole !== undefined ? forceUserRole : storeUserRole;
  const connectionStatus = useSimulationStore((s) => s.connectionStatus);
  const latencyMs = useSimulationStore((s) => s.latencyMs);
  const storeParticipants = useSimulationStore((s) => s.participants);
  const participants = forceParticipants !== undefined ? forceParticipants : storeParticipants;

  const createMultiplayerSession = useSimulationStore((s) => s.createMultiplayerSession);
  const joinMultiplayerSession = useSimulationStore((s) => s.joinMultiplayerSession);
  const leaveMultiplayerSession = useSimulationStore((s) => s.leaveMultiplayerSession);

  const [activeTab, setActiveTab] = useState<'create' | 'join'>('create');
  const [inputSessionId, setInputSessionId] = useState('');
  const [userName, setUserName] = useState('');
  const [selectedRole, setSelectedRole] = useState<UserRole>('controller');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [showQrCode, setShowQrCode] = useState(false);

  if (!isModalOpen) return null;

  // Construct direct join URL for peer
  const origin = typeof window !== 'undefined' ? window.location?.origin || 'http://127.0.0.1:5173' : 'http://127.0.0.1:5173';
  const joinUrl = sessionId
    ? `${origin}/?session=${sessionId}&role=controller`
    : '';

  const handleCreate = async () => {
    try {
      setIsSubmitting(true);
      setErrorMsg(null);
      await createMultiplayerSession(userName || 'Host Operator', 'operator');
    } catch (e: any) {
      setErrorMsg(e.message || 'Failed to create session');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleJoin = async () => {
    const cleanId = (inputSessionId || '').trim().toUpperCase();
    if (!cleanId) {
      setErrorMsg('Please enter a valid 6-character room code.');
      return;
    }
    try {
      setIsSubmitting(true);
      setErrorMsg(null);
      await joinMultiplayerSession(
        cleanId,
        userName || (selectedRole === 'operator' ? 'Robot Operator' : 'Scenario Controller'),
        selectedRole
      );
    } catch (e: any) {
      setErrorMsg(e.message || 'Failed to join session');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCopyCode = () => {
    if (!sessionId) return;
    navigator.clipboard.writeText(sessionId);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const handleCopyLink = () => {
    if (!joinUrl) return;
    navigator.clipboard.writeText(joinUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const qrSvg = sessionId ? generateQrSvg(joinUrl, 6) : '';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg rounded-2xl bg-[#090d18] border border-cyan-500/40 shadow-2xl shadow-cyan-950/60 overflow-hidden text-slate-200 font-mono select-none">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#1e2942] bg-[#070a13]">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-lg bg-gradient-to-br from-cyan-500/20 to-blue-500/20 border border-cyan-500/40 text-cyan-400">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-extrabold tracking-wider bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent uppercase">
                Collaborative Multi-Device Hub
              </h2>
              <p className="text-[11px] text-slate-400">
                Connect two devices to the exact same live simulation
              </p>
            </div>
          </div>
          <button
            onClick={() => setModalOpen(false)}
            className="p-1.5 rounded-lg hover:bg-[#141d33] text-slate-400 hover:text-slate-200 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 space-y-4">
          {errorMsg && (
            <div className="p-3 rounded-lg bg-rose-950/80 border border-rose-600/80 text-rose-200 text-xs flex items-center justify-between">
              <span>{errorMsg}</span>
              <button onClick={() => setErrorMsg(null)} className="text-rose-400 hover:text-rose-200">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {isMultiplayerActive && sessionId ? (
            /* --- ACTIVE SESSION DECK --- */
            <div className="space-y-4">
              {/* Session Status Banner */}
              <div className="p-4 rounded-xl bg-[#0d1322] border border-cyan-500/40 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-400 font-bold">SESSION ROOM CODE</span>
                  <div className="flex items-center space-x-2">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        connectionStatus === 'connected' ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'
                      }`}
                    />
                    <span className="text-[10px] uppercase font-bold text-emerald-300">
                      {connectionStatus} {latencyMs > 0 && `(${latencyMs}ms)`}
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-between bg-[#070a13] p-2.5 rounded-lg border border-[#1e2942]">
                  <span className="text-2xl font-black text-cyan-300 tracking-widest">{sessionId}</span>
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={handleCopyCode}
                      className="flex items-center space-x-1 px-3 py-1.5 rounded-md bg-[#141d33] hover:bg-cyan-950/80 hover:text-cyan-300 border border-[#1e2942] text-xs font-semibold transition-colors"
                    >
                      {copiedCode ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copiedCode ? 'COPIED' : 'COPY'}</span>
                    </button>
                    <button
                      onClick={() => setShowQrCode(!showQrCode)}
                      className={`flex items-center space-x-1 px-3 py-1.5 rounded-md border text-xs font-semibold transition-colors ${
                        showQrCode
                          ? 'bg-cyan-600 text-white border-cyan-400'
                          : 'bg-[#141d33] hover:bg-cyan-950/80 hover:text-cyan-300 border-[#1e2942]'
                      }`}
                    >
                      <QrCode className="w-3.5 h-3.5" />
                      <span>QR</span>
                    </button>
                  </div>
                </div>

                {/* QR Code Expansion */}
                {showQrCode && (
                  <div className="flex flex-col items-center justify-center p-4 rounded-xl bg-slate-950 border border-cyan-800/60 space-y-2">
                    <div
                      className="p-2 bg-white rounded-lg shadow-lg"
                      dangerouslySetInnerHTML={{ __html: qrSvg }}
                    />
                    <p className="text-[10px] text-slate-400 text-center">
                      Scan with second device camera to join as Scenario Controller
                    </p>
                  </div>
                )}

                {/* Direct Link Share */}
                <div className="flex items-center justify-between pt-1">
                  <div className="text-[11px] text-slate-400 truncate max-w-[280px]">
                    <span className="text-slate-500">Join Link: </span>
                    <span className="text-cyan-400">{joinUrl}</span>
                  </div>
                  <button
                    onClick={handleCopyLink}
                    className="flex items-center space-x-1 px-2.5 py-1 rounded bg-[#070a13] hover:bg-[#141d33] text-[11px] text-cyan-300 border border-[#1e2942] transition-colors"
                  >
                    {copiedLink ? <Check className="w-3 h-3 text-emerald-400" /> : <ExternalLink className="w-3 h-3" />}
                    <span>{copiedLink ? 'Link Copied' : 'Copy Link'}</span>
                  </button>
                </div>
              </div>

              {/* Your Active Role */}
              <div className="p-3 rounded-xl bg-[#0d1322] border border-[#1e2942] flex items-center justify-between">
                <div>
                  <span className="text-[10px] text-slate-400 uppercase">Your Role On This Device</span>
                  <div className="flex items-center space-x-2 mt-0.5">
                    <Shield className="w-4 h-4 text-cyan-400" />
                    <span className="text-xs font-black text-cyan-300 uppercase">
                      {userRole === 'operator' ? 'Robot Operator (Authoritative Host)' : 'Scenario Controller (Hazard Injector)'}
                    </span>
                  </div>
                </div>
                <span
                  className={`text-[9px] px-2 py-0.5 rounded font-bold uppercase border ${
                    userRole === 'operator'
                      ? 'bg-cyan-950 text-cyan-300 border-cyan-700'
                      : 'bg-amber-950 text-amber-300 border-amber-700'
                  }`}
                >
                  {String(userRole || 'operator')}
                </span>
              </div>

              {/* Connected Participants List */}
              <div className="space-y-2">
                <span className="text-[11px] text-slate-400 font-bold flex items-center space-x-1.5">
                  <Radio className="w-3.5 h-3.5 text-cyan-400" />
                  <span>CONNECTED PARTICIPANTS ({participants.length})</span>
                </span>
                <div className="space-y-1.5 max-h-36 overflow-y-auto">
                  {participants.map((p) => (
                    <div
                      key={p.clientId}
                      className="flex items-center justify-between p-2 rounded-lg bg-[#070a13] border border-[#1e2942] text-xs"
                    >
                      <div className="flex items-center space-x-2">
                        <UserCheck className="w-3.5 h-3.5 text-cyan-400" />
                        <span className="font-semibold text-slate-200">{p.name}</span>
                        {p.isHost && (
                          <span className="text-[9px] px-1 rounded bg-blue-950 text-blue-300 border border-blue-800">
                            HOST
                          </span>
                        )}
                      </div>
                      <span
                        className={`text-[10px] font-mono px-2 py-0.5 rounded border uppercase ${
                          p.role === 'operator'
                            ? 'bg-cyan-950 text-cyan-300 border-cyan-800'
                            : 'bg-amber-950 text-amber-300 border-amber-800'
                        }`}
                      >
                        {String(p.role || 'observer')}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Leave Session Button */}
              <div className="pt-2">
                <button
                  onClick={leaveMultiplayerSession}
                  className="w-full flex items-center justify-center space-x-2 py-2.5 rounded-xl bg-rose-950/60 hover:bg-rose-900 text-rose-200 hover:text-white border border-rose-700/60 transition-colors text-xs font-bold"
                >
                  <LogOut className="w-4 h-4" />
                  <span>LEAVE COLLABORATIVE SESSION</span>
                </button>
              </div>
            </div>
          ) : (
            /* --- JOIN / CREATE TABS --- */
            <div className="space-y-4">
              {/* Tab Selector */}
              <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-[#070a13] border border-[#1e2942]">
                <button
                  onClick={() => {
                    setActiveTab('create');
                    setErrorMsg(null);
                  }}
                  className={`py-2 rounded-lg text-xs font-bold transition-all ${
                    activeTab === 'create'
                      ? 'bg-cyan-600 text-white shadow-md shadow-cyan-600/30'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-[#141d33]'
                  }`}
                >
                  Host New Session
                </button>
                <button
                  onClick={() => {
                    setActiveTab('join');
                    setErrorMsg(null);
                  }}
                  className={`py-2 rounded-lg text-xs font-bold transition-all ${
                    activeTab === 'join'
                      ? 'bg-cyan-600 text-white shadow-md shadow-cyan-600/30'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-[#141d33]'
                  }`}
                >
                  Join Existing Session
                </button>
              </div>

              {/* Your Name Input */}
              <div className="space-y-1">
                <label className="text-[10px] text-slate-400 font-semibold">YOUR OPERATOR / USER NAME</label>
                <input
                  type="text"
                  value={userName}
                  onChange={(e) => setUserName(e.target.value)}
                  placeholder={activeTab === 'create' ? 'Host Operator' : 'Scenario Controller'}
                  className="w-full bg-[#070a13] border border-[#1e2942] rounded-lg px-3 py-2 text-xs text-cyan-300 focus:outline-none focus:border-cyan-500 placeholder:text-slate-600"
                />
              </div>

              {activeTab === 'create' ? (
                /* CREATE TAB */
                <div className="space-y-4 pt-1">
                  <div className="p-3.5 rounded-xl bg-[#0d1322] border border-[#1e2942] text-xs text-slate-400 space-y-2">
                    <div className="flex items-center space-x-2 font-bold text-cyan-300">
                      <Shield className="w-4 h-4" />
                      <span>Role: Authoritative Host (Robot Operator)</span>
                    </div>
                    <p className="text-[11px] leading-relaxed text-slate-300">
                      You will host the live physics simulation and control AMR teleoperation, autonomous mission navigation, and emergency braking. A second device can join with your room code or QR code as Scenario Controller to inject dynamic hazards.
                    </p>
                  </div>

                  <button
                    onClick={handleCreate}
                    disabled={isSubmitting}
                    className="w-full flex items-center justify-center space-x-2 py-3 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-bold text-xs shadow-lg shadow-cyan-600/30 disabled:opacity-60 transition-all"
                  >
                    <span>{isSubmitting ? 'CREATING SESSION...' : 'CREATE SESSION & GENERATE ROOM CODE'}</span>
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                /* JOIN TAB */
                <div className="space-y-4 pt-1">
                  <div className="space-y-1">
                    <label className="text-[10px] text-slate-400 font-semibold">SESSION ROOM CODE</label>
                    <input
                      type="text"
                      value={inputSessionId}
                      onChange={(e) => setInputSessionId((e.target.value || '').toUpperCase())}
                      placeholder="e.g. RR-9K2L"
                      maxLength={7}
                      className="w-full bg-[#070a13] border border-[#1e2942] rounded-lg px-3 py-2 text-sm text-cyan-300 font-bold tracking-widest uppercase focus:outline-none focus:border-cyan-500 placeholder:text-slate-600"
                    />
                  </div>

                  {/* Role Selector */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] text-slate-400 font-semibold">CHOOSE YOUR PARTICIPANT ROLE</label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setSelectedRole('controller')}
                        className={`p-2.5 rounded-xl border text-left transition-all ${
                          selectedRole === 'controller'
                            ? 'bg-amber-950/40 border-amber-500 text-amber-200'
                            : 'bg-[#070a13] border-[#1e2942] text-slate-400 hover:border-slate-700'
                        }`}
                      >
                        <div className="font-bold text-xs">Scenario Controller</div>
                        <div className="text-[10px] text-slate-400 mt-0.5">Inject obstacles, barriers & challenges</div>
                      </button>

                      <button
                        type="button"
                        onClick={() => setSelectedRole('operator')}
                        className={`p-2.5 rounded-xl border text-left transition-all ${
                          selectedRole === 'operator'
                            ? 'bg-cyan-950/40 border-cyan-500 text-cyan-200'
                            : 'bg-[#070a13] border-[#1e2942] text-slate-400 hover:border-slate-700'
                        }`}
                      >
                        <div className="font-bold text-xs">Robot Operator</div>
                        <div className="text-[10px] text-slate-400 mt-0.5">Drive robot, start missions & brake</div>
                      </button>
                    </div>
                  </div>

                  <button
                    onClick={handleJoin}
                    disabled={isSubmitting}
                    className="w-full flex items-center justify-center space-x-2 py-3 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-bold text-xs shadow-lg shadow-cyan-600/30 disabled:opacity-60 transition-all"
                  >
                    <span>{isSubmitting ? 'CONNECTING...' : 'JOIN LIVE COLLABORATIVE SESSION'}</span>
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
