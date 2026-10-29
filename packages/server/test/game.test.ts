import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Client, setup } from './harness';

describe('lobby', () => {
  it('needs five players to start', () => {
    const { clients } = setup(4);
    assert.equal(clients[0]?.lastError?.code, 'not_enough_players');
    assert.equal(clients[0]?.room.status, 'lobby');
  });

  it('the minimum can be lowered for solo testing', () => {
    const { clients } = setup(1, { config: { minPlayers: 1 } });
    assert.equal(clients[0]?.room.status, 'playing');
    assert.equal(clients[0]?.view.you?.role, 'bachelor');
  });

  it('late joiners become spectators who see only public news', () => {
    const { server, clients, code } = setup(5);
    const watcher = new Client(server);
    watcher.send('room:join', { code, nickname: 'Watcher' });
    assert.equal(watcher.joined.kind, 'spectator');
    const view = watcher.view;
    assert.equal(view.you, null);
    assert.equal(view.here, null);
    assert.ok(view.messages.every((m) => m.to === 'all'));
    assert.ok(clients.length === 5);
  });
});

describe('a running game', () => {
  it('each player sees only their own role, and nobody gets another token', () => {
    const { clients } = setup(6);
    const roles = clients.map((c) => c.view.you?.role);
    assert.equal(new Set(roles).size, 6);
    for (const c of clients) {
      const text = JSON.stringify(c.messages);
      for (const other of clients) if (other !== c) assert.ok(!text.includes(other.joined.token));
      const others = c.view.players.filter((p) => p.id !== c.selfId);
      assert.ok(!JSON.stringify(others).includes('role'));
    }
  });

  it('the clock ticks on the server: day turns to night after four minutes', () => {
    const { clients, sched } = setup(5);
    const c = clients[0] as Client;
    assert.equal(c.view.phase, 'day');
    sched.advance(240_000 + 1000);
    assert.equal(c.view.phase, 'night');
  });

  it('idle ticks do not resend views', () => {
    const { clients, sched } = setup(5);
    const c = clients[0] as Client;
    sched.advance(70_000); // past the factory shift
    c.clear();
    sched.advance(5_000);
    assert.equal(c.all('game:view').length, 0);
  });

  it('commands are applied with the identity of the connection', () => {
    const { clients } = setup(5);
    const bachelor = clients.find((c) => c.view.you?.role === 'bachelor') as Client;
    bachelor.command({ type: 'move', to: 'townhall' });
    assert.equal(bachelor.lastError, undefined);
    assert.equal(bachelor.view.you?.location, 'townhall');
    bachelor.raw('game:command', { command: { type: 'move', to: 'market', playerId: clients[1]?.selfId } });
    assert.equal(bachelor.view.you?.location, 'market');
  });

  it('a whole game runs to the end on its own and a rematch can start', () => {
    const { clients, sched } = setup(5, { preset: 'quick' });
    sched.advance(11 * (120_000 + 60_000 + 45_000));
    const c = clients[0] as Client;
    assert.equal(c.room.status, 'ended');
    assert.ok(c.view.result);
    for (const x of clients) x.send('room:playAgain');
    assert.equal(c.room.status, 'playing');
    assert.equal(c.view.day, 1);
  });

  it('a refresh gets the same seat back', () => {
    const { server, clients, code } = setup(5);
    const c = clients[2] as Client;
    const token = c.joined.token;
    const role = c.view.you?.role;
    c.disconnect();
    const again = new Client(server);
    again.send('room:rejoin', { code, token });
    assert.equal(again.view.you?.role, role);
  });
});
