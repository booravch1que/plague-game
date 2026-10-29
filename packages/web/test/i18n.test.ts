import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { BANDIT_ABILITIES, ITEMS, LOCATIONS, QUESTS, ROLES, type DayEvent } from '@plague/engine';
import { en } from '../src/i18n/en';
import { ru } from '../src/i18n/ru';
import { makeT } from '../src/i18n';

const ENGINE_SRC = join(import.meta.dirname, '../../engine/src');
const EVENTS: DayEvent[] = ['well', 'rumors', 'alarm', 'waterShortage', 'symptoms', 'forcedLabor', 'corpse', 'curfew', 'convoy', 'rats', 'couponsSale', 'couponsFood', 'couponsWater', 'looting', 'fire'];

/** Every literal message key the engine can send. */
function engineKeys(): string[] {
  const keys = new Set<string>();
  for (const file of readdirSync(ENGINE_SRC)) {
    const text = readFileSync(join(ENGINE_SRC, file), 'utf8');
    for (const m of text.matchAll(/'((?:msg|dice|rumor|quest|secret)\.[A-Za-z.]+)'/g)) keys.add(m[1] as string);
  }
  for (const e of EVENTS) for (const s of ['name', 'now', 'soon']) keys.add(`event.${e}.${s}`);
  for (const k of ['closed', 'infected']) keys.add(`secret.${k}`);
  for (const r of ROLES) {
    keys.add(`role.${r}`);
    keys.add(`roleDesc.${r}`);
    for (const day of Object.keys(QUESTS[r])) keys.add(`quest.${r}.${day}`);
  }
  for (const i of ITEMS) {
    keys.add(`item.${i}`);
    keys.add(`itemDesc.${i}`);
  }
  for (const l of LOCATIONS) keys.add(`loc.${l}`);
  for (const a of BANDIT_ABILITIES) keys.add(`bandit.${a}`);
  return [...keys];
}

describe('i18n', () => {
  it('has the same keys in both languages', () => {
    const missingInRu = Object.keys(en).filter((k) => !(k in ru));
    const missingInEn = Object.keys(ru).filter((k) => !(k in en));
    assert.deepEqual(missingInRu, []);
    assert.deepEqual(missingInEn, []);
  });

  it('translates every key the engine sends', () => {
    const missing = engineKeys().filter((k) => !(k in en) || !(k in ru));
    assert.deepEqual(missing, []);
  });

  it('fills parameters and plural forms', () => {
    const t = makeT('ru');
    assert.equal(t('phase.day', { day: 3 }), 'День 3');
    assert.equal(t('lobby.players', { count: 5 }), 'Игроки (5)');
  });
});
