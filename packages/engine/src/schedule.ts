import { EVENT_LOCATIONS, LAST_DAY, LOCATIONS } from './constants';
import { randomInt, shuffle } from './rng';
import type { DayEvent, GameState, LocationId, MsgParams, SecretEvent } from './types';
import { isAlive, living, pick } from './util';

const POOL: readonly DayEvent[] = ['waterShortage', 'symptoms', 'forcedLabor', 'corpse', 'curfew', 'convoy', 'rats'];
const COUPON_ARC: readonly DayEvent[] = ['couponsSale', 'couponsFood', 'couponsWater', 'looting'];

/**
 * Days 1-3 and 10 are fixed. Days 4-9 each get one event from the pool, and the
 * four-day coupon arc lands on four consecutive days starting on day 4, 5 or 6.
 */
export function buildSchedule(state: GameState): DayEvent[][] {
  const schedule: DayEvent[][] = Array.from({ length: LAST_DAY + 1 }, () => []);
  schedule[2] = ['well', 'rumors'];
  schedule[3] = ['alarm'];
  schedule[LAST_DAY] = ['fire'];

  const pool = [...POOL];
  shuffle(state, pool);
  for (let day = 4; day <= 9; day++) schedule[day]?.push(pool[day - 4] as DayEvent);

  const start = 4 + randomInt(state, 3);
  COUPON_ARC.forEach((event, i) => schedule[start + i]?.push(event));
  return schedule;
}

/** Every second day from day 4 one location is closed or contaminated. */
export function buildSecrets(state: GameState): Record<number, SecretEvent> {
  const out: Record<number, SecretEvent> = {};
  for (const day of [4, 6, 8]) {
    out[day] = {
      kind: randomInt(state, 2) === 0 ? 'closed' : 'infected',
      location: pick(state, EVENT_LOCATIONS) as LocationId,
    };
  }
  return out;
}

/** Where the host "waits" on the days with private-meeting tasks. */
export function buildHostSpots(state: GameState): Record<number, LocationId> {
  const choices = LOCATIONS.filter((l) => l !== 'isolator' && l !== 'square');
  const out: Record<number, LocationId> = {};
  for (const day of [4, 5]) {
    const closed = state.secret[day]?.kind === 'closed' ? state.secret[day]?.location : undefined;
    out[day] = pick(state, choices.filter((l) => l !== closed)) as LocationId;
  }
  return out;
}

export function hasEvent(state: GameState, event: DayEvent, day = state.day): boolean {
  return state.schedule[day]?.includes(event) ?? false;
}

/** The coupon arc's looting lasts from its day to the end of the game. */
export function lootedBy(state: GameState, day: number): boolean {
  for (let d = 1; d <= day; d++) if (hasEvent(state, 'looting', d)) return true;
  return false;
}

export function closedToday(state: GameState, location: LocationId): boolean {
  const secret = state.secret[state.day];
  if (secret?.kind === 'closed' && secret.location === location) return true;
  if (location === 'factory' && hasEvent(state, 'couponsSale')) return true;
  return false;
}

export function contaminatedToday(state: GameState, location: LocationId): boolean {
  const secret = state.secret[state.day];
  return secret?.kind === 'infected' && secret.location === location;
}

/**
 * A rumour from the square. True ones come from real facts of this game; false
 * ones sound just as plausible.
 */
export function makeRumor(state: GameState, hearerId: string, truthful: boolean): { key: string; params: MsgParams } {
  const others = living(state).filter((p) => p.id !== hearerId);
  if (truthful) {
    const honest = others.filter((p) => p.caste === 'worker');
    const rich = others.filter((p) => p.gold >= 4);
    const nextEvents = state.schedule[state.day + 1] ?? [];
    const options: { key: string; params: MsgParams }[] = [{ key: 'rumor.true.bandit', params: {} }];
    const worker = pick(state, honest);
    if (worker) options.push({ key: 'rumor.true.honest', params: { playerId: worker.id } });
    const wealthy = pick(state, rich);
    if (wealthy) options.push({ key: 'rumor.true.rich', params: { playerId: wealthy.id } });
    const upcoming = pick(state, nextEvents);
    if (upcoming) options.push({ key: 'rumor.true.event', params: { event: upcoming } });
    return pick(state, options) as { key: string; params: MsgParams };
  }
  const innocent = pick(state, others.filter((p) => p.caste !== 'bandit' && isAlive(p)));
  const options: { key: string; params: MsgParams }[] = [
    { key: 'rumor.false.elite', params: {} },
    { key: 'rumor.false.freeMedicine', params: {} },
    { key: 'rumor.false.cure', params: {} },
  ];
  if (innocent) options.push({ key: 'rumor.false.bandit', params: { playerId: innocent.id } });
  return pick(state, options) as { key: string; params: MsgParams };
}
