import { MAX_INFECTION, phaseKey } from './constants';
import { randomInt } from './rng';
import type {
  Bundle,
  DiceEntry,
  EngineError,
  GameState,
  Inventory,
  ItemId,
  LocationId,
  Message,
  MsgParams,
  Player,
  PlayerId,
} from './types';

/** Thrown inside the reducer for an illegal command; turned into `{ ok: false }` at the edge. */
export class RuleError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
  toEngineError(): EngineError {
    return { code: this.code, message: this.message };
  }
}

export function fail(code: string, message: string): never {
  throw new RuleError(code, message);
}

export function check(condition: unknown, code: string, message: string): asserts condition {
  if (!condition) fail(code, message);
}

export function touch(state: GameState): void {
  state.rev += 1;
}

export function nextId(state: GameState): number {
  state.nextId += 1;
  return state.nextId;
}

export function d6(state: GameState): number {
  return randomInt(state, 6) + 1;
}

export function pick<T>(state: GameState, items: readonly T[]): T | undefined {
  return items.length === 0 ? undefined : items[randomInt(state, items.length)];
}

export function findPlayer(state: GameState, id: PlayerId): Player | undefined {
  return state.players.find((p) => p.id === id);
}

export function getPlayer(state: GameState, id: PlayerId): Player {
  const p = findPlayer(state, id);
  if (!p) fail('invalid_target', 'No such player.');
  return p;
}

export function isAlive(p: Player): boolean {
  return p.status === 'alive';
}

export function living(state: GameState): Player[] {
  return state.players.filter(isAlive);
}

export function livingAt(state: GameState, location: LocationId): Player[] {
  return state.players.filter((p) => isAlive(p) && p.location === location);
}

export function isIsolated(p: Player): boolean {
  return p.isolatedUntil !== null;
}

export function currentPhaseKey(state: GameState): string {
  const kind = state.phase.kind === 'night' ? 'night' : 'day';
  return phaseKey(kind, state.day);
}

export function isNight(state: GameState): boolean {
  return state.phase.kind === 'night';
}

/** "Once every N days" ability check. N = 1 means once per day (day and night together). */
export function ready(p: Player, ability: string, everyDays: number, day: number): boolean {
  const last = p.cooldowns[ability];
  return last === undefined || day - last >= everyDays;
}

export function useCooldown(p: Player, ability: string, day: number): void {
  p.cooldowns[ability] = day;
}

export function usedThisPhase(state: GameState, p: Player, ability: string): boolean {
  return p.phaseUses[ability] === currentPhaseKey(state);
}

export function markPhaseUse(state: GameState, p: Player, ability: string): void {
  p.phaseUses[ability] = currentPhaseKey(state);
}

export function addFact(p: Player, fact: string): void {
  p.facts.push(fact);
}

// ---------------------------------------------------------------------------
// Messages and dice
// ---------------------------------------------------------------------------

export function sys(state: GameState, to: Message['to'], key: string, params: MsgParams = {}, location?: LocationId): void {
  if (Array.isArray(to) && to.length === 0) return;
  state.messages.push({ id: nextId(state), day: state.day, to, kind: 'sys', key, params, location });
  trimMessages(state);
  touch(state);
}

export function tell(state: GameState, p: Player | PlayerId, key: string, params: MsgParams = {}): void {
  sys(state, [typeof p === 'string' ? p : p.id], key, params);
}

/** Everyone who can hear what happens in a location: the living there and listening ghosts. */
export function listeners(state: GameState, location: LocationId): PlayerId[] {
  return state.players
    .filter((p) => (isAlive(p) && p.location === location) || (p.status === 'dead' && p.haunt === location))
    .map((p) => p.id);
}

export function announceAt(state: GameState, location: LocationId, key: string, params: MsgParams = {}): void {
  sys(state, listeners(state, location), key, params, location);
}

export function addDice(state: GameState, location: LocationId, key: string, params: MsgParams, attack = false): void {
  const entry: DiceEntry = { id: nextId(state), location, at: state.t, key, params, attack };
  state.dice.push(entry);
  if (state.dice.length > 200) state.dice.splice(0, state.dice.length - 200);
  touch(state);
}

const MAX_MESSAGES = 3000;

function trimMessages(state: GameState): void {
  if (state.messages.length > MAX_MESSAGES) state.messages.splice(0, state.messages.length - MAX_MESSAGES);
}

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

export function count(inv: Inventory, item: ItemId): number {
  return inv[item] ?? 0;
}

export function addItem(inv: Inventory, item: ItemId, n = 1): void {
  const next = count(inv, item) + n;
  if (next <= 0) delete inv[item];
  else inv[item] = next;
}

export function removeItem(inv: Inventory, item: ItemId, n = 1): boolean {
  if (count(inv, item) < n) return false;
  addItem(inv, item, -n);
  return true;
}

export function hasBundle(p: Player, bundle: Bundle): boolean {
  if (p.gold < bundle.gold) return false;
  return Object.entries(bundle.items).every(([item, n]) => count(p.inv, item as ItemId) >= (n ?? 0));
}

export function bundleEmpty(bundle: Bundle): boolean {
  return bundle.gold === 0 && Object.values(bundle.items).every((n) => !n);
}

export function giveReward(p: Player, items: Inventory, gold = 0): void {
  p.gold += gold;
  for (const [item, n] of Object.entries(items)) addItem(p.inv, item as ItemId, n ?? 0);
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

export function heal(p: Player, n: number): void {
  p.hp = Math.min(p.maxHp, p.hp + n);
}

export function damage(state: GameState, p: Player, n: number, cause: string): void {
  if (!isAlive(p) || n <= 0) return;
  p.hp -= n;
  touch(state);
  if (p.hp <= 0) kill(state, p, cause);
}

/**
 * Raises the infection stage. Contact infections are absorbed once by the serum's
 * "vulnerability" shield. Stage 5 kills.
 */
export function infect(state: GameState, p: Player, n: number, source: 'contact' | 'other'): void {
  if (!isAlive(p) || n <= 0 || state.day < 3) return;
  if (source === 'contact' && p.vulnerable) {
    p.vulnerable = false;
    tell(state, p, 'msg.vulnerableAbsorbed');
    return;
  }
  p.infection = Math.min(MAX_INFECTION, p.infection + n);
  tell(state, p, 'msg.infected', { stage: p.infection });
  if (p.infection >= MAX_INFECTION) kill(state, p, 'plague');
}

/** A dead player stays where they fell, silent, until the summary. Then they rise as plague. */
export function kill(state: GameState, p: Player, cause: string): void {
  if (!isAlive(p)) return;
  p.status = 'dead';
  p.hp = 0;
  p.diedDay = state.day;
  p.haunt = null;
  p.workStart = null;
  p.isolatedUntil = null;
  state.attacks = state.attacks.filter((a) => a.attackerId !== p.id && a.targetId !== p.id);
  state.searches = state.searches.filter((s) => s.searcherId !== p.id && s.targetId !== p.id);
  state.offers = state.offers.filter((o) => o.fromId !== p.id && o.toId !== p.id);
  if (state.court?.accusedId === p.id) state.court = null;
  tell(state, p, 'msg.youDied', { cause });
  announceAt(state, p.location, 'msg.someoneDied', { victimId: p.id });
  touch(state);
}
