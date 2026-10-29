import { randomBytes, randomInt } from 'node:crypto';
import type { GameConfig } from '@plague/engine';
import type { ServerMessage, TimerPreset } from '@plague/protocol';

/** One connected client. The transport adapter (Socket.IO, tests) implements this. */
export interface Connection {
  readonly id: string;
  send(message: ServerMessage): void;
}

export type TimerHandle = unknown;

/** Time source. Injected so tests can run a 2-hour room expiry in microseconds. */
export interface Scheduler {
  now(): number;
  setTimeout(fn: () => void, ms: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
}

export const realScheduler: Scheduler = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => {
    const handle = setTimeout(fn, ms);
    // A pending game timer must never keep the process alive on shutdown.
    handle.unref();
    return handle;
  },
  clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
};

/** Randomness source. Production uses the OS CSPRNG; tests inject a seeded one. */
export interface Random {
  /** Integer in [0, maxExclusive). */
  int(maxExclusive: number): number;
  /** `bytes` random bytes as a hex string. */
  hex(bytes: number): string;
}

export const cryptoRandom: Random = {
  int: (max) => randomInt(max),
  hex: (bytes) => randomBytes(bytes).toString('hex'),
};

export interface ServerConfig {
  maxPlayers: number;
  /** Fewest connected players to start. 5 by the rules; lower it (MIN_PLAYERS) to try the game alone. */
  minPlayers: number;
  maxSpectators: number;
  /** How often the game clock is advanced while a game runs. */
  tickMs: number;
  /** A room with nobody connected is deleted after this long. */
  roomExpiryMs: number;
  /** Create/join/rejoin attempts allowed per connection in `attemptWindowMs`. */
  maxAttempts: number;
  attemptWindowMs: number;
}

export const DEFAULT_CONFIG: ServerConfig = {
  maxPlayers: 10,
  minPlayers: 5,
  maxSpectators: 10,
  tickMs: 1000,
  roomExpiryMs: 2 * 60 * 60 * 1000,
  maxAttempts: 10,
  attemptWindowMs: 60_000,
};

/** Phase lengths per lobby preset. "standard" is the rules' 4 + 2 minutes. */
export const PRESET_CONFIG: Record<TimerPreset, GameConfig> = {
  quick: { dayMs: 120_000, nightMs: 60_000, summaryMs: 45_000, courtMs: 120_000 },
  standard: { dayMs: 240_000, nightMs: 120_000, summaryMs: 90_000, courtMs: 300_000 },
  long: { dayMs: 360_000, nightMs: 180_000, summaryMs: 120_000, courtMs: 300_000 },
};

export interface ServerDeps {
  scheduler: Scheduler;
  random: Random;
  config: ServerConfig;
}
