import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_CONFIG, dealRoles, projectView, SERUM_GOAL } from '../src';
import { Game } from './helpers';

describe('setup', () => {
  it('deals the five core roles, then the citizen, then residents', () => {
    assert.deepEqual(dealRoles(5).sort(), ['angel', 'bachelor', 'grif', 'haruspex', 'ripper']);
    assert.ok(dealRoles(6).includes('citizen'));
    assert.equal(dealRoles(10).filter((r) => r === 'resident').length, 4);
  });

  it('starts day 1 with workers at the factory and the bachelor on the square', () => {
    const g = new Game(6);
    assert.equal(g.state.day, 1);
    assert.equal(g.state.phase.kind, 'day');
    assert.equal(g.byRole('bachelor').location, 'square');
    assert.equal(g.byRole('haruspex').location, 'factory');
    assert.equal(g.byRole('ripper').location, 'factory');
    const citizen = g.byRole('citizen');
    assert.deepEqual([citizen.hp, citizen.hunger, citizen.thirst, citizen.gold, citizen.moves], [6, 10, 6, 3, 4]);
    const angel = g.byRole('angel');
    assert.deepEqual([angel.hp, angel.hunger, angel.thirst, angel.gold, angel.actions], [5, 8, 5, 2, 4]);
    assert.equal(g.byRole('bachelor').gold, 5);
    assert.equal(g.byRole('ripper').gold, 0);
    assert.equal(g.byRole('ripper').inv.shiv, 1);
  });

  it('announces the bachelor to everyone and tells each player only their own role', () => {
    const g = new Game(6);
    const ripper = g.id('ripper');
    const view = projectView(g.state, g.id('angel'), g.now);
    assert.ok(view.messages.some((m) => m.key === 'msg.bachelorIs'));
    const roleMessages = view.messages.filter((m) => m.key === 'msg.yourRole');
    assert.equal(roleMessages.length, 1);
    assert.equal(roleMessages[0]?.params?.['role'], 'angel');
    assert.ok(!JSON.stringify(view.players).includes('ripper'));
    assert.ok(!view.messages.some((m) => m.to !== 'all' && m.to.includes(ripper) && m.key === 'msg.yourRole'));
  });
});

describe('the day cycle', () => {
  it('runs day, night, summary and back to day, with upkeep at the end of the day', () => {
    const g = new Game(5);
    const angel = g.id('angel');
    g.finishPhase();
    assert.equal(g.state.phase.kind, 'night');
    assert.equal(g.player(angel).moves, 2);
    assert.equal(g.player(angel).actions, 3);
    g.finishPhase();
    assert.equal(g.state.phase.kind, 'summary');
    assert.equal(g.player(angel).hunger, 7);
    assert.equal(g.player(angel).thirst, 4);
    g.toDay(2);
    assert.equal(g.phase, 'day');
    assert.equal(g.state.day, 2);
  });

  it('pays the factory shift after a minute and nothing to those who leave early', () => {
    const g = new Game(5, 3);
    const haruspex = g.id('haruspex');
    const angel = g.id('angel');
    g.wait(10_000);
    g.do({ type: 'move', playerId: angel, to: 'square' });
    const before = g.player(haruspex).gold;
    const angelGold = g.player(angel).gold;
    g.wait(51_000);
    assert.equal(g.player(haruspex).workStart, null);
    assert.ok(g.player(haruspex).gold >= before);
    assert.equal(g.player(angel).gold, angelGold);
  });

  it('starves: a zero stat costs one health at the end of the day', () => {
    const g = new Game(5);
    const grif = g.player(g.id('grif'));
    grif.hunger = 1;
    grif.thirst = 1;
    g.toDay(2);
    assert.equal(g.player(grif.id).hp, 3);
  });

  it('ends after day 10; without a serum the plague wins', () => {
    const g = new Game(5);
    g.toDay(11);
    assert.equal(g.state.phase.kind, 'over');
    assert.equal(g.state.result?.winner, 'plague');
  });
});

describe('moving', () => {
  it('spends a move and refuses with none left', () => {
    const g = new Game(5);
    const b = g.id('bachelor');
    g.do({ type: 'move', playerId: b, to: 'townhall' });
    g.do({ type: 'move', playerId: b, to: 'cemetery' });
    g.do({ type: 'move', playerId: b, to: 'station' });
    assert.equal(g.reject({ type: 'move', playerId: b, to: 'square' }), 'no_moves');
  });
});

describe('combat', () => {
  it('only works with exactly two people in the room', () => {
    const g = new Game(5);
    const ripper = g.id('ripper');
    const angel = g.id('angel');
    assert.equal(g.reject({ type: 'attack', playerId: ripper, targetId: angel, loot: 'gold', mods: [] }), 'not_alone');
  });

  it('resolves on timeout: the winner robs, the loser bleeds', () => {
    const g = new Game(5, 11);
    const ripper = g.id('ripper');
    const angel = g.id('angel');
    g.teleport(ripper, 'cemetery');
    g.teleport(angel, 'cemetery');
    const hpBefore = g.player(angel).hp + g.player(ripper).hp;
    g.do({ type: 'attack', playerId: ripper, targetId: angel, loot: 'gold', mods: [] });
    assert.equal(g.player(ripper).attackActions, 0, 'the frenzy action is used first');
    g.wait(11_000);
    assert.equal(g.state.attacks.length, 0);
    assert.equal(g.player(angel).hp + g.player(ripper).hp, hpBefore - 1);
    assert.ok(g.state.dice.some((d) => d.attack));
  });

  it('fast legs let the haruspex escape without a roll', () => {
    const g = new Game(5);
    const ripper = g.id('ripper');
    const h = g.id('haruspex');
    g.teleport(ripper, 'station');
    g.teleport(h, 'station');
    g.do({ type: 'attack', playerId: ripper, targetId: h, loot: 'food', mods: [] });
    const attack = g.state.attacks[0];
    assert.ok(attack);
    g.do({ type: 'defend', playerId: h, attackId: attack.id, mods: [], flee: { ability: 'fastLegs', to: 'square' } });
    assert.equal(g.player(h).location, 'square');
    assert.equal(g.player(h).hp, 5);
    assert.equal(g.reject({ type: 'attack', playerId: ripper, targetId: h, loot: 'food', mods: [] }), 'invalid_target');
  });

  it('nobody can attack the bachelor at night', () => {
    const g = new Game(5);
    g.finishPhase();
    const ripper = g.id('ripper');
    const b = g.id('bachelor');
    g.teleport(ripper, 'townhall');
    g.teleport(b, 'townhall');
    assert.equal(g.reject({ type: 'attack', playerId: ripper, targetId: b, loot: 'gold', mods: [] }), 'untouchable');
  });
});

describe('infection', () => {
  it('starts on day 3 with one player who is not the bachelor', () => {
    const g = new Game(6);
    g.toDay(3);
    const sick = g.state.players.filter((p) => p.infection > 0);
    assert.equal(sick.length, 1);
    assert.notEqual(sick[0]?.role, 'bachelor');
    assert.equal(g.state.firstInfectedId, sick[0]?.id);
  });

  it('spreads after a full minute together, once per visit', () => {
    const g = new Game(6);
    g.toDay(3);
    const sick = g.state.players.find((p) => p.infection > 0);
    const healthy = g.state.players.find((p) => p.infection === 0 && p.id !== sick?.id);
    assert.ok(sick && healthy);
    for (const p of g.state.players) g.teleport(p.id, p.id === sick.id || p.id === healthy.id ? 'cemetery' : 'square');
    g.wait(59_000);
    assert.equal(g.player(healthy.id).infection, 0);
    g.wait(2_000);
    assert.equal(g.player(healthy.id).infection, 1);
    g.wait(70_000);
    assert.equal(g.player(healthy.id).infection, 1, 'at most one stage per visit');
  });

  it('a ghost makes everyone in the room roll', () => {
    const g = new Game(6);
    const victim = g.player(g.id('grif'));
    victim.hp = 1;
    g.teleport(victim.id, 'cemetery');
    g.finishPhase();
    g.state.players.find((p) => p.id === victim.id)!.hunger = 0;
    g.toDay(3);
    assert.equal(g.player(victim.id).status, 'dead');
    const target = g.byRole('angel');
    g.do({ type: 'haunt', playerId: victim.id, to: target.location });
    assert.ok(g.state.dice.some((d) => d.key.startsWith('dice.ghost')));
  });
});

describe('trade and shops', () => {
  it('a poisoned rusk looks plain and hurts at the end of the day', () => {
    const g = new Game(5);
    g.toDay(3);
    const ripper = g.id('ripper');
    const angel = g.id('angel');
    g.teleport(ripper, 'station');
    g.teleport(angel, 'station');
    g.do({ type: 'offer', playerId: ripper, targetId: angel, give: { gold: 0, items: { poisonRusk: 1 } }, want: { gold: 0, items: {} } });
    const view = projectView(g.state, angel, g.now);
    assert.deepEqual(view.offers[0]?.give.items, { rusk: 1 });
    const rusks = g.player(angel).inv.rusk ?? 0;
    g.do({ type: 'offerReply', playerId: angel, offerId: g.state.offers[0]!.id, accept: true });
    assert.equal(g.player(angel).inv.rusk, rusks + 1);
    assert.equal(g.player(ripper).questDone, true);
    const hp = g.player(angel).hp;
    g.finishPhase();
    g.finishPhase();
    assert.equal(g.player(angel).hp, hp - 1);
  });

  it('a market visit costs one action however much you buy', () => {
    const g = new Game(5, 5);
    const b = g.id('bachelor');
    g.do({ type: 'move', playerId: b, to: 'market' });
    const lines = projectView(g.state, b, g.now).here?.shop ?? [];
    const cheap = lines.filter((l) => l.coupons === 0).sort((x, y) => x.gold - y.gold);
    assert.ok(cheap.length > 0, 'something is in stock');
    const actions = g.player(b).actions;
    g.player(b).gold = 50;
    g.do({ type: 'buy', playerId: b, item: cheap[0]!.item });
    g.do({ type: 'buy', playerId: b, item: cheap[0]!.item });
    assert.equal(g.player(b).actions, actions - 1);
    assert.ok(g.state.messages.some((m) => m.key === 'msg.bought'));
  });
});

describe('court', () => {
  it('stops the clock, and a guilty verdict sends the accused to the isolator for two days', () => {
    const g = new Game(5);
    const b = g.id('bachelor');
    const ripper = g.id('ripper');
    g.do({ type: 'move', playerId: b, to: 'townhall' });
    g.do({ type: 'courtStart', playerId: b, accusedId: ripper });
    const t = g.state.t;
    g.wait(5_000);
    assert.equal(g.state.t, t, 'the game clock is frozen');
    for (const p of g.state.players) {
      if (p.id !== b) g.do({ type: 'move', playerId: p.id, to: 'townhall' });
    }
    for (const p of g.state.players) g.do({ type: 'courtVote', playerId: p.id, guilty: p.id !== ripper });
    assert.equal(g.state.court, null);
    assert.equal(g.player(ripper).location, 'isolator');
    assert.equal(g.reject({ type: 'move', playerId: ripper, to: 'square' }), 'isolated');
    g.toDay(3);
    assert.equal(g.player(ripper).isolatedUntil, null);
    assert.equal(g.player(ripper).location, 'factory');
  });
});

describe('serum', () => {
  it('is rolled in the town hall and, when done, sold there by the bachelor', () => {
    const g = new Game(5);
    const b = g.id('bachelor');
    g.do({ type: 'move', playerId: b, to: 'townhall' });
    g.do({ type: 'serumRoll', playerId: b });
    assert.equal(g.reject({ type: 'serumRoll', playerId: b }), 'not_ready');
    g.state.serum = SERUM_GOAL;
    const view = projectView(g.state, b, g.now);
    assert.ok(view.here?.shop.some((l) => l.item === 'serum'));
    g.do({ type: 'buy', playerId: b, item: 'serum' });
    g.do({ type: 'use', playerId: b, item: 'serum' });
    assert.equal(g.player(b).usedSerum, true);
    assert.equal(g.player(b).vulnerable, true);
  });

  it('the town wins when the serum is done and survivors took it', () => {
    const g = new Game(5);
    for (let day = 2; day <= 10; day++) {
      for (const p of g.state.players) Object.assign(p, { hunger: 10, thirst: 6, hp: p.status === 'alive' ? 5 : 0 });
      g.toDay(day);
    }
    for (const p of g.state.players) g.teleport(p.id, 'square');
    g.state.serum = SERUM_GOAL;
    for (const p of g.state.players) {
      p.usedSerum = p.caste !== 'bandit';
      p.hunger = 10;
      p.thirst = 6;
    }
    g.toDay(11);
    assert.equal(g.state.result?.winner, 'town');
    const bachelor = g.state.result?.players.find((r) => r.role === 'bachelor');
    assert.equal(bachelor?.won, bachelor?.status === 'alive');
  });
});

describe('quests', () => {
  it('bachelor day 1: meeting three people pays two gold', () => {
    const g = new Game(5);
    const b = g.id('bachelor');
    for (const p of g.state.players) g.teleport(p.id, 'square');
    const gold = g.player(b).gold;
    g.wait(31_000);
    assert.equal(g.player(b).questDone, true);
    assert.equal(g.player(b).gold, gold + 2);
  });
});

describe('timing config', () => {
  it('uses the default lengths', () => {
    assert.equal(DEFAULT_CONFIG.dayMs, 240_000);
    assert.equal(DEFAULT_CONFIG.nightMs, 120_000);
  });
});
