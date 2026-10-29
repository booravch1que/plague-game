import { DICE_VISIBLE_MS } from './constants';
import { contaminatedToday, hasEvent } from './schedule';
import type { GameState, LocationId, Player } from './types';
import { addFact, addItem, announceAt, d6, addDice, infect, isAlive, livingAt, tell, touch } from './util';

/**
 * Puts a living player into a location. Every way of moving goes through here:
 * a normal move, a flight, stealth, the outlaw's shortcut, release from the isolator.
 */
export function enterLocation(state: GameState, p: Player, to: LocationId): void {
  const from = p.location;
  if (from !== to) announceAt(state, from, 'msg.left', { playerId: p.id });
  p.location = to;
  p.enteredAt = state.t;
  p.shopping = false;
  p.exposureStart = null;
  p.exposedThisVisit = false;
  if (to !== 'factory') p.workStart = null;
  if (state.stealth?.playerId === p.id && from !== to) state.stealth = null;
  state.offers = state.offers.filter((o) => o.fromId !== p.id && o.toId !== p.id);
  if (from !== to) announceAt(state, to, 'msg.arrived', { playerId: p.id });

  if (state.dice.some((d) => d.location === to && d.attack && state.t - d.at < DICE_VISIBLE_MS)) addFact(p, 'witness');

  if (to === 'townhall' && state.phase.kind === 'day' && hasEvent(state, 'convoy')) {
    if (state.convoyGot.length < 3 && !state.convoyGot.includes(p.id)) {
      state.convoyGot.push(p.id);
      addItem(p.inv, 'rationSmall');
      tell(state, p, 'msg.convoy');
    }
  }
  if (contaminatedToday(state, to)) infect(state, p, 1, 'other');
  touch(state);
}

/** A ghost enters a location. Everyone alive there rolls at once: 4-6 means infection. */
export function hauntLocation(state: GameState, ghost: Player, to: LocationId): void {
  ghost.haunt = to;
  ghost.hauntDay = state.day;
  announceAt(state, to, 'msg.ghostArrived', { playerId: ghost.id });
  for (const p of livingAt(state, to)) {
    const roll = d6(state);
    const caught = roll >= 4;
    addDice(state, to, caught ? 'dice.ghostCaught' : 'dice.ghostMissed', { playerId: p.id, roll });
    if (caught && isAlive(p)) infect(state, p, 1, 'contact');
  }
  touch(state);
}
