import { BANDIT_ABILITIES, DICE_VISIBLE_MS, LOCATIONS, TICKET_PRICE } from './constants';
import { BUYABLE, priceOf, sellPriceOf } from './economy';
import { questFor } from './quests';
import { closedToday } from './schedule';
import type {
  Bundle,
  Caste,
  DayEvent,
  GameResult,
  GameState,
  Inventory,
  ItemId,
  LocationId,
  Message,
  MsgParams,
  Player,
  PlayerId,
  PlayerStatus,
  Prompt,
  Role,
} from './types';
import { count, isAlive, isIsolated, ready, usedThisPhase } from './util';

export interface PublicPlayer {
  id: PlayerId;
  /** As announced at the last summary. */
  status: PlayerStatus;
  /** The bachelor is known to all from the start. */
  bachelor: boolean;
  isolated: boolean;
}

export interface Occupant {
  id: PlayerId;
  kind: 'alive' | 'body' | 'ghost';
}

export interface DiceView {
  id: number;
  key: string;
  params: MsgParams;
  /** Milliseconds this roll stays visible. */
  ttl: number;
}

export interface ShopLine {
  item: ItemId;
  gold: number;
  coupons: number;
  amount: number;
}

export interface HereView {
  location: LocationId;
  people: Occupant[];
  dice: DiceView[];
  shop: ShopLine[];
  buyback: { item: ItemId; price: number }[];
  corpse: boolean;
  well: boolean;
  rumors: boolean;
}

export interface OfferView {
  id: number;
  kind: 'trade' | 'ticket';
  fromId: PlayerId;
  toId: PlayerId;
  give: Bundle;
  want: Bundle;
  deadline: number;
}

export interface SelfView {
  id: PlayerId;
  role: Role;
  caste: Caste;
  status: PlayerStatus;
  hp: number;
  maxHp: number;
  hunger: number;
  thirst: number;
  infection: number;
  vulnerable: boolean;
  usedSerum: boolean;
  gold: number;
  inv: Inventory;
  stash: Bundle;
  location: LocationId;
  moves: number;
  actions: number;
  attackActions: number;
  isolatedUntil: number | null;
  /** On the factory shift right now (the outlaw shortcut is only possible then). */
  working: boolean;
  remedyProgress: number;
  ingredients: number;
  autoAmnesty: boolean;
  ticketPrice: number;
  huntTargetId: PlayerId | null;
  quest: { day: number; done: boolean } | null;
  /** Which of this role's abilities can be used right now (cooldowns only; place and phase are checked on use). */
  ready: Record<string, boolean>;
  haunt: LocationId | null;
  canHaunt: boolean;
  isReady: boolean;
}

export interface GameView {
  day: number;
  phase: 'day' | 'night' | 'summary' | 'over';
  /** Real-time end of the current phase or court, in server epoch ms. */
  deadline: number | null;
  paused: boolean;
  court: { accusedId: PlayerId; deadline: number; guilty: number; innocent: number; myVote: boolean | null } | null;
  players: PublicPlayer[];
  serum: number;
  events: DayEvent[];
  closed: LocationId[];
  fire: LocationId | null;
  messages: Message[];
  you: SelfView | null;
  here: HereView | null;
  offers: OfferView[];
  attack: { id: number; role: 'attacker' | 'defender'; otherId: PlayerId; deadline: number } | null;
  search: { id: number; role: 'searcher' | 'target'; otherId: PlayerId; deadline: number } | null;
  stealthDeadline: number | null;
  prompts: Prompt[];
  banditAbilities: number;
  result: GameResult | null;
}

const MESSAGE_LIMIT = 250;

function visibleTo(m: Message, viewer: PlayerId | null): boolean {
  return m.to === 'all' || (viewer !== null && m.to.includes(viewer));
}

/** Hides the poisoned rusk from everybody but the one holding it. */
function disguise(bundle: Bundle): Bundle {
  const items: Inventory = { ...bundle.items };
  const poison = items.poisonRusk;
  if (poison) {
    delete items.poisonRusk;
    items.rusk = (items.rusk ?? 0) + poison;
  }
  return { gold: bundle.gold, items };
}

function abilityReadiness(state: GameState, p: Player): Record<string, boolean> {
  const d = state.day;
  const r: Record<string, boolean> = {};
  switch (p.role) {
    case 'bachelor':
      r['heal'] = ready(p, 'heal', 1, d);
      r['court'] = ready(p, 'court', 1, d);
      r['suspect'] = !p.spent.suspicion;
      r['serumRoll'] = !usedThisPhase(state, p, 'serumRoll');
      r['megaphone'] = !usedThisPhase(state, p, 'megaphone');
      break;
    case 'haruspex':
      r['fastLegs'] = ready(p, 'fastLegs', 3, d);
      r['remedy'] = d >= 4 && ready(p, 'remedy', 1, d);
      r['herbs'] = d >= 4 && ready(p, 'herbs', 1, d);
      r['donate'] = ready(p, 'donate', 1, d);
      break;
    case 'angel':
      r['premonition'] = ready(p, 'premonition', 1, d);
      r['offer'] = ready(p, 'offer', 2, d);
      r['nightCover'] = ready(p, 'nightCover', 3, d);
      r['note'] = p.facts.includes('premonition') && !p.facts.includes('note');
      break;
    case 'grif':
      r['amnesty'] = ready(p, 'amnesty', 3, d);
      r['stash'] = ready(p, 'stash', 2, d);
      r['sneak'] = ready(p, 'sneak', 2, d);
      r['outlaw'] = ready(p, 'outlaw', 4, d);
      break;
    case 'citizen':
      r['booze'] = ready(p, 'booze', 2, d);
      r['allIn'] = !p.spent.allIn && count(p.inv, 'rose') > 0;
      r['survivalist'] = !p.spent.survivalist;
      break;
    case 'ripper':
      r['bleed'] = ready(p, 'bleed', 2, d);
      r['stealth'] = p.stealthUses < 2;
      break;
    case 'resident':
      break;
  }
  r['bandage'] = ready(p, 'bandage', 1, d);
  return r;
}

function hereView(state: GameState, location: LocationId, viewer: Player | null): HereView {
  const people: Occupant[] = [];
  for (const p of state.players) {
    if (isAlive(p) && p.location === location) people.push({ id: p.id, kind: 'alive' });
    else if (p.status === 'dead' && p.publicStatus === 'alive' && p.location === location) people.push({ id: p.id, kind: 'body' });
    else if (p.status === 'dead' && p.haunt === location) people.push({ id: p.id, kind: 'ghost' });
  }
  const dice = state.dice
    .filter((d) => d.location === location && state.t - d.at < DICE_VISIBLE_MS)
    .map((d) => ({ id: d.id, key: d.key, params: d.params, ttl: DICE_VISIBLE_MS - (state.t - d.at) }));
  const shop: ShopLine[] = [];
  const buyback: HereView['buyback'] = [];
  if (viewer && isAlive(viewer)) {
    for (const item of BUYABLE) {
      const price = priceOf(state, location, item);
      if (price) shop.push({ item, ...price });
    }
    for (const item of Object.keys(viewer.inv) as ItemId[]) {
      const price = sellPriceOf(state, location, item);
      if (price !== null) buyback.push({ item, price });
    }
  }
  const corpse = location === 'cemetery' && state.corpse !== null && !state.corpse.taken && state.t >= state.corpse.spawnAt;
  const events = state.schedule[state.day] ?? [];
  return {
    location,
    people,
    dice,
    shop,
    buyback,
    corpse,
    well: location === 'station' && events.includes('well'),
    rumors: location === 'square' && events.includes('rumors'),
  };
}

/**
 * What one viewer may see. `viewerId` null is a spectator: only public news.
 * Other players' stats, roles and inventories never leave the server.
 */
export function projectView(state: GameState, viewerId: PlayerId | null, now: number): GameView {
  const me = viewerId === null ? null : (state.players.find((p) => p.id === viewerId) ?? null);
  const paused = state.court !== null;
  // Game-clock times become real deadlines. While court pauses the clock they drift with it.
  const real = (gameT: number) => now + Math.max(0, gameT - state.t);

  let deadline: number | null = null;
  if (state.court) deadline = state.court.endsAtReal;
  else if (state.phase.kind === 'day' || state.phase.kind === 'night') deadline = real(state.phase.endsAt);
  else if (state.phase.kind === 'summary') deadline = state.phase.endsAtReal;

  const messages = state.messages.filter((m) => visibleTo(m, viewerId)).slice(-MESSAGE_LIMIT);

  let you: SelfView | null = null;
  let here: HereView | null = null;
  if (me) {
    const quest = questFor(me, state.day);
    you = {
      id: me.id,
      role: me.role,
      caste: me.caste,
      status: me.status,
      hp: me.hp,
      maxHp: me.maxHp,
      hunger: me.hunger,
      thirst: me.thirst,
      infection: me.infection,
      vulnerable: me.vulnerable,
      usedSerum: me.usedSerum,
      gold: me.gold,
      inv: { ...me.inv },
      stash: { gold: me.stash.gold, items: { ...me.stash.items } },
      location: me.location,
      moves: me.moves,
      actions: me.actions,
      attackActions: me.attackActions,
      isolatedUntil: me.isolatedUntil,
      working: me.workStart !== null,
      remedyProgress: me.remedyProgress,
      ingredients: count(me.inv, 'ingredient'),
      autoAmnesty: me.autoAmnesty,
      ticketPrice: Math.max(0, TICKET_PRICE - me.ticketDiscount),
      huntTargetId: me.role === 'ripper' && state.phase.kind === 'night' ? state.huntTargetId : null,
      quest: quest ? { day: state.day, done: me.questDone } : null,
      ready: abilityReadiness(state, me),
      haunt: me.haunt,
      canHaunt: me.status === 'dead' && me.diedDay !== null && me.diedDay < state.day && me.hauntDay !== state.day,
      isReady: me.ready,
    };
    if (isAlive(me) && state.phase.kind !== 'summary' && state.phase.kind !== 'over') here = hereView(state, me.location, me);
    else if (me.status === 'dead' && me.haunt) here = hereView(state, me.haunt, null);
  }

  const offers: OfferView[] = state.offers
    .filter((o) => viewerId !== null && (o.fromId === viewerId || o.toId === viewerId))
    .map((o) => ({
      id: o.id,
      kind: o.kind,
      fromId: o.fromId,
      toId: o.toId,
      give: o.fromId === viewerId ? o.give : disguise(o.give),
      want: o.toId === viewerId ? o.want : disguise(o.want),
      deadline: real(o.deadline),
    }));

  const attack = state.attacks.find((a) => a.attackerId === viewerId || a.targetId === viewerId);
  const search = state.searches.find((s) => s.searcherId === viewerId || s.targetId === viewerId);
  const court = state.court;

  return {
    day: state.day,
    phase: state.phase.kind,
    deadline,
    paused,
    court: court
      ? {
          accusedId: court.accusedId,
          deadline: court.endsAtReal,
          guilty: Object.values(court.votes).filter(Boolean).length,
          innocent: Object.values(court.votes).filter((v) => !v).length,
          myVote: viewerId !== null && viewerId in court.votes ? (court.votes[viewerId] ?? null) : null,
        }
      : null,
    players: state.players.map((p) => ({
      id: p.id,
      status: p.publicStatus,
      bachelor: p.role === 'bachelor',
      isolated: isIsolated(p),
    })),
    serum: state.serum,
    events: state.schedule[state.day] ?? [],
    closed: LOCATIONS.filter((l) => closedToday(state, l)),
    fire: state.fire?.revealed ? state.fire.location : null,
    messages,
    you,
    here,
    offers,
    attack: attack
      ? {
          id: attack.id,
          role: attack.attackerId === viewerId ? 'attacker' : 'defender',
          otherId: attack.attackerId === viewerId ? attack.targetId : attack.attackerId,
          deadline: real(attack.deadline),
        }
      : null,
    search: search
      ? {
          id: search.id,
          role: search.searcherId === viewerId ? 'searcher' : 'target',
          otherId: search.searcherId === viewerId ? search.targetId : search.searcherId,
          deadline: real(search.deadline),
        }
      : null,
    stealthDeadline: state.stealth && state.stealth.playerId === viewerId ? real(state.stealth.until) : null,
    prompts: state.prompts.filter((p) => p.playerId === viewerId),
    banditAbilities: BANDIT_ABILITIES.length,
    result: state.result,
  };
}
