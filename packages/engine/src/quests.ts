import { HOST_MS, MEET_MS, REMEDY_GOAL } from './constants';
import type { GameState, Inventory, LocationId, Player, PlayerId, Role } from './types';
import { addItem, giveReward, heal, isAlive, nextId, tell, touch } from './util';

export interface Reward {
  gold?: number;
  items?: Inventory;
  hp?: number;
  serumBonus?: number;
  remedy?: number;
  ticketDiscount?: number;
}

export interface Quest {
  /** Checked after every change while the quest is open. */
  check?: (state: GameState, p: Player) => boolean;
  reward: Reward;
  /** Runs at the start of the quest's day. */
  onStart?: (state: GameState, p: Player) => void;
  /** Runs when the quest is completed, after the reward. */
  onDone?: (state: GameState, p: Player) => void;
  /** Completed by code elsewhere (a special roll), never by `check`. */
  manual?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers over the daily trackers
// ---------------------------------------------------------------------------

function sum(record: Record<string, number>, predicate: (location: string, other: string) => boolean): number {
  let total = 0;
  for (const [key, ms] of Object.entries(record)) {
    const [location = '', other = ''] = key.split('|');
    if (predicate(location, other)) total += ms;
  }
  return total;
}

function byRole(state: GameState, role: Role): PlayerId | null {
  return state.players.find((p) => p.role === role)?.id ?? null;
}

/** Met `other` (by id) for at least MEET_MS, optionally only in `location`. */
export function met(p: Player, other: PlayerId | null, location?: LocationId): boolean {
  if (other === null) return false;
  return sum(p.met, (l, o) => o === other && (location === undefined || l === location)) >= MEET_MS;
}

export function metAlone(p: Player, other: PlayerId | null): boolean {
  if (other === null) return false;
  return sum(p.alone, (_l, o) => o === other) >= MEET_MS;
}

/** Number of different people met for at least MEET_MS (each meeting counted per location). */
export function metDistinct(p: Player, location?: LocationId): number {
  const people = new Set<string>();
  for (const [key, ms] of Object.entries(p.met)) {
    const [l, o] = key.split('|');
    if (ms >= MEET_MS && o && (location === undefined || l === location)) people.add(o);
  }
  return people.size;
}

function factsWith(p: Player, prefix: string): Set<string> {
  return new Set(p.facts.filter((f) => f.startsWith(prefix)).map((f) => f.slice(prefix.length)));
}

const has = (p: Player, fact: string) => p.facts.includes(fact);

function hostMet(state: GameState, p: Player): boolean {
  const spot = state.hostSpot[state.day];
  return spot !== undefined && (p.solo[spot] ?? 0) >= HOST_MS;
}

// ---------------------------------------------------------------------------
// The tasks. Index = day. See docs/RULES.md §14.
// ---------------------------------------------------------------------------

type Book = Partial<Record<number, Quest>>;

const bachelor: Book = {
  1: { check: (_s, p) => metDistinct(p) >= 3, reward: { gold: 2 } },
  2: { check: (_s, p) => metDistinct(p, 'townhall') >= 2, reward: { items: { bandage: 1 } } },
  3: { check: (_s, p) => has(p, 'megaphone') && metDistinct(p, 'townhall') >= 2, reward: { serumBonus: 1 } },
  4: { check: (_s, p) => has(p, 'heal'), reward: { items: { immunizer: 1 } } },
  5: {
    check: hostMet,
    reward: {},
    onStart: (s, p) => tell(s, p, 'quest.hostWaits', { loc: s.hostSpot[5] ?? 'square' }),
    onDone: (s, p) => {
      s.prompts.push({ id: nextId(s), playerId: p.id, kind: 'intel', pick: 1 });
      touch(s);
    },
  },
  6: { check: (_s, p) => has(p, 'ingredientsReceived'), reward: { gold: 1 } },
  7: { check: (_s, p) => has(p, 'court'), reward: { gold: 3 } },
  8: { check: (_s, p) => factsWith(p, 'search:').size >= 2, reward: { items: { bandage: 1, rusk: 1 } } },
  9: { check: (_s, p) => factsWith(p, 'got:').size >= 2, reward: { items: { immunizer: 1 } } },
  10: { manual: true, reward: {} },
};

const haruspex: Book = {
  1: { check: (s, p) => metAlone(p, byRole(s, 'angel')), reward: { items: { rusk: 1 } } },
  2: { check: (_s, p) => has(p, 'well:others'), reward: { items: { water: 1 } } },
  3: {
    check: (s, p) => p.infection === 0 && s.firstInfectedId !== p.id && metAlone(p, s.firstInfectedId),
    reward: { items: { ingredient: 1 } },
  },
  4: { check: (_s, p) => has(p, 'remedy:others'), reward: { remedy: 1 } },
  5: { check: (s, p) => metAlone(p, byRole(s, 'bachelor')), reward: { items: { bandage: 1 } } },
  6: { check: (_s, p) => has(p, 'donated'), reward: { gold: 2 } },
  7: { check: (_s, p) => factsWith(p, 'medicine:').size >= 1, reward: { items: { ingredient: 1 } } },
  8: { check: (s, p) => met(p, byRole(s, 'angel'), 'cemetery'), reward: { items: { ingredient: 1 } } },
  9: { manual: true, reward: {} },
  10: { check: (_s, p) => has(p, 'serumHelp'), reward: { items: { canned: 1 } } },
};

const angel: Book = {
  1: { check: (_s, p) => metDistinct(p) >= 2, reward: { items: { rusk: 1 } } },
  2: { check: (_s, p) => has(p, 'well:others'), reward: { items: { water: 1 } } },
  3: { check: (s, p) => metAlone(p, byRole(s, 'bachelor')), reward: { items: { bandage: 1 } } },
  4: { check: (_s, p) => has(p, 'trade'), reward: { gold: 2 } },
  5: { check: () => true, reward: {} },
  6: { check: (_s, p) => has(p, 'witness'), reward: { gold: 2 } },
  7: { check: (_s, p) => has(p, 'premonition'), reward: { items: { rusk: 1 } } },
  8: { check: (s, p) => met(p, byRole(s, 'haruspex'), 'cemetery'), reward: { items: { immunizer: 1 } } },
  9: { check: (_s, p) => has(p, 'premonition') && has(p, 'note'), reward: { gold: 3 } },
  10: { check: (_s, p) => has(p, 'serum'), reward: { hp: 1 } },
};

const grif: Book = {
  1: { check: (s, p) => metAlone(p, byRole(s, 'bachelor')), reward: { items: { rationSmall: 1 } } },
  2: { check: (_s, p) => has(p, 'blackBuy'), reward: { gold: 1 } },
  3: { check: (_s, p) => has(p, 'tradeAlone'), reward: { items: { rusk: 1 } } },
  4: {
    check: hostMet,
    reward: { items: { ticket: 1 } },
    onStart: (s, p) => tell(s, p, 'quest.hostWaits', { loc: s.hostSpot[4] ?? 'square' }),
    onDone: (s, p) => tell(s, p, 'quest.grif.ticket'),
  },
  5: {
    check: (_s, p) => metDistinct(p, 'station') >= 1,
    reward: { gold: 2 },
    onStart: (s, p) => tell(s, p, 'quest.grif.hint'),
  },
  6: { check: (_s, p) => has(p, 'searched'), reward: { gold: 2 } },
  7: { check: (_s, p) => has(p, 'stash'), reward: { items: { rusk: 1 } } },
  8: { check: (_s, p) => factsWith(p, 'trade:').size >= 2, reward: { items: { canned: 1 } } },
  9: { check: (_s, p) => has(p, 'serumHelp'), reward: { items: { immunizer: 1 } } },
  10: { check: (_s, p) => metDistinct(p) >= 2, reward: { gold: 2 } },
};

const citizen: Book = {
  1: { check: (_s, p) => metDistinct(p) >= 3, reward: { gold: 1 } },
  2: { check: (_s, p) => has(p, 'well'), reward: { items: { water: 1 } } },
  3: { check: (_s, p) => has(p, 'tradeAlone'), reward: { items: { rusk: 1 } } },
  4: { check: (_s, p) => has(p, 'attack:square'), reward: { gold: 3, items: { water: 1 } } },
  5: { check: (_s, p) => has(p, 'gaveGold'), reward: { items: { bandage: 1 } } },
  6: { check: (_s, p) => metDistinct(p, 'cemetery') >= 1, reward: { items: { rusk: 1 } } },
  7: { check: (_s, p) => has(p, 'vote'), reward: { gold: 2 } },
  8: { check: (_s, p) => has(p, 'feedIsolated') || has(p, 'feedInfected'), reward: { items: { canned: 1 } } },
  9: { check: (_s, p) => has(p, 'serumHelp'), reward: { items: { immunizer: 1 } } },
  10: { check: (_s, p) => factsWith(p, 'trade:').size >= 2, reward: { hp: 1 } },
};

const ripper: Book = {
  1: { check: (_s, p) => has(p, 'bleed:factory'), reward: { items: { trophy: 1 } } },
  2: { check: (_s, p) => has(p, 'hit:haruspex') || has(p, 'hit:angel'), reward: { gold: 2 } },
  3: {
    check: (_s, p) => has(p, 'poison'),
    reward: { items: { trophy: 1 } },
    onStart: (s, p) => {
      addItem(p.inv, 'poisonRusk');
      tell(s, p, 'quest.ripper.poison');
    },
  },
  4: { check: (_s, p) => has(p, 'attackOk:night'), reward: { gold: 2 } },
  5: {
    check: (s, p) => metAlone(p, byRole(s, 'grif')),
    reward: { ticketDiscount: 3 },
    onStart: (s, p) => tell(s, p, 'quest.ripper.hint'),
  },
  6: { check: (_s, p) => has(p, 'attack:cemetery'), reward: { items: { trophy: 1 } } },
  7: { check: (_s, p) => has(p, 'attackOk'), reward: { gold: 2 } },
  8: { check: (_s, p) => has(p, 'stealth'), reward: { items: { trophy: 1 } } },
  9: { check: (_s, p) => p.gold >= 20, reward: { items: { trophy: 1 } } },
};

export const QUESTS: Record<Role, Book> = { bachelor, haruspex, angel, grif, citizen, ripper, resident: {} };

export function questFor(p: Player, day: number): Quest | undefined {
  return QUESTS[p.role][day];
}

export function grantReward(state: GameState, p: Player, reward: Reward): void {
  giveReward(p, reward.items ?? {}, reward.gold ?? 0);
  if (reward.hp) heal(p, reward.hp);
  if (reward.serumBonus) p.serumBonus += reward.serumBonus;
  if (reward.remedy) addRemedyProgress(state, p, reward.remedy);
  if (reward.ticketDiscount) p.ticketDiscount += reward.ticketDiscount;
  touch(state);
}

/** Folk remedy research: every REMEDY_GOAL points brew one dose. */
export function addRemedyProgress(state: GameState, p: Player, n: number): void {
  p.remedyProgress += n;
  while (p.remedyProgress >= REMEDY_GOAL) {
    p.remedyProgress -= REMEDY_GOAL;
    addItem(p.inv, 'folkRemedy');
    tell(state, p, 'msg.remedyReady');
  }
  touch(state);
}

export function completeQuest(state: GameState, p: Player): void {
  const quest = questFor(p, state.day);
  if (!quest || p.questDone || !isAlive(p)) return;
  p.questDone = true;
  grantReward(state, p, quest.reward);
  tell(state, p, 'quest.done', { day: state.day });
  quest.onDone?.(state, p);
}

/** Checks every open task. Cheap: a handful of players and lookups. */
export function checkQuests(state: GameState): void {
  if (state.phase.kind !== 'day' && state.phase.kind !== 'night') return;
  for (const p of state.players) {
    if (p.questDone || !isAlive(p)) continue;
    const quest = questFor(p, state.day);
    if (quest?.check && !quest.manual && quest.check(state, p)) completeQuest(state, p);
  }
}
