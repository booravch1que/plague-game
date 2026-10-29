import { applyPrompt, rollSerum } from './abilities';
import { bleed, declareAttack, defend, finishSearch, inCombat, startSearch, useStealth } from './combat';
import {
  DRINK,
  FOOD,
  LOCATIONS,
  MAX_HUNGER,
  MAX_THIRST,
  MEDICINE,
  OFFER_MS,
  POTION_INGREDIENTS,
  SERUM_GOAL,
  TICKET_PRICE,
  UNTRADEABLE,
  VALUABLES,
} from './constants';
import { priceOf, sellPriceOf } from './economy';
import { enterLocation, hauntLocation } from './movement';
import { advance, closeCourt, finish } from './phases';
import { addRemedyProgress, checkQuests, completeQuest } from './quests';
import { closedToday, hasEvent, makeRumor } from './schedule';
import type { Bundle, Command, GameState, Inventory, ItemId, Player, PlayerCommand, ReduceResult } from './types';
import {
  RuleError,
  addDice,
  addFact,
  addItem,
  announceAt,
  bundleEmpty,
  check,
  count,
  d6,
  damage,
  fail,
  findPlayer,
  getPlayer,
  hasBundle,
  heal,
  isAlive,
  isIsolated,
  isNight,
  kill,
  livingAt,
  living,
  markPhaseUse,
  nextId,
  ready,
  removeItem,
  sys,
  tell,
  touch,
  useCooldown,
  usedThisPhase,
} from './util';

/**
 * The whole rules engine: applies one command at real time `now` to a copy of the
 * state. The clock is brought up to `now` first, so timers fire before the command.
 */
export function reduce(state: GameState, command: Command, now: number): ReduceResult {
  const next = structuredClone(state);
  try {
    advance(next, now);
    if (command.type !== 'tick') apply(next, command, now);
    checkQuests(next);
    if (next.phase.kind !== 'over' && living(next).length === 0) finish(next);
    return { ok: true, state: next };
  } catch (error) {
    if (error instanceof RuleError) return { ok: false, error: error.toEngineError() };
    throw error;
  }
}

const MAX_TEXT = 300;

function cleanText(text: string): string {
  const clean = text.replace(/\s+/gu, ' ').trim().slice(0, MAX_TEXT);
  check(clean.length > 0, 'invalid_payload', 'Message is empty.');
  return clean;
}

function playing(state: GameState): boolean {
  return state.phase.kind === 'day' || state.phase.kind === 'night';
}

/** Common guard for anything done with the body: alive, free, in day or night, no court. */
function active(state: GameState, p: Player): void {
  check(isAlive(p), 'not_alive', 'You are not among the living.');
  check(playing(state), 'wrong_phase', 'Not now.');
  check(!state.court, 'court', 'The court is in session.');
  check(!isIsolated(p), 'isolated', 'You are locked in the isolator.');
}

function spend(p: Player, n = 1): void {
  check(p.actions >= n, 'no_actions', 'No actions left.');
  p.actions -= n;
}

function apply(state: GameState, command: PlayerCommand, now: number): void {
  const p = getPlayer(state, command.playerId);
  switch (command.type) {
    case 'move':
      return move(state, p, command.to);
    case 'chat':
      return chat(state, p, command.text);
    case 'ghostChat': {
      check(p.status === 'dead', 'not_allowed', 'Only the dead speak here.');
      const dead = state.players.filter((x) => x.status === 'dead').map((x) => x.id);
      state.messages.push({ id: nextId(state), day: state.day, to: dead, kind: 'ghost', fromId: p.id, text: cleanText(command.text) });
      touch(state);
      return;
    }
    case 'infoRequest': {
      check(isAlive(p) && playing(state), 'wrong_phase', 'Not now.');
      const asker = getPlayer(state, command.askerId);
      check(asker.id !== p.id && isAlive(asker) && asker.location === p.location, 'invalid_target', 'That player is not here.');
      check(asker.actions > 0, 'no_actions', 'That player has no actions left.');
      asker.actions -= 1;
      announceAt(state, p.location, 'msg.infoRequest', { askerId: asker.id, answererId: p.id });
      return;
    }
    case 'offer':
      return offer(state, p, command.targetId, command.give, command.want);
    case 'offerReply':
      return offerReply(state, p, command.offerId, command.accept);
    case 'buyTicket':
      return buyTicket(state, p, command.sellerId);
    case 'buy':
      return buy(state, p, command.item, command.hidden === true);
    case 'sell':
      return sell(state, p, command.item);
    case 'use':
      return useItem(state, p, command.item);
    case 'attack':
      active(state, p);
      return declareAttack(state, p, command.targetId, command.loot, command.mods);
    case 'defend':
      check(isAlive(p) && playing(state) && !state.court, 'wrong_phase', 'Not now.');
      return defend(state, p, command.attackId, command.mods, command.flee);
    case 'stealth':
      active(state, p);
      return useStealth(state, p, command.to);
    case 'bleed':
      active(state, p);
      return bleed(state, p, command.targetId);
    case 'search':
      active(state, p);
      return startSearch(state, p, command.targetId);
    case 'showItem': {
      const search = state.searches.find((s) => s.id === command.searchId && s.targetId === p.id);
      check(search, 'invalid_choice', 'Nobody is searching you.');
      check(command.item === null || count(p.inv, command.item) > 0, 'invalid_choice', 'You do not have that.');
      return finishSearch(state, search.id, command.item);
    }
    case 'heal':
      return healPatient(state, p, command.targetId);
    case 'megaphone': {
      active(state, p);
      check(p.role === 'bachelor' && p.location === 'townhall', 'not_allowed', 'Only the bachelor in the town hall can do that.');
      check(!usedThisPhase(state, p, 'megaphone'), 'not_ready', 'You already called everyone.');
      markPhaseUse(state, p, 'megaphone');
      addFact(p, 'megaphone');
      sys(state, 'all', 'msg.megaphone');
      return;
    }
    case 'suspect':
      return suspect(state, p, command.targetId);
    case 'courtStart':
      return courtStart(state, p, command.accusedId, now);
    case 'courtVote': {
      const court = state.court;
      check(court, 'wrong_phase', 'There is no court in session.');
      check(isAlive(p) && !isIsolated(p), 'not_allowed', 'You cannot vote.');
      check(p.location === 'townhall', 'not_here', 'Come to the town hall to vote.');
      court.votes[p.id] = command.guilty;
      addFact(p, 'vote');
      touch(state);
      const voters = living(state).filter((x) => !isIsolated(x));
      if (voters.every((x) => court.votes[x.id] !== undefined)) closeCourt(state);
      return;
    }
    case 'courtClose':
      check(state.court && p.role === 'bachelor' && isAlive(p), 'not_allowed', 'Only the bachelor can close the court.');
      return closeCourt(state);
    case 'serumRoll': {
      active(state, p);
      check(p.role === 'bachelor' && p.location === 'townhall', 'not_allowed', 'The serum is made by the bachelor in the town hall.');
      check(state.serum < SERUM_GOAL, 'not_allowed', 'The serum is already done.');
      check(!usedThisPhase(state, p, 'serumRoll'), 'not_ready', 'One roll per phase.');
      spend(p);
      return rollSerum(state, p, false);
    }
    case 'serumHelp': {
      active(state, p);
      check(p.role !== 'bachelor' && p.location === 'townhall', 'not_allowed', 'Help in the town hall.');
      check(!usedThisPhase(state, p, 'serumHelp'), 'not_ready', 'You are already helping.');
      check(state.serum < SERUM_GOAL, 'not_allowed', 'The serum is already done.');
      spend(p);
      markPhaseUse(state, p, 'serumHelp');
      addFact(p, 'serumHelp');
      announceAt(state, 'townhall', 'msg.serumHelp', { playerId: p.id });
      return;
    }
    case 'donateIngredients': {
      active(state, p);
      check(p.role === 'haruspex' && p.location === 'townhall', 'not_allowed', 'Bring the herbs to the town hall.');
      const bachelor = livingAt(state, 'townhall').find((x) => x.role === 'bachelor');
      check(bachelor, 'not_here', 'The bachelor is not here.');
      check(count(p.inv, 'ingredient') >= 2, 'missing_item', 'You need two ingredients.');
      check(ready(p, 'donate', 1, state.day), 'not_ready', 'Once a day.');
      check(state.serum < SERUM_GOAL, 'not_allowed', 'The serum is already done.');
      spend(p);
      useCooldown(p, 'donate', state.day);
      removeItem(p.inv, 'ingredient', 2);
      state.serum += 1;
      addFact(p, 'donated');
      addFact(bachelor, 'ingredientsReceived');
      announceAt(state, 'townhall', 'msg.donated', { playerId: p.id });
      if (state.serum >= SERUM_GOAL) sys(state, 'all', 'msg.serumReady');
      return;
    }
    case 'remedyRoll': {
      active(state, p);
      check(p.role === 'haruspex' && state.day >= 4, 'not_allowed', 'Not available yet.');
      check(ready(p, 'remedy', 1, state.day), 'not_ready', 'Once a day.');
      spend(p);
      useCooldown(p, 'remedy', state.day);
      if (livingAt(state, p.location).length > 1) addFact(p, 'remedy:others');
      const roll = d6(state);
      addDice(state, p.location, roll % 2 === 0 ? 'dice.remedyOk' : 'dice.remedyFail', { playerId: p.id, roll });
      if (roll % 2 === 0) addRemedyProgress(state, p, 1);
      return;
    }
    case 'gatherHerbs': {
      active(state, p);
      check(p.role === 'haruspex' && state.day >= 4 && isNight(state), 'not_allowed', 'Herbs are gathered at night, from day 4.');
      check(p.location === 'cemetery', 'not_here', 'Herbs grow at the cemetery.');
      check(ready(p, 'herbs', 1, state.day), 'not_ready', 'Once a day.');
      spend(p);
      useCooldown(p, 'herbs', state.day);
      const company = livingAt(state, 'cemetery').length > 1;
      const sure = state.day === 9 && company && !p.questDone;
      const roll = d6(state);
      const ok = sure || roll >= 4;
      addDice(state, 'cemetery', ok ? 'dice.herbsOk' : 'dice.herbsFail', { playerId: p.id, roll });
      if (ok) addItem(p.inv, 'ingredient');
      if (sure) completeQuest(state, p);
      touch(state);
      return;
    }
    case 'craftPotion': {
      check(isAlive(p), 'not_alive', 'You are not among the living.');
      check(p.role === 'haruspex', 'not_allowed', 'Only the haruspex knows the recipe.');
      check(removeItem(p.inv, 'ingredient', POTION_INGREDIENTS), 'missing_item', 'You need three ingredients.');
      addItem(p.inv, 'strongPotion');
      touch(state);
      return;
    }
    case 'premonition':
      return premonition(state, p);
    case 'note': {
      check(isAlive(p) && p.role === 'angel', 'not_allowed', 'Only Angel can do that.');
      check(p.facts.includes('premonition'), 'not_ready', 'Use your premonition first today.');
      check(!p.facts.includes('note'), 'not_ready', 'One note a day.');
      const bachelor = state.players.find((x) => x.role === 'bachelor' && isAlive(x));
      check(bachelor, 'invalid_target', 'There is nobody to send it to.');
      state.messages.push({ id: nextId(state), day: state.day, to: [bachelor.id, p.id], kind: 'note', text: cleanText(command.text) });
      addFact(p, 'note');
      touch(state);
      return;
    }
    case 'stash':
      return stash(state, p, command.gold, command.item);
    case 'unstash': {
      check(isAlive(p) && p.role === 'grif', 'not_allowed', 'Only Grif has deep pockets.');
      p.gold += p.stash.gold;
      for (const [item, n] of Object.entries(p.stash.items)) addItem(p.inv, item as ItemId, n ?? 0);
      p.stash = { gold: 0, items: {} };
      touch(state);
      return;
    }
    case 'outlaw': {
      active(state, p);
      check(p.role === 'grif' && state.phase.kind === 'day', 'not_allowed', 'Not now.');
      check(p.location === 'factory' && p.workStart !== null, 'not_allowed', 'Only instead of your shift, before leaving the factory.');
      check(ready(p, 'outlaw', 4, state.day), 'not_ready', 'Once every four days.');
      check(!closedToday(state, 'blackmarket'), 'closed', 'The black market is closed today.');
      useCooldown(p, 'outlaw', state.day);
      enterLocation(state, p, 'blackmarket');
      const roll = d6(state);
      const gold = roll <= 2 ? 1 : roll <= 5 ? 3 : 5;
      p.gold += gold;
      tell(state, p, 'msg.outlaw', { roll, gold });
      return;
    }
    case 'escape': {
      active(state, p);
      check(p.role === 'ripper', 'not_allowed', 'Only a bandit has a reason to run.');
      check(p.location === 'station', 'not_here', 'Trains leave from the station.');
      check(removeItem(p.inv, 'ticket'), 'missing_item', 'You need a ticket.');
      p.status = 'escaped';
      state.attacks = state.attacks.filter((a) => a.attackerId !== p.id && a.targetId !== p.id);
      state.offers = state.offers.filter((o) => o.fromId !== p.id && o.toId !== p.id);
      announceAt(state, 'station', 'msg.trainLeft');
      tell(state, p, 'msg.escaped');
      touch(state);
      return;
    }
    case 'rumor': {
      active(state, p);
      check(hasEvent(state, 'rumors') && p.location === 'square', 'not_allowed', 'There are no rumours to hear here.');
      check(ready(p, 'rumor', 1, state.day), 'not_ready', 'Once a day.');
      spend(p);
      useCooldown(p, 'rumor', state.day);
      const roll = d6(state);
      const rumor = makeRumor(state, p.id, roll >= 4);
      tell(state, p, rumor.key, rumor.params);
      return;
    }
    case 'well': {
      active(state, p);
      check(hasEvent(state, 'well') && p.location === 'station', 'not_allowed', 'There is no well here.');
      check(ready(p, 'well', 1, state.day), 'not_ready', 'Once a day.');
      spend(p);
      useCooldown(p, 'well', state.day);
      addFact(p, 'well');
      if (livingAt(state, 'station').length > 1) addFact(p, 'well:others');
      const roll = d6(state);
      addDice(state, 'station', roll >= 3 ? 'dice.wellOk' : 'dice.wellFail', { playerId: p.id, roll });
      if (roll >= 3) addItem(p.inv, 'water');
      return;
    }
    case 'corpse': {
      active(state, p);
      const corpse = state.corpse;
      check(corpse && !corpse.taken && state.t >= corpse.spawnAt && p.location === 'cemetery', 'not_allowed', 'There is nothing to find here.');
      spend(p);
      const roll = d6(state);
      addDice(state, 'cemetery', roll >= 2 ? 'dice.corpseOk' : 'dice.corpseFail', { playerId: p.id, roll });
      if (roll >= 2) {
        corpse.taken = true;
        addItem(p.inv, 'immunizer');
        addItem(p.inv, 'water');
        addItem(p.inv, 'rusk');
        p.gold += 2;
      } else {
        damage(state, p, 1, 'corpse');
      }
      return;
    }
    case 'haunt': {
      check(p.status === 'dead' && p.diedDay !== null && p.diedDay < state.day, 'not_allowed', 'You have not risen yet.');
      check(playing(state), 'wrong_phase', 'Not now.');
      check(p.hauntDay !== state.day, 'not_ready', 'One visit a day.');
      check(LOCATIONS.includes(command.to), 'invalid_target', 'Unknown place.');
      return hauntLocation(state, p, command.to);
    }
    case 'unhaunt': {
      check(p.status === 'dead' && p.haunt !== null, 'not_allowed', 'You are not visiting anyone.');
      announceAt(state, p.haunt, 'msg.ghostLeft', { playerId: p.id });
      p.haunt = null;
      touch(state);
      return;
    }
    case 'choose': {
      const prompt = state.prompts.find((x) => x.id === command.promptId && x.playerId === p.id);
      check(prompt, 'invalid_choice', 'Nothing to choose.');
      const ids = [...new Set(command.ids)];
      check(ids.length <= prompt.pick, 'invalid_choice', 'Too many people.');
      for (const id of ids) check(findPlayer(state, id), 'invalid_target', 'No such player.');
      return applyPrompt(state, prompt, ids, command.option);
    }
    case 'ready':
      check(state.phase.kind === 'summary', 'wrong_phase', 'Not now.');
      p.ready = true;
      touch(state);
      return;
    case 'setAutoAmnesty':
      check(p.role === 'grif', 'not_allowed', 'Only Grif has amnesty.');
      p.autoAmnesty = command.on;
      touch(state);
      return;
    case 'forfeit':
      if (isAlive(p)) kill(state, p, 'left');
      return;
  }
}

// ---------------------------------------------------------------------------
// Moving and talking
// ---------------------------------------------------------------------------

function move(state: GameState, p: Player, to: Player['location']): void {
  check(isAlive(p), 'not_alive', 'You are not among the living.');
  check(playing(state), 'wrong_phase', 'Not now.');
  check(LOCATIONS.includes(to) && to !== p.location, 'invalid_target', 'You are already there.');
  check(!isIsolated(p), 'isolated', 'You are locked in the isolator.');
  check(!inCombat(state, p.id), 'busy', 'You are in a fight.');
  if (state.court) {
    // During a trial the clock stands still and the way to the town hall is free.
    check(to === 'townhall', 'court', 'The court is in session. You can only go to the town hall.');
    enterLocation(state, p, to);
    return;
  }
  check(p.moves > 0, 'no_moves', 'No moves left.');
  check(!closedToday(state, to), 'closed', 'That place is closed today.');
  check(!(isNight(state) && hasEvent(state, 'curfew')), 'curfew', 'Curfew: nobody walks the streets tonight.');
  p.moves -= 1;
  enterLocation(state, p, to);
}

function chat(state: GameState, p: Player, raw: string): void {
  const text = cleanText(raw);
  check(isAlive(p), 'not_alive', 'The dead cannot speak to the living.');
  if (state.phase.kind === 'summary') {
    state.messages.push({ id: nextId(state), day: state.day, to: 'all', kind: 'chat', location: 'square', fromId: p.id, text });
  } else {
    const to = state.players
      .filter((x) => (isAlive(x) && x.location === p.location) || (x.status === 'dead' && x.haunt === p.location))
      .map((x) => x.id);
    state.messages.push({ id: nextId(state), day: state.day, to, kind: 'chat', location: p.location, fromId: p.id, text });
  }
  touch(state);
}

// ---------------------------------------------------------------------------
// Trade
// ---------------------------------------------------------------------------

function validBundle(bundle: Bundle): void {
  check(Number.isSafeInteger(bundle.gold) && bundle.gold >= 0, 'invalid_payload', 'Bad amount of gold.');
  for (const [item, n] of Object.entries(bundle.items)) {
    check(Number.isSafeInteger(n) && (n ?? 0) > 0, 'invalid_payload', 'Bad amount.');
    check(!UNTRADEABLE.includes(item as ItemId), 'untradeable', 'That cannot be traded.');
  }
}

function offer(state: GameState, p: Player, targetId: string, give: Bundle, want: Bundle): void {
  check(isAlive(p) && playing(state), 'wrong_phase', 'Not now.');
  check(!isIsolated(p), 'isolated', 'You are locked in the isolator.');
  const target = getPlayer(state, targetId);
  check(target.id !== p.id && isAlive(target) && target.location === p.location, 'invalid_target', 'That player is not here.');
  validBundle(give);
  validBundle(want);
  check(!(bundleEmpty(give) && bundleEmpty(want)), 'invalid_payload', 'The offer is empty.');
  check(hasBundle(p, give), 'missing_item', 'You do not have all of that.');
  check(p.actions > 0, 'no_actions', 'No actions left.');
  check(state.offers.filter((o) => o.fromId === p.id).length < 3, 'busy', 'Too many open offers.');
  state.offers.push({ id: nextId(state), kind: 'trade', fromId: p.id, toId: target.id, give, want, deadline: state.t + OFFER_MS });
  touch(state);
}

function buyTicket(state: GameState, p: Player, sellerId: string): void {
  active(state, p);
  const seller = getPlayer(state, sellerId);
  check(seller.id !== p.id && isAlive(seller) && seller.location === p.location, 'invalid_target', 'That player is not here.');
  check(count(seller.inv, 'ticket') > 0, 'invalid_target', 'That player has no ticket.');
  const price = Math.max(0, TICKET_PRICE - p.ticketDiscount);
  check(p.gold >= price, 'no_gold', 'Not enough gold.');
  check(p.actions > 0, 'no_actions', 'No actions left.');
  state.offers.push({
    id: nextId(state),
    kind: 'ticket',
    fromId: p.id,
    toId: seller.id,
    give: { gold: price, items: {} },
    want: { gold: 0, items: { ticket: 1 } },
    deadline: state.t + OFFER_MS,
  });
  touch(state);
}

function offerReply(state: GameState, p: Player, offerId: number, accept: boolean): void {
  const o = state.offers.find((x) => x.id === offerId && (x.toId === p.id || x.fromId === p.id));
  check(o, 'invalid_choice', 'That offer is gone.');
  state.offers = state.offers.filter((x) => x.id !== o.id);
  touch(state);
  if (!accept) {
    if (o.toId === p.id) tell(state, o.fromId, 'msg.offerDeclined', { playerId: p.id });
    return;
  }
  check(o.toId === p.id, 'invalid_choice', 'You cannot accept your own offer.');
  const from = getPlayer(state, o.fromId);
  check(isAlive(from) && isAlive(p) && from.location === p.location, 'invalid_target', 'The other side is gone.');
  check(hasBundle(from, o.give) && hasBundle(p, o.want), 'missing_item', 'Somebody no longer has what was promised.');
  check(from.actions > 0, 'no_actions', 'The other side has no actions left.');
  from.actions -= 1;

  if (o.kind === 'ticket') {
    from.gold -= o.give.gold; // the ticket's price leaves the economy
    removeItem(p.inv, 'ticket');
    addItem(from.inv, 'ticket');
    tell(state, from, 'msg.ticketBought');
    if (from.caste === 'bandit') {
      p.gold += 5;
      addItem(p.inv, 'rationBig');
      tell(state, p, 'msg.ticketReward');
    }
    return;
  }

  transfer(state, from, p, o.give);
  transfer(state, p, from, o.want);
  const alone = livingAt(state, p.location).length === 2;
  for (const [a, b] of [[from, p], [p, from]] as const) {
    addFact(a, 'trade');
    addFact(a, `trade:${b.id}`);
    if (alone) addFact(a, 'tradeAlone');
  }
  tell(state, from, 'msg.tradeDone', { playerId: p.id });
  tell(state, p, 'msg.tradeDone', { playerId: from.id });
}

/** Moves a bundle and records the facts tasks care about. A poisoned rusk arrives as a plain one. */
function transfer(state: GameState, giver: Player, taker: Player, bundle: Bundle): void {
  if (bundleEmpty(bundle)) return;
  giver.gold -= bundle.gold;
  taker.gold += bundle.gold;
  if (bundle.gold > 0) addFact(giver, 'gaveGold');
  for (const [key, n] of Object.entries(bundle.items) as [ItemId, number][]) {
    removeItem(giver.inv, key, n);
    if (key === 'poisonRusk') {
      addItem(taker.inv, 'rusk', n);
      taker.poisoned = true;
      addFact(giver, 'poison');
    } else {
      addItem(taker.inv, key, n);
    }
    if (MEDICINE.includes(key) && taker.infection > 0) addFact(giver, `medicine:${taker.id}`);
    if (FOOD[key] !== undefined && isIsolated(taker)) addFact(giver, 'feedIsolated');
    if (FOOD[key] !== undefined && taker.infection > 0) addFact(giver, 'feedInfected');
  }
  addFact(taker, `got:${giver.id}`);
  touch(state);
}

// ---------------------------------------------------------------------------
// Shops
// ---------------------------------------------------------------------------

/** The first deal of a shop visit costs an action, the rest of the visit is free. */
function openShop(p: Player): void {
  if (p.shopping) return;
  spend(p);
  p.shopping = true;
}

function buy(state: GameState, p: Player, item: ItemId, hidden: boolean): void {
  active(state, p);
  const price = priceOf(state, p.location, item);
  check(price, 'not_for_sale', 'That is not for sale here.');
  check(p.gold >= price.gold, 'no_gold', 'Not enough gold.');
  check(count(p.inv, 'coupon') >= price.coupons, 'missing_item', 'You need a coupon.');
  const secret = hidden && p.role === 'angel' && p.location === 'market';
  if (secret) check(ready(p, 'offer', 2, state.day), 'not_ready', 'You can hide a purchase once every two days.');
  openShop(p);
  p.gold -= price.gold;
  removeItem(p.inv, 'coupon', price.coupons);
  addItem(p.inv, item, price.amount);
  if (p.location === 'blackmarket') addFact(p, 'blackBuy');
  if (p.location === 'market') {
    if (secret) useCooldown(p, 'offer', state.day);
    else announceAt(state, 'market', 'msg.bought', { playerId: p.id, item, n: price.amount });
  }
  touch(state);
}

function sell(state: GameState, p: Player, item: ItemId): void {
  active(state, p);
  const price = sellPriceOf(state, p.location, item);
  check(price !== null, 'not_for_sale', 'Nobody buys that here.');
  check(count(p.inv, item) > 0, 'missing_item', 'You do not have that.');
  openShop(p);
  removeItem(p.inv, item);
  p.gold += price;
  touch(state);
}

// ---------------------------------------------------------------------------
// Using things
// ---------------------------------------------------------------------------

/** Stage 3-4 nausea: on 1-3 the food or water is wasted. */
function nauseous(state: GameState, p: Player): boolean {
  if (p.infection < 3) return false;
  const roll = d6(state);
  if (roll <= 3) {
    tell(state, p, 'msg.nausea', { roll });
    return true;
  }
  return false;
}

function useItem(state: GameState, p: Player, item: ItemId): void {
  check(isAlive(p), 'not_alive', 'You are not among the living.');
  check(count(p.inv, item) > 0, 'missing_item', 'You do not have that.');
  const food = FOOD[item];
  const drink = DRINK[item];
  if (food !== undefined || drink !== undefined) {
    removeItem(p.inv, item);
    if (item === 'poisonRusk') p.poisoned = true;
    if (!nauseous(state, p)) {
      if (food !== undefined) p.hunger = Math.min(MAX_HUNGER, p.hunger + food);
      if (drink !== undefined) p.thirst = Math.min(MAX_THIRST, p.thirst + drink);
    }
    touch(state);
    return;
  }
  switch (item) {
    case 'bandage':
      check(ready(p, 'bandage', 1, state.day), 'not_ready', 'One bandage a day.');
      useCooldown(p, 'bandage', state.day);
      removeItem(p.inv, item);
      heal(p, 1);
      break;
    case 'immunizer':
      removeItem(p.inv, item);
      p.infection = Math.max(0, p.infection - 1);
      break;
    case 'strongPotion':
      removeItem(p.inv, item);
      p.infection = Math.max(0, p.infection - 2);
      break;
    case 'folkRemedy':
      removeItem(p.inv, item);
      p.infection = Math.max(0, p.infection - 2);
      damage(state, p, 1, 'remedy');
      break;
    case 'serum':
      removeItem(p.inv, item);
      p.infection = 0;
      p.vulnerable = true;
      p.usedSerum = true;
      addFact(p, 'serum');
      break;
    default:
      fail('not_usable', 'That cannot be used.');
  }
  touch(state);
}

// ---------------------------------------------------------------------------
// Bachelor
// ---------------------------------------------------------------------------

function healPatient(state: GameState, p: Player, targetId: string): void {
  active(state, p);
  check(p.role === 'bachelor', 'not_allowed', 'Only the bachelor can treat people.');
  check(ready(p, 'heal', 1, state.day), 'not_ready', 'Once a day.');
  const target = getPlayer(state, targetId);
  check(isAlive(target) && target.location === p.location, 'invalid_target', 'That player is not here.');
  check(target.infection > 0, 'invalid_target', 'That player is not sick.');
  spend(p);
  useCooldown(p, 'heal', state.day);
  target.infection -= 1;
  addFact(p, 'heal');
  tell(state, target, 'msg.treated', { playerId: p.id, stage: target.infection });
  if (target.id !== p.id) tell(state, p, 'msg.treatedOther', { playerId: target.id });
}

function suspect(state: GameState, p: Player, targetId: string): void {
  active(state, p);
  check(p.role === 'bachelor' && !p.spent.suspicion, 'not_allowed', 'You have used your suspicion.');
  const target = getPlayer(state, targetId);
  check(target.id !== p.id && isAlive(target), 'invalid_target', 'Choose another living player.');
  spend(p);
  p.spent.suspicion = true;
  const right = target.caste === 'bandit';
  if (right) for (const v of VALUABLES) removeItem(target.inv, v, count(target.inv, v));
  sys(state, 'all', right ? 'msg.suspectRight' : 'msg.suspectWrong', { playerId: target.id });
}

function courtStart(state: GameState, p: Player, accusedId: string, now: number): void {
  active(state, p);
  check(p.role === 'bachelor', 'not_allowed', 'Only the bachelor can call a court.');
  check(ready(p, 'court', 1, state.day), 'not_ready', 'One court a day.');
  const accused = getPlayer(state, accusedId);
  check(accused.id !== p.id && isAlive(accused) && !isIsolated(accused), 'invalid_target', 'Choose another living player.');
  spend(p);
  useCooldown(p, 'court', state.day);
  addFact(p, 'court');
  state.court = { accusedId: accused.id, endsAtReal: now + state.config.courtMs, votes: {} };
  sys(state, 'all', 'msg.courtStarted', { accusedId: accused.id });
}

// ---------------------------------------------------------------------------
// Angel and Grif
// ---------------------------------------------------------------------------

function premonition(state: GameState, p: Player): void {
  active(state, p);
  check(p.role === 'angel', 'not_allowed', 'Only Angel has premonitions.');
  check(ready(p, 'premonition', 1, state.day), 'not_ready', 'Once a day.');
  spend(p, 2);
  useCooldown(p, 'premonition', state.day);
  addFact(p, 'premonition');
  const day = state.day + 1;
  const events = state.schedule[day] ?? [];
  tell(state, p, 'msg.premonition', { day, events: events.join(',') || '-' });
  const secret = state.secret[day];
  if (secret) tell(state, p, `secret.${secret.kind}`, { loc: secret.location });
}

function stash(state: GameState, p: Player, gold: number, item: ItemId | null): void {
  check(isAlive(p) && p.role === 'grif', 'not_allowed', 'Only Grif has deep pockets.');
  check(ready(p, 'stash', 2, state.day), 'not_ready', 'Once every two days.');
  check((gold > 0) !== (item !== null), 'invalid_choice', 'Hide either gold or one item.');
  if (gold > 0) {
    check(Number.isSafeInteger(gold) && gold <= 3 && p.gold >= gold, 'invalid_choice', 'Up to 3 gold you have.');
    p.gold -= gold;
    p.stash.gold += gold;
  } else if (item !== null) {
    check(removeItem(p.inv, item), 'missing_item', 'You do not have that.');
    addItem(p.stash.items as Inventory, item);
  }
  useCooldown(p, 'stash', state.day);
  addFact(p, 'stash');
  touch(state);
}
