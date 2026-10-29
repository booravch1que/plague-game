import { CONSUMABLES, DEFEND_MS, FOOD, LOCATIONS, SEARCH_MS, STEALTH_MS, VALUABLES } from './constants';
import { enterLocation } from './movement';
import { closedToday } from './schedule';
import type { Attack, CombatMod, FleeAbility, GameState, ItemId, LocationId, LootKind, Player } from './types';
import {
  addDice,
  addFact,
  addItem,
  check,
  count,
  d6,
  damage,
  getPlayer,
  isAlive,
  isIsolated,
  isNight,
  livingAt,
  nextId,
  pick,
  ready,
  removeItem,
  tell,
  touch,
  useCooldown,
} from './util';

// ---------------------------------------------------------------------------
// Modifiers
// ---------------------------------------------------------------------------

function validateMods(state: GameState, p: Player, mods: CombatMod[]): void {
  const unique = new Set(mods);
  check(unique.size === mods.length, 'invalid_choice', 'Each modifier can be used once.');
  for (const mod of unique) {
    if (mod === 'sneak') {
      check(p.role === 'grif' && ready(p, 'sneak', 2, state.day), 'not_ready', 'Sneak strike is not ready.');
    } else if (mod === 'booze') {
      check(p.role === 'citizen' && ready(p, 'booze', 2, state.day), 'not_ready', 'You cannot drink right now.');
    } else if (mod === 'allIn') {
      check(p.role === 'citizen' && !p.spent.allIn && count(p.inv, 'rose') > 0, 'not_ready', 'All or nothing is not available.');
    }
  }
}

function spendMods(state: GameState, p: Player, mods: CombatMod[]): void {
  for (const mod of mods) {
    if (mod === 'sneak') useCooldown(p, 'sneak', state.day);
    if (mod === 'booze') {
      useCooldown(p, 'booze', state.day);
      p.thirst = Math.max(0, p.thirst - 1);
    }
    if (mod === 'allIn') p.spent.allIn = true;
  }
}

function modBonus(p: Player, mods: CombatMod[], attacking: boolean): number {
  let bonus = 0;
  if (attacking && count(p.inv, 'shiv') > 0) bonus += 1;
  if (mods.includes('sneak')) bonus += 2;
  if (mods.includes('booze')) bonus += 1;
  if (mods.includes('allIn')) bonus += 3;
  return bonus;
}

// ---------------------------------------------------------------------------
// Attack
// ---------------------------------------------------------------------------

export function inCombat(state: GameState, id: string): boolean {
  return state.attacks.some((a) => a.attackerId === id || a.targetId === id);
}

export function declareAttack(state: GameState, p: Player, targetId: string, loot: LootKind, mods: CombatMod[]): void {
  const target = getPlayer(state, targetId);
  check(target.id !== p.id, 'invalid_target', 'You cannot attack yourself.');
  check(isAlive(target) && target.location === p.location, 'invalid_target', 'That player is not here.');
  check(livingAt(state, p.location).length === 2, 'not_alone', 'You can only attack when exactly two people are here.');
  check(!(isNight(state) && target.role === 'bachelor'), 'untouchable', 'Nobody can attack the bachelor at night.');
  check(!inCombat(state, p.id) && !inCombat(state, target.id), 'busy', 'Somebody here is already fighting.');
  check(!isIsolated(p), 'isolated', 'You are locked in the isolator.');
  const useAttackAction = p.attackActions > 0;
  check(useAttackAction || p.actions > 0, 'no_actions', 'No actions left.');
  validateMods(state, p, mods);

  if (useAttackAction) p.attackActions -= 1;
  else p.actions -= 1;
  spendMods(state, p, mods);
  addFact(p, `attack:${p.location}`);

  const attack: Attack = {
    id: nextId(state),
    attackerId: p.id,
    targetId: target.id,
    location: p.location,
    loot,
    mods,
    deadline: state.t + DEFEND_MS,
    usedAttackAction: useAttackAction,
  };
  state.attacks.push(attack);
  tell(state, target, 'msg.underAttack', { attackerId: p.id });
  touch(state);
}

export function defend(
  state: GameState,
  p: Player,
  attackId: number,
  mods: CombatMod[],
  flee: { ability: FleeAbility; to: LocationId } | undefined,
): void {
  const attack = state.attacks.find((a) => a.id === attackId && a.targetId === p.id);
  check(attack, 'invalid_choice', 'There is no attack to answer.');
  if (flee) {
    const { ability, to } = flee;
    check(LOCATIONS.includes(to) && to !== p.location && to !== 'isolator', 'invalid_target', 'You cannot run there.');
    check(!closedToday(state, to), 'closed', 'That place is closed today.');
    if (ability === 'fastLegs') {
      check(p.role === 'haruspex' && ready(p, 'fastLegs', 3, state.day), 'not_ready', 'Fast legs are not ready.');
    } else {
      check(p.role === 'angel' && isNight(state) && ready(p, 'nightCover', 3, state.day), 'not_ready', 'Night cover is not ready.');
      p.angelPenalty = true;
    }
    useCooldown(p, ability, state.day);
    state.attacks = state.attacks.filter((a) => a.id !== attack.id);
    addDice(state, attack.location, 'dice.fled', { attackerId: attack.attackerId, targetId: p.id }, true);
    tell(state, attack.attackerId, 'msg.targetFled', { targetId: p.id });
    enterLocation(state, p, to);
    touch(state);
    return;
  }
  validateMods(state, p, mods);
  spendMods(state, p, mods);
  resolveAttack(state, attack, mods);
}

export function resolveAttack(state: GameState, attack: Attack, defenceMods: CombatMod[] = []): void {
  state.attacks = state.attacks.filter((a) => a.id !== attack.id);
  const attacker = getPlayer(state, attack.attackerId);
  const target = getPlayer(state, attack.targetId);
  if (!isAlive(attacker) || !isAlive(target) || attacker.location !== target.location) return;

  const aRoll = d6(state);
  const tRoll = d6(state);
  const aTotal = aRoll + modBonus(attacker, attack.mods, true);
  const tTotal = tRoll + modBonus(target, defenceMods, false);
  const success = aTotal > tTotal;
  const params = { attackerId: attacker.id, targetId: target.id, a: aTotal, t: tTotal };
  addDice(state, attack.location, success ? 'dice.attackWon' : 'dice.attackLost', params, true);

  if (success) {
    addFact(attacker, 'attackOk');
    if (isNight(state)) addFact(attacker, 'attackOk:night');
    addFact(attacker, `hit:${target.role}`);
    const taken = takeLoot(state, attacker, target, attack.loot);
    tell(state, target, 'msg.robbed', { attackerId: attacker.id, what: taken });
    tell(state, attacker, 'msg.robSuccess', { targetId: target.id, what: taken });
    if (count(attacker.inv, 'rose') > 0) {
      const extra = pick(state, CONSUMABLES.filter((i) => count(target.inv, i) > 0));
      if (extra) {
        removeItem(target.inv, extra);
        addItem(attacker.inv, extra);
        tell(state, attacker, 'msg.roseLoot', { item: extra });
      }
    }
    if (attacker.role === 'ripper') rewardRipper(state, attacker, target);
    damage(state, target, 1, 'attack');
  } else {
    const amnesty = attacker.role === 'grif' && attacker.autoAmnesty && ready(attacker, 'amnesty', 3, state.day);
    if (amnesty) {
      useCooldown(attacker, 'amnesty', state.day);
      tell(state, attacker, 'msg.amnesty');
    } else {
      damage(state, attacker, attack.mods.includes('allIn') ? 2 : 1, 'attack');
    }
  }
  touch(state);
}

function rewardRipper(state: GameState, ripper: Player, target: Player): void {
  ripper.attacksWon += 1;
  if (ripper.attacksWon % 2 === 0) {
    addItem(ripper.inv, 'trophy');
    tell(state, ripper, 'msg.trophy');
  }
  if (isNight(state) && state.huntTargetId === target.id) {
    addItem(ripper.inv, 'trophy', 2);
    ripper.gold += 2;
    state.huntTargetId = null;
    tell(state, ripper, 'msg.huntDone');
  }
  if (ripper.stealthUses < 2) state.stealth = { playerId: ripper.id, until: state.t + STEALTH_MS };
}

/** Takes what the attacker asked for, or the next best thing the victim has. */
function takeLoot(state: GameState, attacker: Player, target: Player, wanted: LootKind): string {
  const order: LootKind[] = [wanted, ...(['gold', 'food', 'water'] as LootKind[]).filter((k) => k !== wanted)];
  for (const kind of order) {
    if (kind === 'gold' && target.gold > 0) {
      const n = Math.min(2, target.gold);
      target.gold -= n;
      attacker.gold += n;
      return `gold:${n}`;
    }
    if (kind === 'food') {
      const food = pick(state, (Object.keys(FOOD) as ItemId[]).filter((i) => count(target.inv, i) > 0));
      if (food) {
        removeItem(target.inv, food);
        addItem(attacker.inv, food);
        return `item:${food}`;
      }
    }
    if (kind === 'water' && removeItem(target.inv, 'water')) {
      addItem(attacker.inv, 'water');
      return 'item:water';
    }
  }
  return 'nothing';
}

export function useStealth(state: GameState, p: Player, to: LocationId): void {
  const s = state.stealth;
  check(s && s.playerId === p.id && s.until >= state.t, 'not_ready', 'The moment to slip away has passed.');
  check(LOCATIONS.includes(to) && to !== p.location && to !== 'isolator' && !closedToday(state, to), 'invalid_target', 'You cannot go there.');
  state.stealth = null;
  p.stealthUses += 1;
  addFact(p, 'stealth');
  enterLocation(state, p, to);
}

// ---------------------------------------------------------------------------
// Bleeding wounds
// ---------------------------------------------------------------------------

export function bleed(state: GameState, p: Player, targetId: string): void {
  check(p.role === 'ripper', 'not_allowed', 'Only the ripper can do that.');
  check(ready(p, 'bleed', 2, state.day), 'not_ready', 'Bleeding wounds are not ready.');
  const target = getPlayer(state, targetId);
  check(target.id !== p.id && isAlive(target) && target.location === p.location, 'invalid_target', 'That player is not here.');
  check(livingAt(state, p.location).length >= 3, 'crowd_needed', 'You need at least three people around to stay unseen.');
  const useAttackAction = p.attackActions > 0;
  check(useAttackAction || p.actions > 0, 'no_actions', 'No actions left.');
  if (useAttackAction) p.attackActions -= 1;
  else p.actions -= 1;
  useCooldown(p, 'bleed', state.day);
  target.bleeding = true;
  addFact(p, `bleed:${p.location}`);
  tell(state, p, 'msg.bleedDone', { targetId: target.id });
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export function startSearch(state: GameState, p: Player, targetId: string): void {
  check(p.role === 'bachelor', 'not_allowed', 'Only the bachelor can search people.');
  check(p.actions > 0, 'no_actions', 'No actions left.');
  const target = getPlayer(state, targetId);
  check(target.id !== p.id && isAlive(target) && target.location === p.location, 'invalid_target', 'That player is not here.');
  check(!state.searches.some((s) => s.targetId === target.id), 'busy', 'That player is already being searched.');
  p.actions -= 1;
  addFact(p, `search:${target.id}`);
  addFact(target, 'searched');

  if (target.role === 'grif' && target.autoAmnesty && ready(target, 'amnesty', 3, state.day)) {
    useCooldown(target, 'amnesty', state.day);
    tell(state, target, 'msg.amnesty');
    tell(state, p, 'msg.searchFoiled', { targetId: target.id });
    touch(state);
    return;
  }
  state.searches.push({ id: nextId(state), searcherId: p.id, targetId: target.id, deadline: state.t + SEARCH_MS });
  tell(state, target, 'msg.beingSearched', { searcherId: p.id });
  touch(state);
}

/** The searched player picks one consumable to show. On timeout the server picks one. */
export function finishSearch(state: GameState, searchId: number, shown: ItemId | null | undefined): void {
  const search = state.searches.find((s) => s.id === searchId);
  if (!search) return;
  state.searches = state.searches.filter((s) => s.id !== searchId);
  const searcher = getPlayer(state, search.searcherId);
  const target = getPlayer(state, search.targetId);
  const owned = CONSUMABLES.filter((i) => count(target.inv, i) > 0);
  const item = shown && owned.includes(shown) ? shown : (pick(state, owned) ?? null);
  const valuables = VALUABLES.filter((v) => count(target.inv, v) > 0);
  tell(state, searcher, 'msg.searchResult', {
    targetId: target.id,
    gold: target.gold,
    valuables: valuables.join(',') || '-',
    item: item ?? '-',
  });
  tell(state, target, 'msg.searchShown', { searcherId: searcher.id, item: item ?? '-' });
  touch(state);
}
