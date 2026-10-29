import {
  BASE_PRICE,
  COUPON_PRICE,
  PHARMACY_ITEMS,
  SELLABLE,
  SERUM_GOAL,
  SERUM_PRICE,
  SHOP_ITEMS,
  STOCK_CHANCE,
  TICKET_BLACK_PRICE,
} from './constants';
import { randomInt } from './rng';
import { hasEvent, lootedBy } from './schedule';
import type { GameState, ItemId, LocationId, ShopState } from './types';
import { isAlive } from './util';

/** Prices go up by 1 every three days: days 1-3 base, 4-6 +1, 7-9 +2, 10 +3. */
export function inflation(day: number): number {
  return Math.floor((day - 1) / 3);
}

/**
 * Today's stock and prices. Each item has a daily ±1 swing and is out of stock
 * with a 20% chance, separately for the market and the black market.
 */
export function rollShop(state: GameState): ShopState {
  const day = state.day;
  const market: ShopState['market'] = {};
  const black: ShopState['black'] = {};
  for (const item of [...SHOP_ITEMS, ...PHARMACY_ITEMS]) {
    let price = (BASE_PRICE[item] ?? 1) + inflation(day) + randomInt(state, 3) - 1;
    if (item === 'water' && hasEvent(state, 'waterShortage')) price *= 2;
    if (item === 'rusk' && hasEvent(state, 'rats')) price *= 2;
    price = Math.max(1, price);
    if (randomInt(state, 100) < STOCK_CHANCE) market[item] = price;
    if (randomInt(state, 100) < STOCK_CHANCE) black[item] = item === 'immunizer' ? price + 4 : price * 2;
  }
  return { market, black };
}

export type PriceTag = { gold: number; coupons: number; amount: number };

/** What buying `item` costs here and now, or null when it is not for sale. */
export function priceOf(state: GameState, location: LocationId, item: ItemId): PriceTag | null {
  const night = state.phase.kind === 'night';
  if (location === 'market') {
    if (night || state.looted) return null;
    if (item === 'serum') return state.serum >= SERUM_GOAL ? { gold: SERUM_PRICE, coupons: 0, amount: 1 } : null;
    if (hasEvent(state, 'couponsSale') && SHOP_ITEMS.includes(item)) return null;
    if (hasEvent(state, 'couponsFood') && (item === 'rusk' || item === 'canned')) {
      return item === 'canned' ? { gold: 0, coupons: 1, amount: 1 } : null;
    }
    if (hasEvent(state, 'couponsWater') && item === 'water') return { gold: 0, coupons: 1, amount: 2 };
    const price = state.shop.market[item];
    return price === undefined ? null : { gold: price, coupons: 0, amount: 1 };
  }
  if (location === 'blackmarket') {
    if (item === 'coupon') return couponsOnSale(state) ? { gold: COUPON_PRICE, coupons: 0, amount: 1 } : null;
    if (item === 'ticket') return ticketAtBlackMarket(state) ? { gold: TICKET_BLACK_PRICE, coupons: 0, amount: 1 } : null;
    const price = state.shop.black[item];
    return price === undefined ? null : { gold: price, coupons: 0, amount: 1 };
  }
  if (location === 'townhall' && item === 'serum') {
    const bachelorHere = state.players.some((p) => p.role === 'bachelor' && isAlive(p) && p.location === 'townhall');
    return state.serum >= SERUM_GOAL && bachelorHere ? { gold: SERUM_PRICE, coupons: 0, amount: 1 } : null;
  }
  return null;
}

/** What a trader pays for `item` here, or null. Trophies sell only on the black market. */
export function sellPriceOf(state: GameState, location: LocationId, item: ItemId): number | null {
  if (location === 'blackmarket' && item === 'trophy') return 1;
  if (!SELLABLE.includes(item)) return null;
  if (location === 'market' && (state.phase.kind === 'night' || state.looted)) return null;
  if (location !== 'market' && location !== 'blackmarket') return null;
  const base = (BASE_PRICE[item] ?? 1) + inflation(state.day);
  return Math.max(1, Math.floor(base / 2));
}

export function couponsOnSale(state: GameState): boolean {
  return (hasEvent(state, 'couponsSale') || hasEvent(state, 'couponsFood') || hasEvent(state, 'couponsWater')) && !lootedBy(state, state.day);
}

function ticketAtBlackMarket(state: GameState): boolean {
  const grif = state.players.find((p) => p.role === 'grif');
  return !grif || !isAlive(grif);
}

/** Everything a viewer could try to buy in a location, for the client's shop panel. */
export const BUYABLE: readonly ItemId[] = ['rusk', 'canned', 'water', 'bandage', 'immunizer', 'serum', 'coupon', 'ticket'];
