import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ITEMS,
  LOCATIONS,
  createGame,
  projectView,
  reduce,
  type CombatMod,
  type GameState,
  type PlayerCommand,
} from '../src';
import { IDS } from './helpers';

function rand(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Random, mostly illegal commands. The engine must refuse them cleanly and never throw. */
function randomCommand(state: GameState, r: () => number): PlayerCommand {
  const one = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T;
  const playerId = one(state.players).id;
  const other = one(state.players).id;
  const loc = one(LOCATIONS);
  const item = one(ITEMS);
  const mods: CombatMod[] = r() < 0.2 ? [one(['sneak', 'booze', 'allIn'] as const)] : [];
  const id = state.attacks[0]?.id ?? state.offers[0]?.id ?? state.searches[0]?.id ?? state.prompts[0]?.id ?? 0;
  const options: PlayerCommand[] = [
    { type: 'move', playerId, to: loc },
    { type: 'move', playerId, to: loc },
    { type: 'chat', playerId, text: 'hi' },
    { type: 'ghostChat', playerId, text: 'boo' },
    { type: 'infoRequest', playerId, askerId: other },
    { type: 'offer', playerId, targetId: other, give: { gold: 1, items: {} }, want: { gold: 0, items: { [item]: 1 } } },
    { type: 'offerReply', playerId, offerId: id, accept: r() < 0.7 },
    { type: 'buyTicket', playerId, sellerId: other },
    { type: 'buy', playerId, item, hidden: r() < 0.5 },
    { type: 'sell', playerId, item },
    { type: 'use', playerId, item },
    { type: 'attack', playerId, targetId: other, loot: one(['gold', 'food', 'water'] as const), mods },
    { type: 'defend', playerId, attackId: id, mods, flee: r() < 0.3 ? { ability: one(['fastLegs', 'nightCover'] as const), to: loc } : undefined },
    { type: 'stealth', playerId, to: loc },
    { type: 'bleed', playerId, targetId: other },
    { type: 'search', playerId, targetId: other },
    { type: 'showItem', playerId, searchId: id, item: r() < 0.5 ? item : null },
    { type: 'heal', playerId, targetId: other },
    { type: 'megaphone', playerId },
    { type: 'suspect', playerId, targetId: other },
    { type: 'courtStart', playerId, accusedId: other },
    { type: 'courtVote', playerId, guilty: r() < 0.5 },
    { type: 'courtClose', playerId },
    { type: 'serumRoll', playerId },
    { type: 'serumHelp', playerId },
    { type: 'donateIngredients', playerId },
    { type: 'remedyRoll', playerId },
    { type: 'gatherHerbs', playerId },
    { type: 'craftPotion', playerId },
    { type: 'premonition', playerId },
    { type: 'note', playerId, text: 'psst' },
    { type: 'stash', playerId, gold: r() < 0.5 ? 2 : 0, item: r() < 0.5 ? item : null },
    { type: 'unstash', playerId },
    { type: 'outlaw', playerId },
    { type: 'escape', playerId },
    { type: 'rumor', playerId },
    { type: 'well', playerId },
    { type: 'corpse', playerId },
    { type: 'haunt', playerId, to: loc },
    { type: 'unhaunt', playerId },
    { type: 'choose', playerId, promptId: id, ids: [other], option: 2 },
    { type: 'ready', playerId },
    { type: 'setAutoAmnesty', playerId, on: r() < 0.5 },
  ];
  return one(options);
}

describe('fuzz', () => {
  for (const [players, seed] of [[5, 1], [6, 2], [8, 3], [10, 4], [7, 5]] as const) {
    it(`plays a whole chaotic game with ${players} players (seed ${seed})`, () => {
      const r = rand(seed);
      let now = 0;
      let state = createGame({ playerIds: IDS.slice(0, players), seed, now, config: { dayMs: 40_000, nightMs: 20_000, summaryMs: 5_000, courtMs: 10_000 } });
      let accepted = 0;
      for (let step = 0; step < 40_000 && state.phase.kind !== 'over'; step++) {
        now += Math.floor(r() * 400);
        const result = reduce(state, randomCommand(state, r), now);
        if (result.ok) {
          state = result.state;
          accepted += 1;
        }
        if (step % 50 === 0) {
          for (const p of state.players) projectView(state, p.id, now);
          projectView(state, null, now);
        }
        for (const p of state.players) {
          assert.ok(p.hp <= p.maxHp && p.gold >= 0 && p.infection >= 0 && p.infection <= 5, `bad stats for ${p.id}`);
          assert.ok(Object.values(p.inv).every((n) => (n ?? 0) > 0), 'no empty stacks');
        }
      }
      for (let i = 0; i < 5000 && state.phase.kind !== 'over'; i++) {
        now += 1000;
        const result = reduce(state, { type: 'tick' }, now);
        assert.ok(result.ok);
        if (result.ok) state = result.state;
      }
      assert.equal(state.phase.kind, 'over');
      assert.ok(state.result);
      assert.ok(accepted > 100);
    });
  }
});
