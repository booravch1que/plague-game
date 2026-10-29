import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GameServer, attachSocketTransport, clientIp, type IoLike, type SocketLike } from '../src';
import { FakeScheduler, seededRandom } from './harness';

class FakeSocket implements SocketLike {
  readonly emitted: { event: string; data: unknown }[] = [];
  disconnected = false;
  private anyListener: (event: string, ...args: unknown[]) => void = () => {};
  private disconnectListener: () => void = () => {};
  constructor(
    readonly id: string,
    readonly handshake: SocketLike['handshake'] = { address: '10.0.0.1' },
  ) {}
  emit(event: string, data: unknown): void {
    this.emitted.push({ event, data });
  }
  disconnect(): void {
    if (this.disconnected) return;
    this.disconnected = true;
    this.disconnectListener();
  }
  on(_event: 'disconnect', listener: () => void): void {
    this.disconnectListener = listener;
  }
  onAny(listener: (event: string, ...args: unknown[]) => void): void {
    this.anyListener = listener;
  }
  /** What a client sending a message looks like. */
  fire(event: string, ...args: unknown[]): void {
    this.anyListener(event, ...args);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- loose test double
  last(event: string): any {
    return this.emitted.filter((m) => m.event === event).at(-1)?.data;
  }
}

class FakeIo implements IoLike {
  private listener: (socket: SocketLike) => void = () => {};
  on(_event: 'connection', listener: (socket: SocketLike) => void): void {
    this.listener = listener;
  }
  connect(socket: FakeSocket): FakeSocket {
    this.listener(socket);
    return socket;
  }
}

function rig(options: Parameters<typeof attachSocketTransport>[2] = {}) {
  const sched = new FakeScheduler();
  const game = new GameServer({ scheduler: sched, random: seededRandom(1), config: { minPlayers: 2 } });
  const io = new FakeIo();
  attachSocketTransport(io, game, { now: () => sched.now(), ...options });
  return { sched, game, io };
}

describe('socket transport adapter', () => {
  it('passes messages to the game and sends replies back as socket events', () => {
    const { io, game } = rig();
    const a = io.connect(new FakeSocket('a'));
    a.fire('room:create', { nickname: 'Alice' });
    assert.equal(a.last('room:joined').kind, 'player');
    assert.equal(a.last('room:state').participants.length, 1);

    const b = io.connect(new FakeSocket('b', { address: '10.0.0.2' }));
    b.fire('room:join', { code: a.last('room:joined').code, nickname: 'Bob' });
    assert.equal(a.last('room:state').participants.length, 2);
    a.fire('lobby:start');
    assert.ok(b.last('game:view').view.you.role);
    assert.equal(game.roomCount, 1);
  });

  it('bad input is answered with an error event, never an exception', () => {
    const { io } = rig();
    const s = io.connect(new FakeSocket('s'));
    s.fire('nonsense', { a: 1 });
    assert.equal(s.last('error').code, 'invalid_payload');
    s.fire('room:create');
    assert.equal(s.last('error').code, 'invalid_payload');
  });

  it('ignores acknowledgement callbacks and extra arguments', () => {
    const { io } = rig();
    const s = io.connect(new FakeSocket('s'));
    s.fire('room:create', { nickname: 'Alice' }, () => {}, 'extra');
    assert.equal(s.last('room:joined').kind, 'player');
  });

  it('a dropped socket detaches the seat but keeps it for a rejoin', () => {
    const { io, game } = rig();
    const a = io.connect(new FakeSocket('a'));
    a.fire('room:create', { nickname: 'Alice' });
    const { code, token } = a.last('room:joined');
    const b = io.connect(new FakeSocket('b', { address: '10.0.0.2' }));
    b.fire('room:join', { code, nickname: 'Bob' });

    a.disconnect();
    assert.equal(b.last('room:state').participants.find((p: { nickname: string }) => p.nickname === 'Alice').connected, false);

    const a2 = io.connect(new FakeSocket('a2'));
    a2.fire('room:rejoin', { code, token });
    assert.equal(a2.last('room:joined').selfId, a.last('room:joined').selfId);
    assert.equal(game.roomCount, 1);
  });

  it('limits simultaneous connections per IP address', () => {
    const { io } = rig({ maxConnectionsPerIp: 2 });
    const one = io.connect(new FakeSocket('1'));
    const two = io.connect(new FakeSocket('2'));
    const three = io.connect(new FakeSocket('3'));
    assert.equal(one.disconnected || two.disconnected, false);
    assert.equal(three.disconnected, true);
    one.disconnect();
    const four = io.connect(new FakeSocket('4'));
    assert.equal(four.disconnected, false, 'a freed slot can be used again');
    const other = io.connect(new FakeSocket('5', { address: '10.9.9.9' }));
    assert.equal(other.disconnected, false, 'another address is unaffected');
  });

  it('disconnects a socket that floods messages, but not one that plays normally', () => {
    const { io, sched } = rig({ burst: 10, messagesPerSecond: 5 });
    const polite = io.connect(new FakeSocket('p', { address: '1.1.1.1' }));
    for (let i = 0; i < 30; i++) {
      polite.fire('emote:send', { emote: '👍' });
      sched.advance(250);
    }
    assert.equal(polite.disconnected, false);

    const flood = io.connect(new FakeSocket('f', { address: '2.2.2.2' }));
    for (let i = 0; i < 50; i++) flood.fire('room:join', { code: 'ZZZZZ', nickname: 'Bob' });
    assert.equal(flood.disconnected, true);
  });

  it('only trusts X-Forwarded-For when told to', () => {
    const behindProxy = new FakeSocket('x', { address: '172.17.0.1', headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.5' } });
    assert.equal(clientIp(behindProxy, true), '203.0.113.9');
    assert.equal(clientIp(behindProxy, false), '172.17.0.1');
    assert.equal(clientIp(new FakeSocket('y', {}), true), 'unknown');
  });
});
