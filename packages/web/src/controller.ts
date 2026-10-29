import type { GameView, PlayerId } from '@plague/engine';
import type { ClientCommand, ClientEventName, RoomSettings, RoomStateData, ServerMessage, ServerPayloads } from '@plague/protocol';
import { detectLang, type Lang } from './i18n';
import type { KeyValueStore } from './net/storage';
import { createStore, type Store } from './store';

export type ConnStatus = 'connecting' | 'online' | 'offline';

export interface Toast {
  id: number;
  code: string;
  message: string;
}

export interface AppState {
  conn: ConnStatus;
  lang: Lang;
  nickname: string;
  /** Room code from an invitation link, to prefill the join form. */
  inviteCode: string;
  joined: ServerPayloads['room:joined'] | null;
  room: RoomStateData | null;
  view: GameView | null;
  /** Server clock minus this device's clock, from the latest snapshot. */
  clockOffset: number;
  /** Local time the latest view arrived, for the dice countdowns. */
  viewAt: number;
  toast: Toast | null;
  closed: 'kicked' | 'expired' | 'replaced' | null;
  rejoining: boolean;
}

export interface AppEnv {
  send: (event: ClientEventName, data?: unknown) => void;
  storage: KeyValueStore;
  now: () => number;
  setTimeout: (fn: () => void, ms: number) => unknown;
  /** Called after a room is joined or left, to tidy the address bar. */
  onUrlChange?: (code: string | null) => void;
  browserLanguage?: string;
  initialInvite?: string;
}

const KEY = { session: 'pl.session', nick: 'pl.nick', lang: 'pl.lang' } as const;
const TOAST_MS = 4500;

export class AppController {
  readonly store: Store<AppState>;
  private counter = 0;

  constructor(private readonly env: AppEnv) {
    this.store = createStore<AppState>({
      conn: 'connecting',
      lang: detectLang(env.storage.getItem(KEY.lang), env.browserLanguage),
      nickname: env.storage.getItem(KEY.nick) ?? '',
      inviteCode: (env.initialInvite ?? '').toUpperCase(),
      joined: null,
      room: null,
      view: null,
      clockOffset: 0,
      viewAt: 0,
      toast: null,
      closed: null,
      rejoining: false,
    });
  }

  // -------------------------------------------------------------------------
  // From the network
  // -------------------------------------------------------------------------

  handleStatus(status: ConnStatus): void {
    this.store.set({ conn: status });
    if (status !== 'online') return;
    // A new connection has no seat yet: claim the old one with the saved token.
    const saved = this.loadSession();
    if (saved) {
      this.store.set({ rejoining: true });
      this.env.send('room:rejoin', saved);
    }
  }

  handleMessage(message: ServerMessage): void {
    switch (message.event) {
      case 'room:joined': {
        const previous = this.store.get().joined;
        const sameSeat = previous?.selfId === message.data.selfId && previous.code === message.data.code;
        this.saveSession({ code: message.data.code, token: message.data.token });
        this.store.set({
          joined: message.data,
          rejoining: false,
          closed: null,
          inviteCode: '',
          ...(sameSeat ? {} : { view: null }),
        });
        this.env.onUrlChange?.(message.data.code);
        return;
      }
      case 'room:state':
        this.store.set({ room: message.data });
        return;
      case 'game:view': {
        const local = this.env.now();
        this.store.set({ view: message.data.view, clockOffset: message.data.now - local, viewAt: local });
        return;
      }
      case 'room:closed':
        this.clearRoom();
        this.store.set({ closed: message.data.reason });
        return;
      case 'error': {
        const { code, message: text } = message.data;
        if (this.store.get().rejoining && (code === 'bad_token' || code === 'room_not_found')) {
          this.clearRoom();
          this.store.set({ rejoining: false });
        }
        this.showToast(code, text);
        return;
      }
    }
  }

  // -------------------------------------------------------------------------
  // From the user
  // -------------------------------------------------------------------------

  setLang(lang: Lang): void {
    this.env.storage.setItem(KEY.lang, lang);
    this.store.set({ lang });
  }

  setNickname(nickname: string): void {
    this.env.storage.setItem(KEY.nick, nickname);
    this.store.set({ nickname });
  }

  createRoom(nickname: string): void {
    this.setNickname(nickname);
    this.env.send('room:create', { nickname });
  }

  joinRoom(code: string, nickname: string): void {
    this.setNickname(nickname);
    this.env.send('room:join', { code, nickname });
  }

  leaveRoom(): void {
    this.env.send('room:leave');
    this.clearRoom();
  }

  startGame(): void {
    this.env.send('lobby:start');
  }

  updateSettings(patch: Partial<RoomSettings>): void {
    this.env.send('lobby:settings', patch);
  }

  kick(playerId: PlayerId): void {
    this.env.send('room:kick', { playerId });
  }

  command(command: ClientCommand): void {
    this.env.send('game:command', { command });
  }

  playAgain(): void {
    this.env.send('room:playAgain');
  }

  dismissToast(): void {
    this.store.set({ toast: null });
  }

  dismissClosed(): void {
    this.store.set({ closed: null });
  }

  /** A server deadline (epoch ms on the server) in this device's clock. */
  localTime(serverTime: number): number {
    return serverTime - this.store.get().clockOffset;
  }

  // -------------------------------------------------------------------------

  private showToast(code: string, message: string): void {
    const toast: Toast = { id: ++this.counter, code, message };
    this.store.set({ toast });
    this.env.setTimeout(() => {
      if (this.store.get().toast?.id === toast.id) this.store.set({ toast: null });
    }, TOAST_MS);
  }

  private clearRoom(): void {
    this.env.storage.removeItem(KEY.session);
    this.store.set({ joined: null, room: null, view: null });
    this.env.onUrlChange?.(null);
  }

  private saveSession(session: { code: string; token: string }): void {
    this.env.storage.setItem(KEY.session, JSON.stringify(session));
  }

  private loadSession(): { code: string; token: string } | null {
    try {
      const raw = this.env.storage.getItem(KEY.session);
      if (!raw) return null;
      const parsed: unknown = JSON.parse(raw);
      if (
        typeof parsed === 'object' && parsed !== null &&
        typeof (parsed as Record<string, unknown>)['code'] === 'string' &&
        typeof (parsed as Record<string, unknown>)['token'] === 'string'
      ) {
        return parsed as { code: string; token: string };
      }
    } catch {
      // fall through
    }
    return null;
  }
}

/** Nickname for a participant id, with a harmless fallback. */
export function nameIn(room: RoomStateData | null, id: PlayerId): string {
  return room?.participants.find((p) => p.id === id)?.nickname ?? '…';
}
