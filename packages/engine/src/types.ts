export type PlayerId = string;

export type Role = 'bachelor' | 'haruspex' | 'angel' | 'grif' | 'citizen' | 'ripper' | 'resident';
export type Caste = 'elite' | 'worker' | 'bandit';

export type LocationId =
  | 'square'
  | 'factory'
  | 'townhall'
  | 'market'
  | 'blackmarket'
  | 'cemetery'
  | 'station'
  | 'isolator';

export type ItemId =
  | 'rusk'
  | 'canned'
  | 'water'
  | 'rationSmall'
  | 'rationBig'
  | 'bandage'
  | 'immunizer'
  | 'serum'
  | 'folkRemedy'
  | 'strongPotion'
  | 'coupon'
  | 'ingredient'
  | 'trophy'
  | 'ticket'
  | 'poisonRusk'
  | 'shiv'
  | 'rose';

export type Inventory = Partial<Record<ItemId, number>>;

export interface Bundle {
  gold: number;
  items: Inventory;
}

/** Public events of a day. Several can happen on the same day. */
export type DayEvent =
  | 'well'
  | 'rumors'
  | 'alarm'
  | 'waterShortage'
  | 'symptoms'
  | 'forcedLabor'
  | 'corpse'
  | 'curfew'
  | 'convoy'
  | 'rats'
  | 'couponsSale'
  | 'couponsFood'
  | 'couponsWater'
  | 'looting'
  | 'fire';

/** A location closed or contaminated for one day. Each player is told privately. */
export interface SecretEvent {
  kind: 'closed' | 'infected';
  location: LocationId;
}

/** Modifiers a player may add to an attack or a defence roll. */
export type CombatMod = 'sneak' | 'booze' | 'allIn';
export type LootKind = 'gold' | 'food' | 'water';
export type FleeAbility = 'fastLegs' | 'nightCover';

export type PlayerStatus = 'alive' | 'dead' | 'escaped';

export interface Player {
  id: PlayerId;
  role: Role;
  caste: Caste;
  status: PlayerStatus;
  /** What everybody else believes, updated at the end-of-day summary. */
  publicStatus: PlayerStatus;
  diedDay: number | null;

  hp: number;
  maxHp: number;
  hunger: number;
  thirst: number;
  infection: number;
  /** After serum: the next infection from contact is ignored. */
  vulnerable: boolean;
  usedSerum: boolean;

  gold: number;
  inv: Inventory;
  /** Grif's deep pockets: invisible to searches and attackers. */
  stash: Bundle;

  location: LocationId;
  /** Game-clock time of entering the current location. */
  enteredAt: number;
  moves: number;
  actions: number;
  /** Ripper only: actions that can be spent on attacks only. */
  attackActions: number;
  /** A shop visit costs one action, then buying and selling there is free until leaving. */
  shopping: boolean;

  /** Game-clock time since which an infected player has been next to this one, without a break. */
  exposureStart: number | null;
  exposedThisVisit: boolean;

  /** Game-clock time the factory shift started, or null when not working. */
  workStart: number | null;
  /** Locked into the isolator until the summary of this day. */
  isolatedUntil: number | null;

  /** Last day an ability was used, for "once every N days" limits. */
  cooldowns: Partial<Record<string, number>>;
  /** Abilities already used in the current phase ("day3"/"night3"). */
  phaseUses: Partial<Record<string, string>>;
  /** One-shot abilities. */
  spent: Partial<Record<'survivalist' | 'allIn' | 'suspicion', boolean>>;
  autoAmnesty: boolean;

  taxDebt: number;
  taxUnpaid: number;
  attacksWon: number;
  remedyProgress: number;
  serumBonus: number;
  ticketDiscount: number;
  poisoned: boolean;
  bleeding: boolean;
  angelPenalty: boolean;
  stealthUses: number;
  /** Dead only: the location this ghost is listening in, and the day of its last visit. */
  haunt: LocationId | null;
  hauntDay: number;
  ready: boolean;

  questDone: boolean;
  /** Things done today, used to check personal tasks ("trade:<id>", "attackOk", …). */
  facts: string[];
  /** Milliseconds spent together today, keyed "<location>|<otherId>". */
  met: Record<string, number>;
  /** Same, but only when the two were alone. */
  alone: Record<string, number>;
  /** Milliseconds spent as the only living person in a location, keyed by location. */
  solo: Partial<Record<LocationId, number>>;
}

export type Phase =
  | { kind: 'day'; endsAt: number }
  | { kind: 'night'; endsAt: number }
  | { kind: 'summary'; endsAtReal: number }
  | { kind: 'over' };

export interface Court {
  accusedId: PlayerId;
  endsAtReal: number;
  votes: Record<PlayerId, boolean>;
}

export interface Attack {
  id: number;
  attackerId: PlayerId;
  targetId: PlayerId;
  location: LocationId;
  loot: LootKind;
  mods: CombatMod[];
  /** Game-clock deadline for the defender's answer. */
  deadline: number;
  usedAttackAction: boolean;
}

export interface Search {
  id: number;
  searcherId: PlayerId;
  targetId: PlayerId;
  deadline: number;
}

export interface Offer {
  id: number;
  kind: 'trade' | 'ticket';
  fromId: PlayerId;
  toId: PlayerId;
  give: Bundle;
  want: Bundle;
  deadline: number;
}

export type PromptKind = 'rations5' | 'rations6' | 'forcedWater' | 'intel';

/** A choice the server waits for (the bachelor's rations, the intel reward). */
export interface Prompt {
  id: number;
  playerId: PlayerId;
  kind: PromptKind;
  /** How many players must be picked. */
  pick: number;
}

export type MsgParams = Record<string, string | number>;

export interface Message {
  id: number;
  day: number;
  /** Recipients. 'all' includes spectators. */
  to: 'all' | PlayerId[];
  kind: 'chat' | 'sys' | 'ghost' | 'note';
  location?: LocationId;
  fromId?: PlayerId;
  text?: string;
  key?: string;
  params?: MsgParams;
}

/** A visible roll. Everyone in the location sees it for 20 seconds of game time. */
export interface DiceEntry {
  id: number;
  location: LocationId;
  at: number;
  key: string;
  params: MsgParams;
  attack: boolean;
}

export interface ShopState {
  /** Today's market prices (before the black market markup). Missing = not in stock today. */
  market: Partial<Record<ItemId, number>>;
  black: Partial<Record<ItemId, number>>;
}

export interface GameConfig {
  dayMs: number;
  nightMs: number;
  summaryMs: number;
  courtMs: number;
}

export interface PlayerResult {
  id: PlayerId;
  role: Role;
  status: PlayerStatus;
  won: boolean;
}

export interface GameResult {
  winner: 'town' | 'plague';
  serumReady: boolean;
  players: PlayerResult[];
}

export interface GameState {
  rng: number;
  config: GameConfig;
  /** Game clock in ms. It only runs during day and night, and stops for court. */
  t: number;
  /** Real time of the last update. */
  lastNow: number;
  /** Bumped by every change a client should see; time trackers do not bump it. */
  rev: number;
  nextId: number;

  day: number;
  phase: Phase;
  court: Court | null;
  players: Player[];

  schedule: DayEvent[][];
  secret: Record<number, SecretEvent>;
  /** Where "the host waits" for the day's private meeting quests. */
  hostSpot: Record<number, LocationId>;
  shop: ShopState;
  looted: boolean;
  serum: number;
  firstInfectedId: PlayerId | null;
  huntTargetId: PlayerId | null;
  convoyGot: PlayerId[];
  corpse: { spawnAt: number; taken: boolean } | null;
  fire: { location: LocationId; revealAt: number; revealed: boolean } | null;

  attacks: Attack[];
  searches: Search[];
  offers: Offer[];
  prompts: Prompt[];
  /** Ripper's free exit after a successful attack, until this game time. */
  stealth: { playerId: PlayerId; until: number } | null;
  dice: DiceEntry[];
  messages: Message[];
  result: GameResult | null;
}

export type PlayerCommand = { playerId: PlayerId } & (
  | { type: 'move'; to: LocationId }
  | { type: 'chat'; text: string }
  | { type: 'ghostChat'; text: string }
  | { type: 'infoRequest'; askerId: PlayerId }
  | { type: 'offer'; targetId: PlayerId; give: Bundle; want: Bundle }
  | { type: 'offerReply'; offerId: number; accept: boolean }
  | { type: 'buyTicket'; sellerId: PlayerId }
  | { type: 'buy'; item: ItemId; hidden?: boolean }
  | { type: 'sell'; item: ItemId }
  | { type: 'use'; item: ItemId }
  | { type: 'attack'; targetId: PlayerId; loot: LootKind; mods: CombatMod[] }
  | { type: 'defend'; attackId: number; mods: CombatMod[]; flee?: { ability: FleeAbility; to: LocationId } }
  | { type: 'stealth'; to: LocationId }
  | { type: 'bleed'; targetId: PlayerId }
  | { type: 'search'; targetId: PlayerId }
  | { type: 'showItem'; searchId: number; item: ItemId | null }
  | { type: 'heal'; targetId: PlayerId }
  | { type: 'megaphone' }
  | { type: 'suspect'; targetId: PlayerId }
  | { type: 'courtStart'; accusedId: PlayerId }
  | { type: 'courtVote'; guilty: boolean }
  | { type: 'courtClose' }
  | { type: 'serumRoll' }
  | { type: 'serumHelp' }
  | { type: 'donateIngredients' }
  | { type: 'remedyRoll' }
  | { type: 'gatherHerbs' }
  | { type: 'craftPotion' }
  | { type: 'premonition' }
  | { type: 'note'; text: string }
  | { type: 'stash'; gold: number; item: ItemId | null }
  | { type: 'unstash' }
  | { type: 'outlaw' }
  | { type: 'escape' }
  | { type: 'rumor' }
  | { type: 'well' }
  | { type: 'corpse' }
  | { type: 'haunt'; to: LocationId }
  | { type: 'unhaunt' }
  | { type: 'choose'; promptId: number; ids: PlayerId[]; option?: number }
  | { type: 'ready' }
  | { type: 'setAutoAmnesty'; on: boolean }
  | { type: 'forfeit' }
);

export type Command = PlayerCommand | { type: 'tick' };

export interface EngineError {
  code: string;
  message: string;
}

export type ReduceResult = { ok: true; state: GameState } | { ok: false; error: EngineError };
