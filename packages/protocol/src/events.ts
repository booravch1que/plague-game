import type { GameView, PlayerCommand, PlayerId } from '@plague/engine';

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

export const TIMER_PRESETS = ['quick', 'standard', 'long'] as const;
export type TimerPreset = (typeof TIMER_PRESETS)[number];

export const NICKNAME_MIN = 2;
export const NICKNAME_MAX = 16;
export const CHAT_MAX = 300;

/** Room codes avoid look-alike characters: no I, L, O, 0 or 1. */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 5;

// ---------------------------------------------------------------------------
// Client -> server
// ---------------------------------------------------------------------------

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

/**
 * A player's move. It deliberately has no `playerId`: the server always uses the
 * identity bound to the connection, so a client can never act for someone else.
 */
export type ClientCommand = DistributiveOmit<PlayerCommand, 'playerId'>;

export interface ClientPayloads {
  'room:create': { nickname: string };
  'room:join': { code: string; nickname: string };
  'room:rejoin': { code: string; token: string };
  'room:leave': Record<string, never>;
  'lobby:settings': { timerPreset?: TimerPreset; allowSpectators?: boolean };
  'lobby:start': Record<string, never>;
  'room:kick': { playerId: PlayerId };
  'game:command': { command: ClientCommand };
  'room:playAgain': Record<string, never>;
}

export type ClientEventName = keyof ClientPayloads;

export type ClientMessage = {
  [E in ClientEventName]: { event: E; data: ClientPayloads[E] };
}[ClientEventName];

// ---------------------------------------------------------------------------
// Server -> client
// ---------------------------------------------------------------------------

export type RoomStatus = 'lobby' | 'playing' | 'ended';
export type ParticipantKind = 'player' | 'spectator';

export interface RoomSettings {
  timerPreset: TimerPreset;
  allowSpectators: boolean;
}

export interface PublicParticipant {
  id: PlayerId;
  nickname: string;
  kind: ParticipantKind;
  connected: boolean;
  /** Pressed "Play again" after a game. */
  ready: boolean;
  isHost: boolean;
}

export interface RoomStateData {
  code: string;
  status: RoomStatus;
  hostId: PlayerId;
  settings: RoomSettings;
  participants: PublicParticipant[];
  /** Fewest players needed to start. */
  minPlayers: number;
  maxPlayers: number;
}

export interface ServerPayloads {
  /** Sent to the connection that just created, joined or rejoined a room. */
  'room:joined': {
    code: string;
    /** Secret. Store it in the browser to get the same seat back after a refresh. */
    token: string;
    selfId: PlayerId;
    kind: ParticipantKind;
  };
  'room:state': RoomStateData;
  /** Full snapshot for this viewer. Safe to render without any earlier message. */
  'game:view': {
    view: GameView;
    /** The server's clock when this was sent. Clients use it to correct for clock drift. */
    now: number;
  };
  /** The room is gone for this connection (kicked, expired). */
  'room:closed': { reason: 'kicked' | 'expired' | 'replaced' };
  error: { code: string; message: string };
}

export type ServerEventName = keyof ServerPayloads;

export type ServerMessage = {
  [E in ServerEventName]: { event: E; data: ServerPayloads[E] };
}[ServerEventName];

export const SERVER_EVENTS = [
  'room:joined',
  'room:state',
  'game:view',
  'room:closed',
  'error',
] as const satisfies readonly ServerEventName[];
