import type { Caste, GameConfig, ItemId, LocationId, Role } from './types';

export const LAST_DAY = 10;
export const MIN_PLAYERS = 5;
export const MAX_PLAYERS = 10;

export const SERUM_GOAL = 12;
export const SERUM_PRICE = 5;
export const REMEDY_GOAL = 4;
export const POTION_INGREDIENTS = 3;
export const MAX_INFECTION = 5;
export const MAX_HUNGER = 10;
export const MAX_THIRST = 6;

export const TICKET_PRICE = 30;
export const TICKET_BLACK_PRICE = 35;
export const COUPON_PRICE = 2;

/** Game-clock durations. */
export const WORK_MS = 60_000;
export const EXPOSURE_MS = 60_000;
export const DEFEND_MS = 10_000;
export const SEARCH_MS = 15_000;
export const STEALTH_MS = 15_000;
export const OFFER_MS = 45_000;
export const DICE_VISIBLE_MS = 20_000;
export const CORPSE_DELAY_MS = 60_000;
export const FIRE_WARNING_MS = 60_000;
/** Personal tasks: "meet" and "alone with" need this much time together; the host waits this long. */
export const MEET_MS = 30_000;
export const HOST_MS = 20_000;

export const DEFAULT_CONFIG: GameConfig = {
  dayMs: 4 * 60_000,
  nightMs: 2 * 60_000,
  summaryMs: 90_000,
  courtMs: 300_000,
};

export const LOCATIONS: readonly LocationId[] = [
  'square',
  'factory',
  'townhall',
  'market',
  'blackmarket',
  'cemetery',
  'station',
  'isolator',
];

/** Where random events (closures, contamination, fire) may strike. */
export const EVENT_LOCATIONS: readonly LocationId[] = ['factory', 'market', 'blackmarket', 'cemetery', 'station'];

export const ROLES: readonly Role[] = ['bachelor', 'haruspex', 'angel', 'grif', 'citizen', 'ripper', 'resident'];

export const CASTE: Record<Role, Caste> = {
  bachelor: 'elite',
  haruspex: 'worker',
  angel: 'worker',
  grif: 'worker',
  citizen: 'worker',
  resident: 'worker',
  ripper: 'bandit',
};

/** The order roles are dealt in: the first five always play, then the citizen, then residents. */
export const ROLE_ORDER: readonly Role[] = ['bachelor', 'ripper', 'haruspex', 'angel', 'grif', 'citizen'];

export const START_GOLD: Record<Caste, number> = { elite: 5, worker: 2, bandit: 0 };

export const ITEMS: readonly ItemId[] = [
  'rusk',
  'canned',
  'water',
  'rationSmall',
  'rationBig',
  'bandage',
  'immunizer',
  'serum',
  'folkRemedy',
  'strongPotion',
  'coupon',
  'ingredient',
  'trophy',
  'ticket',
  'poisonRusk',
  'shiv',
  'rose',
];

export const FOOD: Partial<Record<ItemId, number>> = { rusk: 2, canned: 4, rationSmall: 1, rationBig: 2, poisonRusk: 2 };
export const DRINK: Partial<Record<ItemId, number>> = { water: 1 };
export const MEDICINE: readonly ItemId[] = ['immunizer', 'serum', 'folkRemedy', 'strongPotion'];
/** Things a search may show and a rose may steal. */
export const CONSUMABLES: readonly ItemId[] = [
  'rusk',
  'canned',
  'water',
  'rationSmall',
  'rationBig',
  'bandage',
  'immunizer',
  'serum',
  'folkRemedy',
  'strongPotion',
];
export const VALUABLES: readonly ItemId[] = ['shiv', 'rose'];
/** Cannot be given in an ordinary trade. */
export const UNTRADEABLE: readonly ItemId[] = ['shiv', 'rose', 'ticket'];
/** Traders buy these back at half price. */
export const SELLABLE: readonly ItemId[] = ['rusk', 'canned', 'water', 'bandage', 'immunizer'];

export const SHOP_ITEMS: readonly ItemId[] = ['rusk', 'canned', 'water'];
export const PHARMACY_ITEMS: readonly ItemId[] = ['bandage', 'immunizer'];
export const BASE_PRICE: Partial<Record<ItemId, number>> = { rusk: 2, canned: 5, water: 3, bandage: 3, immunizer: 8 };
/** Chance an item is in stock on a given day, in percent. */
export const STOCK_CHANCE = 80;

/** Ripper's abilities, numbered for the bachelor's day-5 intel. */
export const BANDIT_ABILITIES = ['shiv', 'frenzy', 'bleed', 'stealth', 'trophies', 'hunt'] as const;

export function phaseKey(kind: 'day' | 'night', day: number): string {
  return `${kind}${day}`;
}
