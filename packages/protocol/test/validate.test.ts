import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeNickname, normalizeRoomCode, parseClientMessage } from '../src';

describe('validation', () => {
  it('normalizes nicknames and room codes', () => {
    assert.deepEqual(normalizeNickname('  Анна   Ангел '), { ok: true, value: 'Анна Ангел' });
    assert.equal(normalizeNickname('x').ok, false);
    assert.deepEqual(normalizeRoomCode(' abcde '), { ok: true, value: 'ABCDE' });
    assert.equal(normalizeRoomCode('ABCD1').ok, false);
  });

  it('drops a playerId smuggled into a command', () => {
    const parsed = parseClientMessage('game:command', { command: { type: 'move', to: 'market', playerId: 'someone' } });
    assert.ok(parsed.ok);
    if (parsed.ok && parsed.value.event === 'game:command') {
      assert.deepEqual(parsed.value.data.command, { type: 'move', to: 'market' });
    }
  });

  it('checks bundles, locations and items', () => {
    const offer = (give: unknown) => parseClientMessage('game:command', { command: { type: 'offer', targetId: 'p2', give, want: { gold: 0, items: {} } } });
    assert.ok(offer({ gold: 2, items: { rusk: 1 } }).ok);
    assert.equal(offer({ gold: -1, items: {} }).ok, false);
    assert.equal(offer({ gold: 0, items: { gold: 3 } }).ok, false);
    assert.equal(parseClientMessage('game:command', { command: { type: 'move', to: 'moon' } }).ok, false);
    assert.equal(parseClientMessage('game:command', { command: { type: 'use', item: 'cake' } }).ok, false);
  });

  it('limits chat length and rejects unknown events', () => {
    assert.equal(parseClientMessage('game:command', { command: { type: 'chat', text: 'x'.repeat(301) } }).ok, false);
    assert.ok(parseClientMessage('game:command', { command: { type: 'chat', text: ' привет ' } }).ok);
    assert.equal(parseClientMessage('hack', {}).ok, false);
  });

  it('parses defence with flight', () => {
    const parsed = parseClientMessage('game:command', {
      command: { type: 'defend', attackId: 3, mods: ['sneak'], flee: { ability: 'fastLegs', to: 'square' } },
    });
    assert.ok(parsed.ok);
  });
});
