import {
  DRINK,
  FOOD,
  ITEMS,
  MAX_HUNGER,
  MAX_INFECTION,
  MAX_THIRST,
  type GameView,
  type ItemId,
  type SelfView,
} from '@plague/engine';
import { CHAT_MAX } from '@plague/protocol';
import { useState } from 'react';
import { useController, useT } from '../hooks';
import { useCtx } from './Chrome';
import type { Open } from './Dialogs';
import { bundleText } from './Offers';

const USABLE: readonly ItemId[] = ['bandage', 'immunizer', 'serum', 'folkRemedy', 'strongPotion'];

function Meter({ label, value, max, tone }: { label: string; value: number; max: number; tone: string }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <div className="meter">
        <div className={`meter-fill ${tone}`} style={{ width: `${Math.max(0, Math.min(1, value / max)) * 100}%` }} />
      </div>
      <span className="stat-value">
        {value}/{max}
      </span>
    </div>
  );
}

/** Your character: role, stats, inventory, abilities and today's errand. */
export function MePanel({ view, open }: { view: GameView; open: Open }) {
  const t = useT();
  const me = view.you;
  if (!me) return null;
  return (
    <div className="panel me">
      <h2 className="panel-title">{t('me.title', { role: t(`role.${me.role}`) })}</h2>
      <p className="muted small">{t('me.caste', { caste: t(`caste.${me.caste}`) })}</p>
      <details className="role-desc">
        <summary className="small">ⓘ</summary>
        <p className="small">{t(`roleDesc.${me.role}`)}</p>
      </details>
      {me.status === 'dead' && <GhostControls view={view} me={me} />}
      {me.status === 'escaped' && <p className="warn">{t('me.escaped')}</p>}
      {me.status === 'alive' && (
        <>
          {me.isolatedUntil !== null && <p className="warn">{t('me.isolated', { day: me.isolatedUntil })}</p>}
          <div className="stats">
            <Meter label={t('stat.hp')} value={me.hp} max={me.maxHp} tone="hp" />
            <Meter label={t('stat.hunger')} value={me.hunger} max={MAX_HUNGER} tone="hunger" />
            <Meter label={t('stat.thirst')} value={me.thirst} max={MAX_THIRST} tone="thirst" />
            <Meter label={t('stat.infection')} value={me.infection} max={MAX_INFECTION} tone="infection" />
          </div>
          {me.vulnerable && <p className="small good">🛡 {t('stat.vulnerable')}</p>}
          <p className="gold-line">🪙 {me.gold}</p>
          <Quest view={view} me={me} />
          <Inventory me={me} />
          <Abilities view={view} me={me} open={open} />
        </>
      )}
    </div>
  );
}

function Quest({ view, me }: { view: GameView; me: SelfView }) {
  const t = useT();
  if (!me.quest) return <p className="muted small">{t('me.noQuest')}</p>;
  return (
    <div className={`quest${me.quest.done ? ' done' : ''}`}>
      <h3 className="sub">
        {t('me.quest')} {me.quest.done && <span className="tag tag-pass">{t('me.questDone')}</span>}
      </h3>
      <p className="small">{t(`quest.${me.role}.${view.day}`)}</p>
    </div>
  );
}

function Inventory({ me }: { me: SelfView }) {
  const t = useT();
  const app = useController();
  const items = ITEMS.filter((i) => (me.inv[i] ?? 0) > 0);
  const stashed = me.stash.gold > 0 || Object.keys(me.stash.items).length > 0;
  const usable = (item: ItemId) => FOOD[item] !== undefined || DRINK[item] !== undefined || USABLE.includes(item);
  return (
    <div className="inventory">
      <h3 className="sub">{t('me.inventory')}</h3>
      {items.length === 0 && <p className="muted small">{t('me.empty')}</p>}
      <ul className="inv-list">
        {items.map((item) => (
          <li key={item} className="inv-line">
            <span className="inv-name">
              {t(`item.${item}`)} ×{me.inv[item]}
              <span className="muted small"> {t(`itemDesc.${item}`)}</span>
            </span>
            {usable(item) && (
              <button
                type="button"
                className="btn btn-mini"
                disabled={item === 'bandage' && !me.ready['bandage']}
                onClick={() => app.command({ type: 'use', item })}
              >
                {t('me.use')}
              </button>
            )}
          </li>
        ))}
      </ul>
      {stashed && <p className="small muted">{t('me.stash', { gold: me.stash.gold, items: bundleText({ gold: 0, items: me.stash.items }, t) })}</p>}
    </div>
  );
}

function Abilities({ view, me, open }: { view: GameView; me: SelfView; open: Open }) {
  const t = useT();
  const app = useController();
  const ctx = useCtx();
  const free = (view.phase === 'day' || view.phase === 'night') && !view.paused && me.isolatedUntil === null;
  const entries = Object.entries(me.ready);
  const buttons: { key: string; run: () => void; disabled?: boolean }[] = [];
  if (free) {
    if (me.role === 'bachelor') {
      if (me.ready['court']) buttons.push({ key: 'act.court', run: () => open({ kind: 'court' }) });
      if (me.ready['suspect']) buttons.push({ key: 'act.suspect', run: () => open({ kind: 'suspect' }) });
    }
    if (me.role === 'haruspex') {
      if (me.ready['remedy']) buttons.push({ key: 'act.remedy', run: () => app.command({ type: 'remedyRoll' }) });
    }
    if (me.role === 'angel') {
      if (me.ready['premonition']) buttons.push({ key: 'act.premonition', run: () => app.command({ type: 'premonition' }), disabled: me.actions < 2 });
    }
  }
  if (me.role === 'haruspex' && me.ingredients >= 3) buttons.push({ key: 'act.potion', run: () => app.command({ type: 'craftPotion' }) });
  if (me.role === 'angel' && me.ready['note']) buttons.push({ key: 'act.note', run: () => open({ kind: 'note' }) });
  if (me.role === 'grif') {
    if (me.ready['stash']) buttons.push({ key: 'act.stash', run: () => open({ kind: 'stash' }) });
    if (me.stash.gold > 0 || Object.keys(me.stash.items).length > 0) buttons.push({ key: 'act.unstash', run: () => app.command({ type: 'unstash' }) });
  }

  return (
    <div className="abilities">
      <h3 className="sub">{t('me.abilities')}</h3>
      {me.role === 'haruspex' && (
        <p className="small">
          {t('me.remedy', { n: me.remedyProgress })} · {t('me.ingredients', { n: me.ingredients })}
        </p>
      )}
      {me.huntTargetId && <p className="small warn">{t('me.hunt', { name: ctx.name(me.huntTargetId) })}</p>}
      <ul className="ability-list">
        {entries.map(([key, ok]) => (
          <li key={key} className={`ability${ok ? ' on' : ''}`}>
            <span>{t(`ab.${key}`)}</span>
            <span className="small">{ok ? t('me.ready') : t('me.cooldown')}</span>
          </li>
        ))}
      </ul>
      {me.role === 'grif' && (
        <label className="check small">
          <input type="checkbox" checked={me.autoAmnesty} onChange={(e) => app.command({ type: 'setAutoAmnesty', on: e.target.checked })} />
          <span>{t('act.autoAmnesty')}</span>
        </label>
      )}
      {buttons.length > 0 && (
        <div className="button-row left">
          {buttons.map((b) => (
            <button key={b.key} type="button" className="btn btn-secondary" disabled={b.disabled} onClick={b.run}>
              {t(b.key)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function GhostControls({ view, me }: { view: GameView; me: SelfView }) {
  const t = useT();
  const app = useController();
  const ctx = useCtx();
  const [text, setText] = useState('');
  const voices = view.messages.filter((m) => m.kind === 'ghost').slice(-30);
  return (
    <div className="ghost">
      <p className="small">{t('me.dead')}</p>
      {me.haunt && (
        <button type="button" className="btn btn-secondary" onClick={() => app.command({ type: 'unhaunt' })}>
          {t('act.unhaunt')}: {t(`loc.${me.haunt}`)}
        </button>
      )}
      <h3 className="sub">{t('log.ghost')}</h3>
      <ul className="chat-list">
        {voices.map((m) => (
          <li key={m.id} className="chat-line">
            <b>{ctx.name(m.fromId ?? '')}:</b> {m.text}
          </li>
        ))}
      </ul>
      <form
        className="chat-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          app.command({ type: 'ghostChat', text: text.trim() });
          setText('');
        }}
      >
        <input className="input" value={text} maxLength={CHAT_MAX} onChange={(e) => setText(e.target.value)} />
        <button type="submit" className="btn btn-secondary" disabled={!text.trim()}>
          {t('here.send')}
        </button>
      </form>
    </div>
  );
}
