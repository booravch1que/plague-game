import { BANDIT_ABILITIES, SERUM_GOAL } from './constants';
import { completeQuest } from './quests';
import { hasEvent } from './schedule';
import type { GameState, Player, Prompt } from './types';
import {
  addDice,
  addFact,
  addItem,
  d6,
  findPlayer,
  isAlive,
  living,
  livingAt,
  markPhaseUse,
  pick,
  sys,
  tell,
  touch,
  usedThisPhase,
} from './util';

/** End of a factory shift: 4d6, each 4-6 is one gold. Forced labour pays nothing. */
export function finishWork(state: GameState, p: Player): void {
  p.workStart = null;
  let gold = 0;
  for (let i = 0; i < 4; i++) if (d6(state) >= 4) gold += 1;
  if (hasEvent(state, 'forcedLabor')) gold = 0;
  p.gold += gold;
  addDice(state, 'factory', 'dice.work', { playerId: p.id, gold });
  touch(state);
}

/**
 * One serum roll in the town hall. Helpers who signed up this phase and are still in
 * the town hall give +1, and two or more also give one reroll.
 */
export function rollSerum(state: GameState, bachelor: Player, auto: boolean): void {
  markPhaseUse(state, bachelor, 'serumRoll');
  const helpers = livingAt(state, 'townhall').filter((p) => p.id !== bachelor.id && usedThisPhase(state, p, 'serumHelp'));
  const bonus = (helpers.length >= 1 ? 1 : 0) + bachelor.serumBonus;
  bachelor.serumBonus = 0;
  let roll = d6(state);
  let success = roll + bonus >= 4;
  if (!success && helpers.length >= 2) {
    roll = d6(state);
    success = roll + bonus >= 4;
  }
  // Day 10 task: with two helpers the roll cannot fail.
  if (state.day === 10 && helpers.length >= 2 && !bachelor.questDone) {
    success = true;
    completeQuest(state, bachelor);
  }
  addDice(state, 'townhall', success ? 'dice.serumOk' : 'dice.serumFail', { roll, bonus, helpers: helpers.length, auto: auto ? 1 : 0 });
  for (const h of helpers) addFact(h, 'serumHelped');
  if (success && state.serum < SERUM_GOAL) {
    state.serum += 1;
    if (state.serum >= SERUM_GOAL) sys(state, 'all', 'msg.serumReady');
  }
  touch(state);
}

/** Applies a pending choice. `ids` were validated by the caller. */
export function applyPrompt(state: GameState, prompt: Prompt, ids: string[], option: number | undefined): void {
  state.prompts = state.prompts.filter((p) => p.id !== prompt.id);
  const bachelor = findPlayer(state, prompt.playerId);
  if (!bachelor) return;
  switch (prompt.kind) {
    case 'rations5':
    case 'rations6':
      for (const id of ids) {
        const p = findPlayer(state, id);
        if (!p || !isAlive(p)) continue;
        addItem(p.inv, 'rationSmall');
        addItem(p.inv, 'water');
        tell(state, p, 'msg.rationsGot', { items: 'rationSmall,water' });
      }
      break;
    case 'forcedWater': {
      const p = ids[0] ? findPlayer(state, ids[0]) : bachelor;
      if (p && isAlive(p)) {
        addItem(p.inv, 'water');
        if (p.id !== bachelor.id) tell(state, p, 'msg.rationsGot', { items: 'water' });
      }
      break;
    }
    case 'intel': {
      const index = Math.max(1, Math.min(BANDIT_ABILITIES.length, option ?? 1));
      tell(state, bachelor, 'msg.intelAbility', { n: index, ability: BANDIT_ABILITIES[index - 1] ?? 'shiv' });
      const target = ids[0] ? findPlayer(state, ids[0]) : undefined;
      if (target) tell(state, bachelor, 'msg.intelRole', { playerId: target.id, role: target.role });
      break;
    }
  }
  touch(state);
}

/** Unanswered prompts at the end of the summary: rations go to random people, water is kept. */
export function settlePrompts(state: GameState): void {
  for (const prompt of [...state.prompts]) {
    if (prompt.kind === 'intel') continue;
    const pool = living(state).map((p) => p.id);
    const ids: string[] = [];
    if (prompt.kind !== 'forcedWater') {
      while (ids.length < prompt.pick && ids.length < pool.length) {
        const id = pick(state, pool.filter((x) => !ids.includes(x)));
        if (id) ids.push(id);
      }
    }
    applyPrompt(state, prompt, ids, undefined);
  }
}
