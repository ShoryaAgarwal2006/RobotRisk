import { describe, it, expect, beforeEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import { useSimulationStore } from '../../state/useSimulationStore';
import { MultiplayerModal } from '../MultiplayerModal';
import { ChallengeLibraryPanel } from '../ChallengeLibraryPanel';

describe('Collaborative Multi-Device Hub & Panel Rendering (toUpperCase Protection)', () => {
  beforeEach(() => {
    useSimulationStore.setState({
      isMultiplayerModalOpen: false,
      isMultiplayerActive: false,
      sessionId: null,
      clientId: null,
      userRole: 'operator',
      connectionStatus: 'disconnected',
      latencyMs: 0,
      participants: [],
      isChallengeLibraryOpen: false,
    });
  });

  it('renders MultiplayerModal cleanly in creation/join state when userRole is undefined', () => {
    useSimulationStore.setState({
      isMultiplayerModalOpen: true,
      isMultiplayerActive: false,
      sessionId: null,
      userRole: undefined as any, // Simulate previously crashing scenario
    });

    const html = renderToString(<MultiplayerModal forceOpen={true} />);
    expect(html).toContain('Collaborative Multi-Device Hub');
    expect(html).toContain('Host New Session');
    expect(html).toContain('Join Existing Session');
  });

  it('renders MultiplayerModal cleanly in active session deck even if userRole is undefined or null', () => {
    const participants = [
      {
        clientId: 'client-1',
        role: undefined as any,
        name: 'Host Alice',
        isHost: true,
        connectedAt: Date.now(),
      },
    ];

    const html = renderToString(
      <MultiplayerModal
        forceOpen={true}
        forceActive={true}
        forceSessionId="RR-SAFE1"
        forceUserRole={undefined as any}
        forceParticipants={participants}
      />
    );
    expect(html).toContain('RR-SAFE1');
    expect(html).toContain('Host Alice');
    expect(html).toContain('CONNECTED PARTICIPANTS');
    expect(html).toContain('LEAVE COLLABORATIVE SESSION');
  });

  it('renders ChallengeLibraryPanel safely when multiplayer is active and userRole is undefined', () => {
    // This was the exact crash site: ChallengeLibraryPanel.tsx:112 {userRole.toUpperCase()}
    const html = renderToString(
      <ChallengeLibraryPanel
        forceOpen={true}
        forceMultiplayerActive={true}
        forceUserRole={null as any}
      />
    );
    expect(html).toContain('CHALLENGE &amp; HAZARD LIBRARY');
    expect(html).toContain('CONTROLLER'); // Default fallback
  });

  it('renders ChallengeLibraryPanel with operator role badge when userRole is operator', () => {
    const html = renderToString(
      <ChallengeLibraryPanel
        forceOpen={true}
        forceMultiplayerActive={true}
        forceUserRole="operator"
      />
    );
    expect(html).toContain('OPERATOR');
  });
});
