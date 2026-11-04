import { HealthCheckResponse } from '../types/simulation';
import { UserRole, Participant } from '../types/multiplayer';

const API_BASE = import.meta.env.VITE_API_URL || '';

export async function fetchHealthCheck(): Promise<HealthCheckResponse> {
  const url = `${API_BASE}/api/health`;
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!res.ok) {
      throw new Error(`Health check failed with status: ${res.status}`);
    }

    const data: HealthCheckResponse = await res.json();
    return data;
  } catch (err) {
    // If running without proxy or direct port 8000
    try {
      const fallbackRes = await fetch('http://127.0.0.1:8000/api/health', {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
      });
      if (fallbackRes.ok) {
        return await fallbackRes.json();
      }
    } catch {
      // Fallback failed
    }
    throw err;
  }
}

export interface CreateSessionApiResponse {
  sessionId: string;
  clientId: string;
  role?: UserRole;
  hostRole?: UserRole;
  joinUrl: string;
  wsUrl?: string;
}

export interface JoinSessionApiResponse {
  sessionId: string;
  clientId: string;
  role: UserRole;
  wsUrl?: string;
  sessionInfo?: {
    sessionId: string;
    hostClientId: string;
    createdAt: number;
    participants: Participant[];
    isRunning: boolean;
    difficulty: string;
    activeObstacleCount: number;
    activeBarrierCount: number;
  };
  participants?: Participant[];
  currentSnapshot?: any;
}

export async function createSessionApi(
  hostName: string = 'Host Operator',
  role: UserRole = 'operator'
): Promise<CreateSessionApiResponse> {
  const payload = { name: hostName, hostName, role };
  const url = `${API_BASE}/api/session/create`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      return await res.json();
    }
  } catch {
    // Try direct localhost fallback
  }

  try {
    const fallbackRes = await fetch('http://127.0.0.1:8000/api/session/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (fallbackRes.ok) {
      return await fallbackRes.json();
    }
    let errorDetail = fallbackRes.statusText;
    try {
      const errJson = await fallbackRes.json();
      if (errJson?.detail) errorDetail = errJson.detail;
    } catch {
      // Ignored
    }
    throw new Error(`Failed to create session: ${errorDetail}`);
  } catch (err: any) {
    if (err?.message && err.message.startsWith('Failed to create session:')) {
      throw err;
    }
    throw new Error('Unable to connect to session server. Ensure the RobotRisk backend is running on port 8000.');
  }
}

export async function joinSessionApi(
  sessionId: string,
  name: string = 'Scenario Controller',
  role: UserRole = 'controller'
): Promise<JoinSessionApiResponse> {
  const cleanId = (sessionId || '').trim().toUpperCase();
  const payload = { sessionId: cleanId, name, role };
  const url = `${API_BASE}/api/session/join`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      return await res.json();
    }
  } catch {
    // Try direct localhost fallback
  }

  try {
    const fallbackRes = await fetch('http://127.0.0.1:8000/api/session/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (fallbackRes.ok) {
      return await fallbackRes.json();
    }
    let errorDetail = fallbackRes.statusText;
    try {
      const errJson = await fallbackRes.json();
      if (errJson?.detail) errorDetail = errJson.detail;
    } catch {
      const textErr = await fallbackRes.text().catch(() => '');
      if (textErr) errorDetail = textErr;
    }
    throw new Error(errorDetail || `Session join failed (${fallbackRes.status})`);
  } catch (err: any) {
    if (err?.message && (err.message.includes('Session') || err.message.includes('join failed'))) {
      throw err;
    }
    throw new Error('Unable to connect to session server. Ensure the RobotRisk backend is running on port 8000.');
  }
}

