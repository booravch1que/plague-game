import { CASTE, DEFAULT_CONFIG, ROLE_ORDER, START_GOLD } from './constants';
import { startDay } from './phases';
import { shuffle } from './rng';
import { buildHostSpots, buildSchedule, buildSecrets } from './schedule';
import type { GameConfig, GameState, Player, PlayerId, Role } from './types';
import { pick, sys, tell } from './util';

export interface CreateGameOptions {
  playerIds: PlayerId[];
  seed: number;
  /** Real time the game starts at. */
  now: number;
  config?: Partial<GameConfig>;
}

/** Five core roles always play; the sixth seat is the citizen; seats 7-10 are residents. */
export function dealRoles(count: number): Role[] {
  const roles: Role[] = ROLE_ORDER.slice(0, Math.min(count, ROLE_ORDER.length));
  while (roles.length < count) roles.push('resident');
  return roles;
}

function newPlayer(id: PlayerId, role: Role): Player {
  const caste = CASTE[role];
  const citizen = role === 'citizen';
  return {
    id,
    role,
    caste,
    status: 'alive',
    publicStatus: 'alive',
    diedDay: null,
    hp: citizen ? 6 : 5,
    maxHp: citizen ? 6 : 5,
    hunger: citizen ? 10 : 8,
    thirst: citizen ? 6 : 5,
    infection: 0,
    vulnerable: false,
    usedSerum: false,
    gold: START_GOLD[caste] + (citizen ? 1 : 0),
    inv: role === 'ripper' ? { shiv: 1 } : citizen ? { rose: 1 } : {},
    stash: { gold: 0, items: {} },
    location: 'square',
    enteredAt: 0,
    moves: 0,
    actions: 0,
    attackActions: 0,
    shopping: false,
    exposureStart: null,
    exposedThisVisit: false,
    workStart: null,
    isolatedUntil: null,
    cooldowns: {},
    phaseUses: {},
    spent: {},
    autoAmnesty: true,
    taxDebt: 0,
    taxUnpaid: 0,
    attacksWon: 0,
    remedyProgress: 0,
    serumBonus: 0,
    ticketDiscount: 0,
    poisoned: false,
    bleeding: false,
    angelPenalty: false,
    stealthUses: 0,
    haunt: null,
    hauntDay: 0,
    ready: false,
    questDone: false,
    facts: [],
    met: {},
    alone: {},
    solo: {},
  };
}

export function createGame(options: CreateGameOptions): GameState {
  const ids = [...options.playerIds];
  const state: GameState = {
    rng: options.seed >>> 0,
    config: { ...DEFAULT_CONFIG, ...options.config },
    t: 0,
    lastNow: options.now,
    rev: 0,
    nextId: 0,
    day: 0,
    phase: { kind: 'over' },
    court: null,
    players: [],
    schedule: [],
    secret: {},
    hostSpot: {},
    shop: { market: {}, black: {} },
    looted: false,
    serum: 0,
    firstInfectedId: null,
    huntTargetId: null,
    convoyGot: [],
    corpse: null,
    fire: null,
    attacks: [],
    searches: [],
    offers: [],
    prompts: [],
    stealth: null,
    dice: [],
    messages: [],
    result: null,
  };

  const roles = dealRoles(ids.length);
  shuffle(state, roles);
  state.players = ids.map((id, i) => newPlayer(id, roles[i] as Role));
  state.schedule = buildSchedule(state);
  state.secret = buildSecrets(state);
  state.hostSpot = buildHostSpots(state);

  for (const p of state.players) tell(state, p, 'msg.yourRole', { role: p.role });
  const bachelor = state.players.find((p) => p.role === 'bachelor');
  if (bachelor) sys(state, 'all', 'msg.bachelorIs', { playerId: bachelor.id });
  const grif = state.players.find((p) => p.role === 'grif');
  if (grif) {
    const known = pick(state, state.players.filter((p) => p.caste === 'worker' && p.id !== grif.id));
    if (known) tell(state, grif, 'msg.grifKnows', { playerId: known.id, role: known.role });
  }

  startDay(state, 1);
  return state;
}
