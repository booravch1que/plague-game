import type { PlayerId } from '@plague/engine';
import { CODE_ALPHABET, CODE_LENGTH, parseClientMessage } from '@plague/protocol';
import {
  DEFAULT_CONFIG,
  cryptoRandom,
  realScheduler,
  type Connection,
  type ServerConfig,
  type ServerDeps,
} from './deps';
import { Room, type RoomResult } from './room';

interface ConnectionState {
  conn: Connection;
  binding: { room: Room; participantId: PlayerId } | null;
  /** Timestamps of recent create/join/rejoin attempts, for rate limiting. */
  attempts: number[];
}

export interface GameServerOptions {
  scheduler?: ServerDeps['scheduler'];
  random?: ServerDeps['random'];
  config?: Partial<ServerConfig>;
}

/**
 * Routes validated client messages to rooms. It owns the room registry and the
 * mapping from connections to seats, and nothing else: all game logic lives in
 * `Room` and the engine. A transport adapter only has to call `connect`,
 * `receive` and `disconnect`.
 */
export class GameServer {
  private readonly deps: ServerDeps;
  private readonly rooms = new Map<string, Room>();
  private readonly connections = new Map<string, ConnectionState>();

  constructor(options: GameServerOptions = {}) {
    this.deps = {
      scheduler: options.scheduler ?? realScheduler,
      random: options.random ?? cryptoRandom,
      config: { ...DEFAULT_CONFIG, ...options.config },
    };
  }

  get roomCount(): number {
    return this.rooms.size;
  }

  connect(conn: Connection): void {
    this.connections.set(conn.id, { conn, binding: null, attempts: [] });
  }

  disconnect(connectionId: string): void {
    const state = this.connections.get(connectionId);
    if (!state) return;
    if (state.binding) state.binding.room.detach(state.binding.participantId, state.conn);
    this.connections.delete(connectionId);
  }

  /** Entry point for every raw message from a client. Never throws on bad input. */
  receive(connectionId: string, event: unknown, payload: unknown): void {
    const state = this.connections.get(connectionId);
    if (!state) return;

    const parsed = parseClientMessage(event, payload);
    if (!parsed.ok) return this.reply(state, { ok: false, code: 'invalid_payload', message: parsed.error });
    const message = parsed.value;

    const bound = state.binding;
    switch (message.event) {
      case 'room:create': {
        const early = this.guardAttempt(state);
        if (early) return this.reply(state, early);
        const room = this.createRoom();
        const result = room.join(state.conn, message.data.nickname);
        return this.reply(state, result);
      }
      case 'room:join': {
        const early = this.guardAttempt(state);
        if (early) return this.reply(state, early);
        const room = this.rooms.get(message.data.code);
        if (!room) return this.reply(state, { ok: false, code: 'room_not_found', message: 'No room has that code.' });
        return this.reply(state, room.join(state.conn, message.data.nickname));
      }
      case 'room:rejoin': {
        const early = this.guardAttempt(state);
        if (early) return this.reply(state, early);
        const room = this.rooms.get(message.data.code);
        if (!room) return this.reply(state, { ok: false, code: 'room_not_found', message: 'That room no longer exists.' });
        return this.reply(state, room.rejoin(state.conn, message.data.token));
      }
    }

    if (!bound) return this.reply(state, { ok: false, code: 'not_in_room', message: 'Join a room first.' });
    const { room, participantId } = bound;

    switch (message.event) {
      case 'room:leave':
        return this.reply(state, room.leave(participantId));
      case 'lobby:settings':
        return this.reply(state, room.updateSettings(participantId, message.data));
      case 'lobby:start':
        return this.reply(state, room.start(participantId));
      case 'room:kick':
        return this.reply(state, room.kick(participantId, message.data.playerId));
      case 'game:command':
        return this.reply(state, room.command(participantId, message.data.command));
      case 'room:playAgain':
        return this.reply(state, room.playAgain(participantId));
    }
  }

  // -------------------------------------------------------------------------

  private reply(state: ConnectionState, result: RoomResult): void {
    if (!result.ok) {
      state.conn.send({ event: 'error', data: { code: result.code, message: result.message } });
    }
  }

  /** Allows a limited number of join-type attempts per connection per minute. */
  private guardAttempt(state: ConnectionState): RoomResult | null {
    if (state.binding) return { ok: false, code: 'already_in_room', message: 'Leave your current room first.' };
    const { maxAttempts, attemptWindowMs } = this.deps.config;
    const now = this.deps.scheduler.now();
    state.attempts = state.attempts.filter((t) => now - t < attemptWindowMs);
    if (state.attempts.length >= maxAttempts) {
      return { ok: false, code: 'rate_limited', message: 'Too many attempts. Wait a moment.' };
    }
    state.attempts.push(now);
    return null;
  }

  private createRoom(): Room {
    const { random } = this.deps;
    let code = '';
    do {
      code = Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[random.int(CODE_ALPHABET.length)]).join('');
    } while (this.rooms.has(code));

    const room: Room = new Room(code, this.deps, {
      bind: (conn, participantId) => {
        const s = this.connections.get(conn.id);
        if (s) s.binding = { room, participantId };
      },
      unbind: (conn) => {
        const s = this.connections.get(conn.id);
        if (s && s.binding?.room === room) s.binding = null;
      },
      destroy: () => {
        this.rooms.delete(code);
        room.dispose('expired');
      },
    });
    this.rooms.set(code, room);
    return room;
  }
}
