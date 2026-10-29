import {
  createGame,
  projectView,
  reduce,
  type Command,
  type GameState,
  type PlayerCommand,
  type PlayerId,
} from '@plague/engine';
import type {
  ClientCommand,
  ParticipantKind,
  PublicParticipant,
  RoomSettings,
  RoomStateData,
  RoomStatus,
  ServerMessage,
} from '@plague/protocol';
import { PRESET_CONFIG, type Connection, type ServerDeps, type TimerHandle } from './deps';

export type RoomResult = { ok: true } | { ok: false; code: string; message: string };
const OK: RoomResult = { ok: true };
const fail = (code: string, message: string): RoomResult => ({ ok: false, code, message });

interface Participant {
  id: PlayerId;
  /** Secret that proves ownership of this seat after a reconnect. */
  token: string;
  nickname: string;
  kind: ParticipantKind;
  conn: Connection | null;
  connectedSince: number | null;
  ready: boolean;
}

/** What a room needs from the server that owns it. */
export interface RoomHooks {
  bind(conn: Connection, participantId: PlayerId): void;
  unbind(conn: Connection): void;
  destroy(): void;
}

/**
 * One game room: lobby, seating, the authoritative game state, the clock tick and
 * the per-viewer snapshots. It talks to clients only through `Connection.send`, so
 * it knows nothing about sockets. Everything runs synchronously on one thread.
 */
export class Room {
  status: RoomStatus = 'lobby';
  settings: RoomSettings = { timerPreset: 'standard', allowSpectators: true };

  private readonly participants = new Map<PlayerId, Participant>();
  private readonly byToken = new Map<string, PlayerId>();
  private hostId: PlayerId = '';
  private game: GameState | null = null;
  /** Game revision each participant last received, so idle ticks send nothing. */
  private readonly sentRev = new Map<PlayerId, number>();
  private ticker: TimerHandle | null = null;
  private expiry: TimerHandle | null = null;

  constructor(
    readonly code: string,
    private readonly deps: ServerDeps,
    private readonly hooks: RoomHooks,
  ) {}

  // -------------------------------------------------------------------------
  // Joining, leaving, reconnecting
  // -------------------------------------------------------------------------

  join(conn: Connection, nickname: string): RoomResult {
    const wanted = nickname.toLowerCase();
    for (const p of this.participants.values()) {
      if (p.nickname.toLowerCase() === wanted) return fail('nickname_taken', 'That nickname is already used in this room.');
    }

    const { maxPlayers, maxSpectators } = this.deps.config;
    let kind: ParticipantKind;
    if (this.status === 'lobby' && this.count('player') < maxPlayers) {
      kind = 'player';
    } else if (!this.settings.allowSpectators) {
      return fail(this.status === 'lobby' ? 'room_full' : 'spectators_disabled', 'You cannot join this room right now.');
    } else if (this.count('spectator') >= maxSpectators) {
      return fail('spectators_full', 'This room has no space left for spectators.');
    } else {
      kind = 'spectator';
    }

    const participant: Participant = {
      id: this.deps.random.hex(6),
      token: this.deps.random.hex(24),
      nickname,
      kind,
      conn: null,
      connectedSince: null,
      ready: false,
    };
    this.participants.set(participant.id, participant);
    this.byToken.set(participant.token, participant.id);
    if (this.hostId === '') this.hostId = participant.id;

    this.attach(participant, conn);
    this.welcome(participant);
    return OK;
  }

  rejoin(conn: Connection, token: string): RoomResult {
    const id = this.byToken.get(token);
    const participant = id === undefined ? undefined : this.participants.get(id);
    if (!participant) return fail('bad_token', 'That seat is no longer available.');

    const old = participant.conn;
    if (old && old !== conn) {
      old.send({ event: 'room:closed', data: { reason: 'replaced' } });
      this.hooks.unbind(old);
    }
    this.attach(participant, conn);
    this.welcome(participant);
    return OK;
  }

  /** The connection dropped. The seat is kept so a refresh or reconnect gets it back. */
  detach(participantId: PlayerId, conn: Connection): void {
    const p = this.participants.get(participantId);
    if (!p || p.conn !== conn) return; // already replaced by a newer connection
    p.conn = null;
    p.connectedSince = null;
    this.hooks.unbind(conn);
    if (this.hostId === p.id) this.migrateHost();
    this.afterPresenceChange();
  }

  /** The participant chose to leave for good. */
  leave(participantId: PlayerId): RoomResult {
    if (!this.participants.has(participantId)) return fail('not_in_room', 'You are not in this room.');
    this.remove(participantId);
    return OK;
  }

  kick(requesterId: PlayerId, targetId: PlayerId): RoomResult {
    if (requesterId !== this.hostId) return fail('not_host', 'Only the host can remove players.');
    const target = this.participants.get(targetId);
    if (!target || targetId === requesterId) return fail('invalid_target', 'You cannot remove that participant.');
    if (this.status === 'playing' && target.kind === 'player' && this.isAlive(target.id) && target.conn !== null) {
      return fail('not_allowed', 'Only disconnected players can be removed during a game.');
    }
    this.remove(targetId, 'kicked');
    return OK;
  }

  private remove(id: PlayerId, notify?: 'kicked'): void {
    const p = this.participants.get(id);
    if (!p) return;

    const conn = p.conn;
    p.conn = null;
    p.connectedSince = null;
    if (conn) {
      if (notify) conn.send({ event: 'room:closed', data: { reason: notify } });
      this.hooks.unbind(conn);
    }

    if (this.status === 'playing' && p.kind === 'player' && this.isAlive(id)) this.apply({ type: 'forfeit', playerId: id });

    this.participants.delete(id);
    this.byToken.delete(p.token);
    this.sentRev.delete(id);
    if (this.hostId === id) {
      this.hostId = '';
      this.migrateHost();
    }
    if (this.participants.size === 0) {
      this.hooks.destroy();
      return;
    }
    this.afterPresenceChange();
  }

  // -------------------------------------------------------------------------
  // Lobby
  // -------------------------------------------------------------------------

  updateSettings(requesterId: PlayerId, patch: Partial<RoomSettings>): RoomResult {
    if (requesterId !== this.hostId) return fail('not_host', 'Only the host can change settings.');
    if (this.status === 'playing') return fail('wrong_status', 'Settings cannot change during a game.');
    this.settings = { ...this.settings, ...patch };
    this.broadcastState();
    return OK;
  }

  start(requesterId: PlayerId): RoomResult {
    if (requesterId !== this.hostId) return fail('not_host', 'Only the host can start the game.');
    if (this.status === 'playing') return fail('wrong_status', 'A game is already running.');
    return this.beginGame();
  }

  /** After a game: ask for a rematch. When everybody present is ready it starts by itself. */
  playAgain(participantId: PlayerId): RoomResult {
    const p = this.participants.get(participantId);
    if (!p) return fail('not_in_room', 'You are not in this room.');
    if (this.status !== 'ended') return fail('wrong_status', 'There is no finished game to replay.');
    if (p.kind === 'spectator') {
      if (this.count('player') >= this.deps.config.maxPlayers) return fail('room_full', 'All seats are taken.');
      p.kind = 'player';
    }
    p.ready = true;

    const present = this.connectedPlayers();
    if (present.length >= this.deps.config.minPlayers && present.every((x) => x.ready)) return this.beginGame();
    this.broadcastState();
    return OK;
  }

  private beginGame(): RoomResult {
    const rematch = this.status === 'ended';
    const seated = this.connectedPlayers().filter((p) => !rematch || p.ready);
    const { minPlayers, maxPlayers } = this.deps.config;
    if (seated.length < minPlayers) return fail('not_enough_players', `At least ${minPlayers} connected players are needed.`);
    seated.splice(maxPlayers);

    // Everyone who is not playing watches. Disconnected seats are released.
    for (const p of [...this.participants.values()]) {
      if (seated.includes(p)) continue;
      if (p.conn === null && p.kind === 'player') {
        this.participants.delete(p.id);
        this.byToken.delete(p.token);
      } else {
        p.kind = 'spectator';
      }
    }
    for (const p of seated) p.ready = false;
    if (!this.participants.has(this.hostId)) this.migrateHost();

    this.game = createGame({
      playerIds: seated.map((p) => p.id),
      seed: this.deps.random.int(2 ** 32),
      now: this.deps.scheduler.now(),
      config: PRESET_CONFIG[this.settings.timerPreset],
    });
    this.status = 'playing';
    this.sentRev.clear();
    this.startTicker();
    this.broadcastState();
    this.sendViews(true);
    return OK;
  }

  // -------------------------------------------------------------------------
  // Playing
  // -------------------------------------------------------------------------

  command(participantId: PlayerId, command: ClientCommand): RoomResult {
    const p = this.participants.get(participantId);
    if (!p || p.kind !== 'player' || this.status !== 'playing' || !this.game) {
      return fail('not_allowed', 'You are not playing in a running game.');
    }
    // The identity always comes from the connection, never from the client.
    return this.apply({ ...command, playerId: p.id } as PlayerCommand);
  }

  private apply(command: Command): RoomResult {
    if (!this.game) return fail('not_allowed', 'No game is running.');
    const result = reduce(this.game, command, this.deps.scheduler.now());
    if (!result.ok) return fail(result.error.code, result.error.message);
    this.commit(result.state);
    return OK;
  }

  private commit(state: GameState): void {
    this.game = state;
    if (state.phase.kind === 'over' && this.status === 'playing') {
      this.status = 'ended';
      this.stopTicker();
      for (const p of this.participants.values()) p.ready = false;
      this.broadcastState();
    }
    this.sendViews(false);
  }

  private startTicker(): void {
    this.stopTicker();
    const loop = () => {
      this.ticker = this.deps.scheduler.setTimeout(() => {
        this.ticker = null;
        if (this.status !== 'playing') return;
        this.apply({ type: 'tick' });
        if (this.status === 'playing') loop();
      }, this.deps.config.tickMs);
    };
    loop();
  }

  private stopTicker(): void {
    if (this.ticker !== null) this.deps.scheduler.clearTimeout(this.ticker);
    this.ticker = null;
  }

  // -------------------------------------------------------------------------
  // Presence, host, expiry
  // -------------------------------------------------------------------------

  private attach(p: Participant, conn: Connection): void {
    p.conn = conn;
    p.connectedSince = this.deps.scheduler.now();
    this.hooks.bind(conn, p.id);
    this.clearExpiry();
  }

  private welcome(p: Participant): void {
    this.send(p, { event: 'room:joined', data: { code: this.code, token: p.token, selfId: p.id, kind: p.kind } });
    this.broadcastState();
    this.sentRev.delete(p.id);
    this.sendView(p, true);
  }

  /** Host rights go to the longest-connected player (spectators only if no player is connected). */
  private migrateHost(): void {
    const current = this.participants.get(this.hostId);
    if (current?.conn) return;
    const longest = (list: Participant[]) =>
      list.filter((p) => p.conn !== null).sort((a, b) => (a.connectedSince ?? 0) - (b.connectedSince ?? 0))[0];
    const all = [...this.participants.values()];
    const next = longest(all.filter((p) => p.kind === 'player')) ?? longest(all);
    if (next) this.hostId = next.id;
  }

  private afterPresenceChange(): void {
    if (this.connectedAll().length === 0) this.scheduleExpiry();
    this.broadcastState();
  }

  private scheduleExpiry(): void {
    if (this.expiry !== null) return;
    this.expiry = this.deps.scheduler.setTimeout(() => {
      this.expiry = null;
      this.hooks.destroy();
    }, this.deps.config.roomExpiryMs);
  }

  private clearExpiry(): void {
    if (this.expiry !== null) this.deps.scheduler.clearTimeout(this.expiry);
    this.expiry = null;
  }

  /** Stops all timers and releases every connection. Called by the owner when the room is deleted. */
  dispose(reason: 'expired' | null = null): void {
    this.stopTicker();
    this.clearExpiry();
    for (const p of this.participants.values()) {
      if (!p.conn) continue;
      if (reason) p.conn.send({ event: 'room:closed', data: { reason } });
      this.hooks.unbind(p.conn);
      p.conn = null;
    }
  }

  // -------------------------------------------------------------------------
  // Output
  // -------------------------------------------------------------------------

  private roomState(): RoomStateData {
    const participants: PublicParticipant[] = [...this.participants.values()].map((p) => ({
      id: p.id,
      nickname: p.nickname,
      kind: p.kind,
      connected: p.conn !== null,
      ready: p.ready,
      isHost: p.id === this.hostId,
    }));
    const { minPlayers, maxPlayers } = this.deps.config;
    return { code: this.code, status: this.status, hostId: this.hostId, settings: { ...this.settings }, participants, minPlayers, maxPlayers };
  }

  private broadcastState(): void {
    this.sendAll({ event: 'room:state', data: this.roomState() });
  }

  private sendViews(force: boolean): void {
    for (const p of this.participants.values()) this.sendView(p, force);
  }

  /** Sends a fresh snapshot, but only when something visible changed since the last one. */
  private sendView(p: Participant, force: boolean): void {
    if (!this.game || !p.conn) return;
    if (!force && this.sentRev.get(p.id) === this.game.rev) return;
    this.sentRev.set(p.id, this.game.rev);
    const now = this.deps.scheduler.now();
    const view = projectView(this.game, p.kind === 'player' ? p.id : null, now);
    this.send(p, { event: 'game:view', data: { view, now } });
  }

  private send(p: Participant, message: ServerMessage): void {
    p.conn?.send(message);
  }

  private sendAll(message: ServerMessage): void {
    for (const p of this.participants.values()) this.send(p, message);
  }

  // -------------------------------------------------------------------------
  // Small helpers
  // -------------------------------------------------------------------------

  private count(kind: ParticipantKind): number {
    let n = 0;
    for (const p of this.participants.values()) if (p.kind === kind) n += 1;
    return n;
  }

  private connectedAll(): Participant[] {
    return [...this.participants.values()].filter((p) => p.conn !== null);
  }

  private connectedPlayers(): Participant[] {
    return this.connectedAll().filter((p) => p.kind === 'player');
  }

  private isAlive(id: PlayerId): boolean {
    return this.game?.players.find((x) => x.id === id)?.status === 'alive';
  }

  /** Number of participants, for the server's bookkeeping. */
  get size(): number {
    return this.participants.size;
  }
}
