import assert from 'node:assert/strict';
import type { GameView, PlayerId } from '@plague/engine';
import type {
  ClientCommand,
  ClientEventName,
  ClientPayloads,
  RoomStateData,
  ServerMessage,
  ServerPayloads,
  TimerPreset,
} from '@plague/protocol';
import { GameServer, type Connection, type Random, type Scheduler, type ServerConfig } from '../src';

// ---------------------------------------------------------------------------
// Deterministic time and randomness
// ---------------------------------------------------------------------------

export class FakeScheduler implements Scheduler {
  private time = 1_000_000;
  private nextId = 1;
  private readonly timers = new Map<number, { at: number; fn: () => void }>();

  now(): number {
    return this.time;
  }
  setTimeout(fn: () => void, ms: number): number {
    const id = this.nextId++;
    this.timers.set(id, { at: this.time + ms, fn });
    return id;
  }
  clearTimeout(handle: unknown): void {
    this.timers.delete(handle as number);
  }
  /** Moves the clock forward, firing every timer that falls due, in order. */
  advance(ms: number): void {
    const target = this.time + ms;
    for (;;) {
      let next: [number, { at: number; fn: () => void }] | undefined;
      for (const entry of this.timers) {
        if (entry[1].at <= target && (!next || entry[1].at < next[1].at)) next = entry;
      }
      if (!next) break;
      this.timers.delete(next[0]);
      this.time = Math.max(this.time, next[1].at);
      next[1].fn();
    }
    this.time = target;
  }
  get pending(): number {
    return this.timers.size;
  }
}

export function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededRandom(seed: number): Random {
  const next = mulberry(seed);
  return {
    int: (max) => Math.floor(next() * max),
    hex: (bytes) => Array.from({ length: bytes }, () => Math.floor(next() * 256).toString(16).padStart(2, '0')).join(''),
  };
}

// ---------------------------------------------------------------------------
// In-memory client
// ---------------------------------------------------------------------------

let connCounter = 0;

export class Client {
  readonly id = `conn-${++connCounter}`;
  readonly messages: ServerMessage[] = [];
  private connected = true;

  constructor(readonly server: GameServer) {
    const conn: Connection = { id: this.id, send: (m) => void this.messages.push(structuredClone(m)) };
    server.connect(conn);
  }

  send<E extends ClientEventName>(event: E, data?: ClientPayloads[E]): this {
    this.server.receive(this.id, event, data);
    return this;
  }
  /** Sends a raw, possibly malformed message. */
  raw(event: unknown, payload: unknown): this {
    this.server.receive(this.id, event, payload);
    return this;
  }
  command(command: ClientCommand): this {
    return this.send('game:command', { command });
  }
  disconnect(): void {
    if (!this.connected) return;
    this.connected = false;
    this.server.disconnect(this.id);
  }

  all<E extends keyof ServerPayloads>(event: E): ServerPayloads[E][] {
    return this.messages.filter((m) => m.event === event).map((m) => m.data as ServerPayloads[E]);
  }
  last<E extends keyof ServerPayloads>(event: E): ServerPayloads[E] | undefined {
    return this.all(event).at(-1);
  }

  get joined(): ServerPayloads['room:joined'] {
    const joined = this.last('room:joined');
    assert.ok(joined, 'client has not joined a room');
    return joined;
  }
  get selfId(): PlayerId {
    return this.joined.selfId;
  }
  get room(): RoomStateData {
    const room = this.last('room:state');
    assert.ok(room, 'no room state yet');
    return room;
  }
  get view(): GameView {
    const v = this.last('game:view');
    assert.ok(v, 'no game view yet');
    return v.view;
  }
  get errors(): ServerPayloads['error'][] {
    return this.all('error');
  }
  get lastError(): ServerPayloads['error'] | undefined {
    return this.errors.at(-1);
  }
  /** Forget everything received so far (to assert on what happens next). */
  clear(): void {
    this.messages.length = 0;
  }
}

export interface Setup {
  server: GameServer;
  sched: FakeScheduler;
  clients: Client[];
  code: string;
}

export interface SetupOptions {
  preset?: TimerPreset;
  seed?: number;
  start?: boolean;
  config?: Partial<ServerConfig>;
}

export function setup(playerCount: number, options: SetupOptions = {}): Setup {
  const sched = new FakeScheduler();
  const server = new GameServer({ scheduler: sched, random: seededRandom(options.seed ?? 1), config: options.config });
  const host = new Client(server);
  host.send('room:create', { nickname: 'Host' });
  const code = host.joined.code;
  const clients = [host];
  for (let i = 1; i < playerCount; i++) {
    const c = new Client(server);
    c.send('room:join', { code, nickname: `Player${i}` });
    clients.push(c);
  }
  if (options.preset) host.send('lobby:settings', { timerPreset: options.preset });
  if (options.start ?? true) host.send('lobby:start');
  return { server, sched, clients, code };
}
