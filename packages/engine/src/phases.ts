import { finishWork, rollSerum, settlePrompts } from './abilities';
import { finishSearch, resolveAttack } from './combat';
import {
  CORPSE_DELAY_MS,
  EVENT_LOCATIONS,
  EXPOSURE_MS,
  FIRE_WARNING_MS,
  DICE_VISIBLE_MS,
  LAST_DAY,
  SERUM_GOAL,
  WORK_MS,
} from './constants';
import { rollShop } from './economy';
import { enterLocation } from './movement';
import { checkQuests, questFor } from './quests';
import { closedToday, hasEvent, lootedBy } from './schedule';
import type { GameResult, GameState, LocationId, Player } from './types';
import {
  addItem,
  damage,
  findPlayer,
  infect,
  isAlive,
  isIsolated,
  kill,
  living,
  livingAt,
  nextId,
  pick,
  removeItem,
  sys,
  tell,
  touch,
  ready,
  useCooldown,
  usedThisPhase,
} from './util';

// ---------------------------------------------------------------------------
// Clock
// ---------------------------------------------------------------------------

/**
 * Brings the state up to real time `now`. The game clock runs only in day and
 * night and stands still during court and the summary. Long gaps are walked in
 * one-second steps so that timers fire in order.
 */
export function advance(state: GameState, now: number): void {
  let dt = Math.max(0, now - state.lastNow);
  state.lastNow = now;

  if (state.court) {
    if (now >= state.court.endsAtReal) closeCourt(state);
    return;
  }

  while ((state.phase.kind === 'day' || state.phase.kind === 'night') && !state.court && dt > 0) {
    const step = Math.min(dt, 1000, Math.max(0, state.phase.endsAt - state.t));
    track(state, step);
    state.t += step;
    dt -= step;
    runTimers(state);
    if ((state.phase.kind === 'day' || state.phase.kind === 'night') && state.t >= state.phase.endsAt) endPhase(state, now);
    if (step === 0) break;
  }

  if (state.phase.kind === 'summary') {
    const everyoneReady = living(state).every((p) => p.ready);
    if (now >= state.phase.endsAtReal || everyoneReady) endSummary(state);
  }
}

/** Time spent together (for tasks) and exposure to infected neighbours. */
function track(state: GameState, step: number): void {
  if (step <= 0) return;
  const groups = new Map<LocationId, Player[]>();
  for (const p of living(state)) groups.set(p.location, [...(groups.get(p.location) ?? []), p]);
  for (const [location, group] of groups) {
    for (const p of group) {
      const others = group.filter((q) => q.id !== p.id);
      for (const q of others) {
        const key = `${location}|${q.id}`;
        p.met[key] = (p.met[key] ?? 0) + step;
        if (group.length === 2) p.alone[key] = (p.alone[key] ?? 0) + step;
      }
      if (group.length === 1) p.solo[location] = (p.solo[location] ?? 0) + step;
      const nearInfected = others.some((q) => q.infection > 0);
      if (!nearInfected) p.exposureStart = null;
      else if (p.exposureStart === null) p.exposureStart = state.t;
    }
  }
}

function runTimers(state: GameState): void {
  const t = state.t;
  for (const p of living(state)) {
    if (p.exposureStart !== null && !p.exposedThisVisit && t - p.exposureStart >= EXPOSURE_MS) {
      p.exposedThisVisit = true;
      infect(state, p, 1, 'contact');
    }
    if (isAlive(p) && p.workStart !== null && p.location === 'factory' && t - p.workStart >= WORK_MS) finishWork(state, p);
  }
  for (const attack of state.attacks.filter((a) => a.deadline <= t)) resolveAttack(state, attack);
  for (const search of state.searches.filter((s) => s.deadline <= t)) finishSearch(state, search.id, undefined);
  const before = state.offers.length;
  state.offers = state.offers.filter((o) => o.deadline > t);
  if (state.offers.length !== before) touch(state);
  if (state.stealth && state.stealth.until < t) {
    state.stealth = null;
    touch(state);
  }
  state.dice = state.dice.filter((d) => t - d.at < DICE_VISIBLE_MS);
  if (state.corpse && !state.corpse.taken && t >= state.corpse.spawnAt && t - 1000 < state.corpse.spawnAt) {
    sys(state, 'all', 'msg.corpseFound');
  }
  if (state.fire && !state.fire.revealed && t >= state.fire.revealAt) {
    state.fire.revealed = true;
    sys(state, 'all', 'msg.fireRevealed', { loc: state.fire.location });
  }
  checkQuests(state);
}

function endPhase(state: GameState, now: number): void {
  if (state.phase.kind === 'day') {
    flushPending(state);
    burn(state);
    startNight(state);
  } else if (state.phase.kind === 'night') {
    flushPending(state);
    endOfDay(state, now);
  }
}

/** Fights and searches still waiting are settled when a phase ends; offers lapse. */
function flushPending(state: GameState): void {
  for (const attack of [...state.attacks]) resolveAttack(state, attack);
  for (const search of [...state.searches]) finishSearch(state, search.id, undefined);
  state.offers = [];
  state.stealth = null;
  for (const p of state.players) p.workStart = null;
  touch(state);
}

// ---------------------------------------------------------------------------
// Day and night
// ---------------------------------------------------------------------------

function worksAtFactory(state: GameState, p: Player): boolean {
  if (p.caste === 'elite') return false;
  if (p.role === 'angel' && state.day === 5) return false;
  return !closedToday(state, 'factory');
}

function resetDaily(p: Player): void {
  p.facts = [];
  p.met = {};
  p.alone = {};
  p.solo = {};
  p.questDone = false;
  p.ready = false;
  p.stealthUses = 0;
  p.poisoned = false;
  p.bleeding = false;
  p.haunt = null;
}

function place(state: GameState, p: Player, location: LocationId): void {
  p.location = location;
  p.enteredAt = state.t;
  p.shopping = false;
  p.exposureStart = null;
  p.exposedThisVisit = false;
  p.workStart = null;
}

export function startDay(state: GameState, day: number): void {
  state.day = day;
  state.phase = { kind: 'day', endsAt: state.t + state.config.dayMs };
  state.looted = lootedBy(state, day);
  state.shop = rollShop(state);
  state.convoyGot = [];
  state.dice = [];
  state.stealth = null;
  state.corpse = hasEvent(state, 'corpse') ? { spawnAt: state.t + CORPSE_DELAY_MS, taken: false } : null;
  state.fire = hasEvent(state, 'fire')
    ? { location: pick(state, EVENT_LOCATIONS) as LocationId, revealAt: state.phase.endsAt - FIRE_WARNING_MS, revealed: false }
    : null;

  sys(state, 'all', 'msg.dayStarts', { day });
  for (const event of state.schedule[day] ?? []) sys(state, 'all', `event.${event}.now`);

  for (const p of state.players) {
    resetDaily(p);
    if (!isAlive(p)) continue;
    const penalty = p.angelPenalty ? 1 : 0;
    p.angelPenalty = false;
    if (isIsolated(p)) {
      place(state, p, 'isolator');
      p.moves = 0;
      p.actions = 0;
      p.attackActions = 0;
      continue;
    }
    p.moves = 3 + (p.role === 'citizen' ? 1 : 0);
    p.actions = Math.max(0, 3 + (p.role === 'haruspex' || p.role === 'angel' ? 1 : 0) - penalty);
    p.attackActions = p.role === 'ripper' ? 1 : 0;
    if (worksAtFactory(state, p)) {
      place(state, p, 'factory');
      p.workStart = state.t;
    } else {
      place(state, p, 'square');
    }
  }

  if (hasEvent(state, 'alarm')) seedPlague(state);
  if (hasEvent(state, 'symptoms')) {
    for (const p of living(state)) if (p.infection > 0) damage(state, p, 1, 'plague');
  }
  if (hasEvent(state, 'rats')) {
    for (const p of living(state)) if (removeItem(p.inv, 'rusk')) tell(state, p, 'msg.ratsAte');
  }
  const bachelor = state.players.find((p) => p.role === 'bachelor' && isAlive(p));
  if (hasEvent(state, 'forcedLabor') && bachelor) {
    state.prompts.push({ id: nextId(state), playerId: bachelor.id, kind: 'forcedWater', pick: 1 });
  }
  for (const p of living(state)) questFor(p, day)?.onStart?.(state, p);
  touch(state);
}

/** Day 3: the first infection. A random living player who is not the bachelor. */
function seedPlague(state: GameState): void {
  const first = pick(state, living(state).filter((p) => p.role !== 'bachelor'));
  if (!first) return;
  state.firstInfectedId = first.id;
  infect(state, first, 1, 'other');
}

function startNight(state: GameState): void {
  state.phase = { kind: 'night', endsAt: state.t + state.config.nightMs };
  sys(state, 'all', 'msg.nightStarts', { day: state.day });
  if (hasEvent(state, 'curfew')) sys(state, 'all', 'msg.curfew');
  for (const p of living(state)) {
    p.shopping = false;
    if (isIsolated(p)) continue;
    p.moves = 2 + (p.role === 'haruspex' ? 1 : 0);
    p.actions = 2 + (p.role === 'angel' ? 1 : 0);
    p.attackActions = p.role === 'ripper' ? 1 : 0;
  }
  const ripper = state.players.find((p) => p.role === 'ripper' && isAlive(p));
  state.huntTargetId = null;
  if (ripper) {
    const prey = pick(state, living(state).filter((p) => p.id !== ripper.id && p.role !== 'bachelor' && !isIsolated(p)));
    if (prey) {
      state.huntTargetId = prey.id;
      tell(state, ripper, 'msg.huntTarget', { playerId: prey.id });
    }
  }
  touch(state);
}

/** Day 10: the chosen district burns at the end of the day with everyone inside. */
function burn(state: GameState): void {
  if (!state.fire) return;
  const location = state.fire.location;
  for (const p of livingAt(state, location)) kill(state, p, 'fire');
  sys(state, 'all', 'msg.fireBurned', { loc: location });
  state.fire = null;
}

// ---------------------------------------------------------------------------
// End of day
// ---------------------------------------------------------------------------

function upkeep(day: number): { hunger: number; thirst: number } {
  if (day <= 5) return { hunger: 1, thirst: 1 };
  if (day <= 9) return { hunger: 2, thirst: 1 };
  return { hunger: 2, thirst: 2 };
}

function endOfDay(state: GameState, now: number): void {
  const day = state.day;
  const bachelor = state.players.find((p) => p.role === 'bachelor');
  if (bachelor && isAlive(bachelor) && bachelor.location === 'townhall' && !usedThisPhase(state, bachelor, 'serumRoll') && state.serum < SERUM_GOAL) {
    rollSerum(state, bachelor, true);
  }

  const cost = upkeep(day);
  for (const p of living(state)) {
    p.hunger = Math.max(0, p.hunger - cost.hunger);
    p.thirst = Math.max(0, p.thirst - cost.thirst);
    let starving = (p.hunger === 0 ? 1 : 0) + (p.thirst === 0 ? 1 : 0);
    if (starving > 0 && p.role === 'citizen' && !p.spent.survivalist) {
      p.spent.survivalist = true;
      starving = 0;
      tell(state, p, 'msg.survivalist');
    }
    if (starving > 0) {
      tell(state, p, 'msg.starving', { n: starving });
      damage(state, p, starving, 'hunger');
    }
    if (isAlive(p) && p.role === 'citizen') payTaxes(state, p);
    if (isAlive(p) && p.poisoned) damage(state, p, 1, 'poison');
    if (isAlive(p) && p.bleeding) {
      tell(state, p, 'msg.bleeding');
      damage(state, p, 1, 'bleeding');
    }
  }

  if (day === 4) {
    for (const p of living(state)) addItem(p.inv, 'rationBig');
    sys(state, 'all', 'msg.rationsAll');
  }
  if (bachelor && isAlive(bachelor) && (day === 5 || day === 6)) {
    state.prompts.push({ id: nextId(state), playerId: bachelor.id, kind: day === 5 ? 'rations5' : 'rations6', pick: day === 5 ? 2 : 1 });
  }

  for (const p of living(state)) {
    if (p.isolatedUntil !== null && p.isolatedUntil <= day) {
      p.isolatedUntil = null;
      place(state, p, 'square');
      tell(state, p, 'msg.released');
    }
  }

  const died = state.players.filter((p) => p.status === 'dead' && p.publicStatus === 'alive').map((p) => p.id);
  const escaped = state.players.filter((p) => p.status === 'escaped' && p.publicStatus === 'alive').map((p) => p.id);
  for (const p of state.players) {
    p.publicStatus = p.status;
    p.haunt = null;
  }
  sys(state, 'all', 'msg.summary', { day, died: died.join(',') || '-', escaped: escaped.join(',') || '-', serum: state.serum });

  if (day >= LAST_DAY || living(state).length === 0) {
    finish(state);
    return;
  }

  state.phase = { kind: 'summary', endsAtReal: now + state.config.summaryMs };
  for (const p of state.players) p.ready = false;
  for (const event of state.schedule[day + 1] ?? []) sys(state, 'all', `event.${event}.soon`);
  const secret = state.secret[day + 1];
  if (secret) sys(state, living(state).map((p) => p.id), `secret.${secret.kind}`, { loc: secret.location });
  touch(state);
}

function payTaxes(state: GameState, p: Player): void {
  const due = 1 + p.taxDebt;
  if (p.gold >= due) {
    p.gold -= due;
    p.taxDebt = 0;
    p.taxUnpaid = 0;
    return;
  }
  p.taxDebt = due;
  p.taxUnpaid += 1;
  tell(state, p, 'msg.taxDebt', { debt: due });
  if (p.taxUnpaid >= 3) damage(state, p, 2, 'taxes');
}

function endSummary(state: GameState): void {
  settlePrompts(state);
  startDay(state, state.day + 1);
}

// ---------------------------------------------------------------------------
// Court
// ---------------------------------------------------------------------------

export function closeCourt(state: GameState): void {
  const court = state.court;
  if (!court) return;
  state.court = null;
  const votes = Object.values(court.votes);
  const guilty = votes.filter(Boolean).length;
  const innocent = votes.length - guilty;
  const accused = findPlayer(state, court.accusedId);
  const convicted = guilty > innocent && accused !== undefined && isAlive(accused);
  sys(state, 'all', convicted ? 'msg.courtGuilty' : 'msg.courtAcquitted', { accusedId: court.accusedId, guilty, innocent });
  if (convicted && accused) {
    if (accused.role === 'grif' && accused.autoAmnesty && ready(accused, 'amnesty', 3, state.day)) {
      useCooldown(accused, 'amnesty', state.day);
      sys(state, 'all', 'msg.courtAmnesty', { accusedId: accused.id });
    } else {
      state.attacks = state.attacks.filter((a) => a.attackerId !== accused.id && a.targetId !== accused.id);
      enterLocation(state, accused, 'isolator');
      accused.isolatedUntil = state.day + 1;
      accused.moves = 0;
      accused.actions = 0;
      accused.attackActions = 0;
    }
  }
  touch(state);
}

// ---------------------------------------------------------------------------
// Game over
// ---------------------------------------------------------------------------

export function finish(state: GameState): void {
  const serumReady = state.serum >= SERUM_GOAL;
  const alive = living(state);
  const winner: GameResult['winner'] = serumReady && alive.length > 0 ? 'town' : 'plague';
  state.phase = { kind: 'over' };
  state.court = null;
  state.result = {
    winner,
    serumReady,
    players: state.players.map((p) => {
      let won = false;
      if (p.status === 'escaped') won = p.caste === 'bandit';
      else if (p.status === 'dead') won = winner === 'plague';
      else if (p.caste === 'bandit') won = false;
      else won = serumReady && p.usedSerum;
      return { id: p.id, role: p.role, status: p.status, won };
    }),
  };
  sys(state, 'all', winner === 'town' ? 'msg.townWins' : 'msg.plagueWins');
  touch(state);
}

