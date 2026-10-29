import { ITEMS, LOCATIONS, type Bundle, type CombatMod, type Inventory, type ItemId, type LocationId } from '@plague/engine';
import {
  CHAT_MAX,
  CODE_ALPHABET,
  CODE_LENGTH,
  NICKNAME_MAX,
  NICKNAME_MIN,
  TIMER_PRESETS,
  type ClientCommand,
  type ClientMessage,
  type TimerPreset,
} from './events';

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const ok = <T>(value: T): Parsed<T> => ({ ok: true, value });
const bad = (error: string): Parsed<never> => ({ ok: false, error });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const MAX_ID_LENGTH = 64;
const MAX_TOKEN_LENGTH = 128;

/**
 * Commands are parsed field by field. A failed field throws `Invalid`, which the
 * top-level parser turns into an error result; nothing a client invents (such as a
 * `playerId`) is ever copied through.
 */
class Invalid extends Error {}

function id(value: unknown, what: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_ID_LENGTH) throw new Invalid(`${what} must be an id.`);
  return value;
}

function int(value: unknown, what: string, min = 0, max = 1_000_000): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new Invalid(`${what} must be a whole number.`);
  }
  return value;
}

function bool(value: unknown, what: string): boolean {
  if (typeof value !== 'boolean') throw new Invalid(`${what} must be true or false.`);
  return value;
}

function oneOf<T extends string>(value: unknown, options: readonly T[], what: string): T {
  if (typeof value !== 'string' || !(options as readonly string[]).includes(value)) throw new Invalid(`Unknown ${what}.`);
  return value as T;
}

function text(value: unknown): string {
  if (typeof value !== 'string') throw new Invalid('Text expected.');
  const clean = value.replace(/\s+/gu, ' ').trim();
  if (clean.length === 0 || clean.length > CHAT_MAX) throw new Invalid(`Messages are 1-${CHAT_MAX} characters.`);
  return clean;
}

const location = (v: unknown): LocationId => oneOf(v, LOCATIONS, 'location');
const item = (v: unknown): ItemId => oneOf(v, ITEMS, 'item');

function bundle(value: unknown): Bundle {
  if (!isRecord(value)) throw new Invalid('Bundle must be an object.');
  const items: Inventory = {};
  const raw = value['items'] ?? {};
  if (!isRecord(raw)) throw new Invalid('Items must be an object.');
  for (const [key, n] of Object.entries(raw)) {
    const amount = int(n, 'Amount', 0, 99);
    if (amount > 0) items[item(key)] = amount;
  }
  return { gold: int(value['gold'] ?? 0, 'Gold', 0, 999), items };
}

function mods(value: unknown): CombatMod[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 3) throw new Invalid('Bad modifiers.');
  return value.map((m) => oneOf(m, ['sneak', 'booze', 'allIn'] as const, 'modifier'));
}

/** Trims, collapses inner whitespace and checks length and characters. */
export function normalizeNickname(raw: unknown): Parsed<string> {
  if (typeof raw !== 'string') return bad('Nickname must be text.');
  const name = raw.normalize('NFC').replace(/\s+/gu, ' ').trim();
  const length = [...name].length;
  if (length < NICKNAME_MIN || length > NICKNAME_MAX) {
    return bad(`Nickname must be ${NICKNAME_MIN}-${NICKNAME_MAX} characters.`);
  }
  if (!/^[\p{L}\p{N} _.'-]+$/u.test(name)) {
    return bad('Nickname may only contain letters, digits, spaces and _ . \' -');
  }
  return ok(name);
}

/** Uppercases and trims a room code. Returns an error if it cannot be a valid code. */
export function normalizeRoomCode(raw: unknown): Parsed<string> {
  if (typeof raw !== 'string') return bad('Room code must be text.');
  const code = raw.trim().toUpperCase();
  if (code.length !== CODE_LENGTH || ![...code].every((c) => CODE_ALPHABET.includes(c))) {
    return bad('That is not a valid room code.');
  }
  return ok(code);
}

function command(raw: Record<string, unknown>): ClientCommand {
  const type = raw['type'];
  switch (type) {
    case 'move':
      return { type, to: location(raw['to']) };
    case 'stealth':
      return { type, to: location(raw['to']) };
    case 'haunt':
      return { type, to: location(raw['to']) };
    case 'chat':
    case 'ghostChat':
    case 'note':
      return { type, text: text(raw['text']) };
    case 'infoRequest':
      return { type, askerId: id(raw['askerId'], 'askerId') };
    case 'offer':
      return { type, targetId: id(raw['targetId'], 'targetId'), give: bundle(raw['give']), want: bundle(raw['want']) };
    case 'offerReply':
      return { type, offerId: int(raw['offerId'], 'offerId'), accept: bool(raw['accept'], 'accept') };
    case 'buyTicket':
      return { type, sellerId: id(raw['sellerId'], 'sellerId') };
    case 'buy':
      return { type, item: item(raw['item']), hidden: raw['hidden'] === undefined ? false : bool(raw['hidden'], 'hidden') };
    case 'sell':
      return { type, item: item(raw['item']) };
    case 'use':
      return { type, item: item(raw['item']) };
    case 'attack':
      return {
        type,
        targetId: id(raw['targetId'], 'targetId'),
        loot: oneOf(raw['loot'], ['gold', 'food', 'water'] as const, 'loot'),
        mods: mods(raw['mods']),
      };
    case 'defend': {
      const flee = raw['flee'];
      const out: ClientCommand = { type, attackId: int(raw['attackId'], 'attackId'), mods: mods(raw['mods']) };
      if (flee !== undefined && flee !== null) {
        if (!isRecord(flee)) throw new Invalid('Bad flight.');
        out.flee = { ability: oneOf(flee['ability'], ['fastLegs', 'nightCover'] as const, 'ability'), to: location(flee['to']) };
      }
      return out;
    }
    case 'bleed':
    case 'search':
    case 'heal':
    case 'suspect':
      return { type, targetId: id(raw['targetId'], 'targetId') };
    case 'showItem':
      return { type, searchId: int(raw['searchId'], 'searchId'), item: raw['item'] === null ? null : item(raw['item']) };
    case 'courtStart':
      return { type, accusedId: id(raw['accusedId'], 'accusedId') };
    case 'courtVote':
      return { type, guilty: bool(raw['guilty'], 'guilty') };
    case 'stash':
      return { type, gold: int(raw['gold'] ?? 0, 'gold', 0, 3), item: raw['item'] === null || raw['item'] === undefined ? null : item(raw['item']) };
    case 'choose': {
      const ids = raw['ids'];
      if (!Array.isArray(ids) || ids.length > 10) throw new Invalid('ids must be a short list.');
      const out: ClientCommand = { type, promptId: int(raw['promptId'], 'promptId'), ids: ids.map((x) => id(x, 'id')) };
      if (raw['option'] !== undefined) out.option = int(raw['option'], 'option', 1, 20);
      return out;
    }
    case 'setAutoAmnesty':
      return { type, on: bool(raw['on'], 'on') };
    case 'megaphone':
    case 'courtClose':
    case 'serumRoll':
    case 'serumHelp':
    case 'donateIngredients':
    case 'remedyRoll':
    case 'gatherHerbs':
    case 'craftPotion':
    case 'premonition':
    case 'unstash':
    case 'outlaw':
    case 'escape':
    case 'rumor':
    case 'well':
    case 'corpse':
    case 'unhaunt':
    case 'ready':
    case 'forfeit':
      return { type };
    default:
      throw new Invalid('Unknown command type.');
  }
}

export function parseClientCommand(raw: unknown): Parsed<ClientCommand> {
  if (!isRecord(raw)) return bad('Command must be an object.');
  try {
    return ok(command(raw));
  } catch (error) {
    if (error instanceof Invalid) return bad(error.message);
    throw error;
  }
}

/**
 * Validates one raw socket message. Unknown fields are dropped, so nothing a client
 * invents ever reaches the server logic.
 */
export function parseClientMessage(event: unknown, payload: unknown): Parsed<ClientMessage> {
  if (typeof event !== 'string') return bad('Event name must be text.');
  const data = payload === undefined || payload === null ? {} : payload;
  if (!isRecord(data)) return bad('Payload must be an object.');

  switch (event) {
    case 'room:create': {
      const nickname = normalizeNickname(data['nickname']);
      return nickname.ok ? ok({ event, data: { nickname: nickname.value } }) : nickname;
    }
    case 'room:join': {
      const code = normalizeRoomCode(data['code']);
      if (!code.ok) return code;
      const nickname = normalizeNickname(data['nickname']);
      return nickname.ok ? ok({ event, data: { code: code.value, nickname: nickname.value } }) : nickname;
    }
    case 'room:rejoin': {
      const code = normalizeRoomCode(data['code']);
      if (!code.ok) return code;
      const token = data['token'];
      if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
        return bad('Invalid token.');
      }
      return ok({ event, data: { code: code.value, token } });
    }
    case 'room:leave':
    case 'lobby:start':
    case 'room:playAgain':
      return ok({ event, data: {} });
    case 'lobby:settings': {
      const out: { timerPreset?: TimerPreset; allowSpectators?: boolean } = {};
      if (data['timerPreset'] !== undefined) {
        const preset = data['timerPreset'];
        if (typeof preset !== 'string' || !(TIMER_PRESETS as readonly string[]).includes(preset)) {
          return bad('Unknown timer preset.');
        }
        out.timerPreset = preset as TimerPreset;
      }
      if (data['allowSpectators'] !== undefined) {
        if (typeof data['allowSpectators'] !== 'boolean') return bad('allowSpectators must be true or false.');
        out.allowSpectators = data['allowSpectators'];
      }
      return ok({ event, data: out });
    }
    case 'room:kick': {
      const raw = data['playerId'];
      if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_ID_LENGTH) return bad('playerId must be an id.');
      return ok({ event, data: { playerId: raw } });
    }
    case 'game:command': {
      const parsed = parseClientCommand(data['command']);
      return parsed.ok ? ok({ event, data: { command: parsed.value } }) : parsed;
    }
    default:
      return bad(`Unknown event "${event.slice(0, 40)}".`);
  }
}
