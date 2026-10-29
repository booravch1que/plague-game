import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { Server as SocketServer } from 'socket.io';
import { attachSocketTransport, type IoLike } from './adapter';
import { GameServer } from './game-server';
import { createHttpHandler } from './http';

/**
 * Production entry point: one process serves the built web client and the game
 * sockets. Configuration comes from environment variables (see .env.example).
 */
const port = Number(process.env['PORT'] ?? 3000);
const host = process.env['HOST'] ?? '0.0.0.0';
const trustProxy = /^(1|true|yes)$/i.test(process.env['TRUST_PROXY'] ?? '');
const webDir = process.env['WEB_DIR'] ?? fileURLToPath(new URL('../../web/dist', import.meta.url));
// Comma-separated list of extra origins allowed to open sockets (needed only when the
// web client is hosted on a different origin than this server).
const extraOrigins = (process.env['ALLOWED_ORIGINS'] ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const minPlayers = Number(process.env['MIN_PLAYERS'] ?? '');
const game = new GameServer(Number.isInteger(minPlayers) && minPlayers >= 1 ? { config: { minPlayers } } : {});
const handler = createHttpHandler({ webDir, roomCount: () => game.roomCount });
const httpServer = createServer((req, res) => void handler(req, res));

const io = new SocketServer(httpServer, {
  serveClient: false,
  // Messages are tiny JSON objects. Anything bigger is abuse.
  maxHttpBufferSize: 16 * 1024,
  pingInterval: 20_000,
  pingTimeout: 20_000,
  cors: extraOrigins.length > 0 ? { origin: extraOrigins } : undefined,
});
attachSocketTransport(io as unknown as IoLike, game, { trustProxy });

httpServer.listen(port, host, () => {
  console.log(`Plague listening on http://${host}:${port}  (serving ${webDir})`);
});

function shutdown(signal: string): void {
  console.log(`${signal} received, shutting down`);
  void io.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
