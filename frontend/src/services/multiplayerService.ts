import { MultiplayerMessage, MultiplayerMessageType, UserRole } from '../types/multiplayer';

export type MessageHandler = (msg: MultiplayerMessage) => void;
export type StatusHandler = (status: 'connected' | 'connecting' | 'disconnected' | 'reconnecting', latencyMs: number) => void;

class MultiplayerService {
  private ws: WebSocket | null = null;
  private sessionId: string | null = null;
  private clientId: string | null = null;
  private role: UserRole = 'operator';
  private onMessageCallback: MessageHandler | null = null;
  private onStatusCallback: StatusHandler | null = null;
  private pingInterval: any = null;
  private reconnectTimeout: any = null;
  private shouldReconnect: boolean = true;
  private lastPingSentTime: number = 0;
  private latencyMs: number = 0;

  public connect(
    sessionId: string,
    clientId: string,
    role: UserRole,
    onMessage: MessageHandler,
    onStatus: StatusHandler
  ) {
    this.sessionId = (sessionId || '').trim().toUpperCase();
    this.clientId = clientId;
    this.role = role;
    this.onMessageCallback = onMessage;
    this.onStatusCallback = onStatus;
    this.shouldReconnect = true;

    this.initSocket();
  }

  private initSocket() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.onStatusCallback?.('connecting', this.latencyMs);

    // Determine host: default to 127.0.0.1:8000 for backend
    const host = window.location.hostname || '127.0.0.1';
    const wsUrl = `ws://${host}:8000/ws/session/${this.sessionId}/${this.clientId}`;

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.onStatusCallback?.('connected', this.latencyMs);
        this.startHeartbeat();
      };

      this.ws.onmessage = (event) => {
        try {
          const data: MultiplayerMessage = JSON.parse(event.data);

          if (data.type === 'pong') {
            const now = Date.now();
            this.latencyMs = Math.max(1, now - this.lastPingSentTime);
            this.onStatusCallback?.('connected', this.latencyMs);
            return;
          }

          this.onMessageCallback?.(data);
        } catch (err) {
          console.error('[MULTIPLAYER] Failed to parse incoming WebSocket message:', err);
        }
      };

      this.ws.onclose = () => {
        this.stopHeartbeat();
        this.onStatusCallback?.('disconnected', this.latencyMs);

        if (this.shouldReconnect) {
          this.onStatusCallback?.('reconnecting', this.latencyMs);
          this.reconnectTimeout = setTimeout(() => {
            if (this.shouldReconnect) {
              this.initSocket();
            }
          }, 2000);
        }
      };

      this.ws.onerror = (err) => {
        console.warn('[MULTIPLAYER] WebSocket connection error:', err);
        this.ws?.close();
      };
    } catch (e) {
      console.error('[MULTIPLAYER] WebSocket initialization exception:', e);
      this.onStatusCallback?.('disconnected', this.latencyMs);
    }
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.lastPingSentTime = Date.now();
        this.send('ping', { clientTime: this.lastPingSentTime });
      }
    }, 4000);
  }

  private stopHeartbeat() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  public send(type: MultiplayerMessageType, payload: any = {}): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return false;
    }

    const message: MultiplayerMessage = {
      type,
      sessionId: this.sessionId || '',
      clientId: this.clientId || '',
      role: this.role,
      timestamp: Date.now(),
      eventId: `ev-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      payload,
    };

    try {
      this.ws.send(JSON.stringify(message));
      return true;
    } catch (err) {
      console.error('[MULTIPLAYER] Error sending message:', err);
      return false;
    }
  }

  public disconnect() {
    this.shouldReconnect = false;
    this.stopHeartbeat();
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.sessionId = null;
    this.clientId = null;
    this.onStatusCallback?.('disconnected', 0);
  }

  public isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  public getLatency(): number {
    return this.latencyMs;
  }

  public getSessionId(): string | null {
    return this.sessionId;
  }

  public getClientId(): string | null {
    return this.clientId;
  }

  public getRole(): UserRole {
    return this.role;
  }

  public setRole(role: UserRole) {
    this.role = role;
  }
}

export const multiplayerService = new MultiplayerService();
