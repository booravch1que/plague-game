import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { createHttpHandler } from '../src';

let dir = '';
let server: Server;
let port = 0;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'sc-http-'));
  mkdirSync(join(dir, 'web', 'assets'), { recursive: true });
  writeFileSync(join(dir, 'web', 'index.html'), '<!doctype html><title>Game</title>');
  writeFileSync(join(dir, 'web', 'assets', 'app-abc123.js'), 'console.log(1)');
  writeFileSync(join(dir, 'web', 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  writeFileSync(join(dir, 'secret.txt'), 'top secret');
  const handler = createHttpHandler({ webDir: join(dir, 'web'), roomCount: () => 7 });
  server = createServer((req, res) => void handler(req, res));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

after(() => {
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

/** Raw request so that odd paths reach the server exactly as written. */
function get(path: string, method = 'GET'): Promise<{ status: number; headers: Record<string, string>; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers as Record<string, string>, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('http handler', () => {
  it('serves the client with security headers and no caching for the page itself', async () => {
    const r = await get('/');
    assert.equal(r.status, 200);
    assert.match(r.headers['content-type'], /text\/html/);
    assert.equal(r.headers['cache-control'], 'no-cache');
    assert.match(r.headers['content-security-policy'], /default-src 'self'/);
    assert.equal(r.headers['x-content-type-options'], 'nosniff');
    assert.equal(r.headers['x-frame-options'], 'DENY');
    assert.match(r.body, /<title>Game<\/title>/);
  });

  it('caches hashed assets forever', async () => {
    const r = await get('/assets/app-abc123.js');
    assert.equal(r.status, 200);
    assert.match(r.headers['content-type'], /javascript/);
    assert.match(r.headers['cache-control'], /immutable/);
  });

  it('serves other static files with the right type', async () => {
    const r = await get('/favicon.svg');
    assert.equal(r.headers['content-type'], 'image/svg+xml');
  });

  it('falls back to the page for client-side routes, but 404s a missing file', async () => {
    assert.match((await get('/join/ABCDE')).body, /<title>Game/);
    const missing = await get('/assets/nope.js');
    assert.equal(missing.status, 404);
  });

  it('cannot be tricked into reading outside its folder', async () => {
    for (const path of ['/..%2fsecret.txt', '/%2e%2e/secret.txt', '/assets/..%2f..%2fsecret.txt', '/%2e%2e%2fsecret.txt']) {
      const r = await get(path);
      assert.ok(r.status === 403 || r.status === 404 || r.body.includes('<title>Game'), `${path} -> ${r.status}`);
      assert.ok(!r.body.includes('top secret'), `${path} leaked the file`);
    }
    assert.equal((await get('/%00')).status, 400);
    assert.equal((await get('/%zz')).status, 400);
  });

  it('only allows GET and HEAD', async () => {
    const post = await get('/', 'POST');
    assert.equal(post.status, 405);
    assert.equal(post.headers['allow'], 'GET, HEAD');
    const head = await get('/', 'HEAD');
    assert.equal(head.status, 200);
  });

  it('reports health', async () => {
    const r = await get('/healthz');
    assert.deepEqual(JSON.parse(r.body), { ok: true, rooms: 7 });
    assert.equal(r.headers['cache-control'], 'no-store');
  });
});
