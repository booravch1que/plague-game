import type { GameServer } from './game-server';

/**
 * The few things of a Socket.IO socket the game needs. Declared here (instead of
 * importing Socket.IO's types) so the adapter can be tested without the library
 * and the game core never depends on a particular transport.
 */
export interface SocketLike {
  readonly id: string;
  readonly handshake: { address?: string; headers?: Record<string, string | string[] | undefined> };
  emit(event: string, data: unknown): void;
  disconnect(close?: boolean): void;
  on(event: 'disconnect', listener: () => void): unknown;
  onAny(listener: (event: string, ...args: unknown[]) => void): unknown;
}

export interface IoLike {
  on(event: 'connection', listener: (socket: SocketLike) => void): unknown;
}

export interface AdapterOptions {
  /** Trust the X-Forwarded-For header (set this when running behind a reverse proxy). */
  trustProxy?: boolean;
  /** Simultaneous connections allowed from one IP address. */
  maxConnectionsPerIp?: number;
  /** Messages a single socket may burst, refilled at `messagesPerSecond`. */
  burst?: number;
  messagesPerSecond?: number;
  now?: () => number;
}

export function clientIp(socket: SocketLike, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = socket.handshake.headers?.['x-forwarded-for'];
    const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
    if (first) return first;
  }
  return socket.handshake.address ?? 'unknown';
}

/**
 * Connects a Socket.IO server to the game. Every message from a socket is handed to
 * `GameServer.receive`, which validates it. Floods are cut off here: a socket that
 * exceeds its message budget is disconnected, and one IP address can only hold a
 * limited number of connections.
 */
export function attachSocketTransport(io: IoLike, game: GameServer, options: AdapterOptions = {}): void {
  const trustProxy = options.trustProxy ?? false;
  const maxPerIp = options.maxConnectionsPerIp ?? 30;
  const burst = options.burst ?? 40;
  const perSecond = options.messagesPerSecond ?? 20;
  const now = options.now ?? Date.now;
  const perIp = new Map<string, number>();

  io.on('connection', (socket) => {
    const ip = clientIp(socket, trustProxy);
    const open = perIp.get(ip) ?? 0;
    if (open >= maxPerIp) {
      socket.disconnect(true);
      return;
    }
    perIp.set(ip, open + 1);

    let tokens = burst;
    let last = now();

    game.connect({
      id: socket.id,
      send: (message) => socket.emit(message.event, message.data),
    });

    socket.onAny((event, ...args) => {
      const t = now();
      tokens = Math.min(burst, tokens + ((t - last) / 1000) * perSecond);
      last = t;
      if (tokens < 1) {
        socket.disconnect(true);
        return;
      }
      tokens -= 1;
      // Only the first argument is a payload; acknowledgement callbacks are ignored.
      game.receive(socket.id, event, args[0]);
    });

    socket.on('disconnect', () => {
      game.disconnect(socket.id);
      const left = (perIp.get(ip) ?? 1) - 1;
      if (left <= 0) perIp.delete(ip);
      else perIp.set(ip, left);
    });
  });
}
