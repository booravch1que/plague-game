import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

/** Same-origin only, no framing, no third-party loads. The game uses system fonts and inline SVG. */
export const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
    "connect-src 'self' ws: wss:; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

export interface HttpHandlerOptions {
  /** Directory with the built web client. */
  webDir: string;
  /** Used by /healthz. */
  roomCount: () => number;
}

/**
 * Serves the built client, a health check, and falls back to index.html for client-side
 * routes. Paths are resolved inside `webDir` only.
 */
export function createHttpHandler(options: HttpHandlerOptions) {
  const root = resolve(options.webDir);

  async function send(res: ServerResponse, file: string, status = 200): Promise<void> {
    const info = await stat(file);
    const ext = extname(file).toLowerCase();
    const immutable = file.includes(`${sep}assets${sep}`) && ext !== '.html';
    res.writeHead(status, {
      ...SECURITY_HEADERS,
      'Content-Type': TYPES[ext] ?? 'application/octet-stream',
      'Content-Length': info.size,
      'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    createReadStream(file).pipe(res);
  }

  function plain(res: ServerResponse, status: number, body: string, extra: Record<string, string> = {}): void {
    res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8', ...extra });
    res.end(body);
  }

  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return plain(res, 405, 'Method Not Allowed', { Allow: 'GET, HEAD' });
      }
      let pathname: string;
      try {
        pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
      } catch {
        return plain(res, 400, 'Bad Request');
      }
      if (pathname.includes('\0')) return plain(res, 400, 'Bad Request');

      if (pathname === '/healthz') {
        res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        return void res.end(JSON.stringify({ ok: true, rooms: options.roomCount() }));
      }

      const target = resolve(join(root, normalize(pathname)));
      if (target !== root && !target.startsWith(root + sep)) return plain(res, 403, 'Forbidden');

      try {
        const info = await stat(target);
        if (info.isFile()) return await send(res, target);
        if (info.isDirectory()) return await send(res, join(target, 'index.html'));
      } catch {
        // fall through to the client-side router
      }

      // A missing file with an extension is a real 404; anything else is a client route.
      if (extname(pathname) !== '') return plain(res, 404, 'Not Found');
      await send(res, join(root, 'index.html'));
    } catch {
      if (!res.headersSent) plain(res, 500, 'Internal Server Error');
      else res.end();
    }
  };
}
