import {
  BANDIT_ABILITIES,
  CONSUMABLES,
  LOCATIONS,
  UNTRADEABLE,
  type Bundle,
  type CombatMod,
  type GameView,
  type ItemId,
  type LocationId,
  type LootKind,
  type SelfView,
} from '@plague/engine';
import { CHAT_MAX } from '@plague/protocol';
import { useState } from 'react';
import { useController, useT } from '../hooks';
import { Modal, useCtx, useSecondsLeft } from './Chrome';

export type DialogSpec =
  | { kind: 'attack'; targetId: string }
  | { kind: 'trade'; targetId: string }
  | { kind: 'court' }
  | { kind: 'suspect' }
  | { kind: 'note' }
  | { kind: 'stash' };

export type Open = (spec: DialogSpec) => void;

/** Renders the dialog the player opened, if any. */
export function DialogHost({ view, spec, close }: { view: GameView; spec: DialogSpec | null; close: () => void }) {
  const me = view.you;
  if (!spec || !me) return null;
  switch (spec.kind) {
    case 'attack':
      return <AttackDialog me={me} targetId={spec.targetId} close={close} />;
    case 'trade':
      return <TradeDialog me={me} targetId={spec.targetId} close={close} />;
    case 'court':
    case 'suspect':
      return <PickPlayerDialog view={view} kind={spec.kind} close={close} />;
    case 'note':
      return <NoteDialog close={close} />;
    case 'stash':
      return <StashDialog me={me} close={close} />;
  }
}

/** Combat boosts this role has ready. */
function modsFor(me: SelfView): CombatMod[] {
  const mods: CombatMod[] = [];
  if (me.role === 'grif' && me.ready['sneak']) mods.push('sneak');
  if (me.role === 'citizen' && me.ready['booze']) mods.push('booze');
  if (me.role === 'citizen' && me.ready['allIn']) mods.push('allIn');
  return mods;
}

function ModPicker({ me, value, onChange }: { me: SelfView; value: CombatMod[]; onChange: (mods: CombatMod[]) => void }) {
  const t = useT();
  const options = modsFor(me);
  if (options.length === 0) return null;
  return (
    <fieldset className="field">
      <legend className="field-label">{t('attack.mods')}</legend>
      {options.map((mod) => (
        <label key={mod} className="check">
          <input
            type="checkbox"
            checked={value.includes(mod)}
            onChange={(e) => onChange(e.target.checked ? [...value, mod] : value.filter((m) => m !== mod))}
          />
          <span>{t(`mod.${mod}`)}</span>
        </label>
      ))}
    </fieldset>
  );
}

function AttackDialog({ me, targetId, close }: { me: SelfView; targetId: string; close: () => void }) {
  const t = useT();
  const app = useController();
  const ctx = useCtx();
  const [loot, setLoot] = useState<LootKind>('gold');
  const [mods, setMods] = useState<CombatMod[]>([]);
  return (
    <Modal title={t('attack.title', { name: ctx.name(targetId) })} onClose={close}>
      <div className="field">
        <span className="field-label">{t('attack.loot')}</span>
        <div className="seg seg-wide">
          {(['gold', 'food', 'water'] as const).map((k) => (
            <button key={k} type="button" className={`seg-btn${loot === k ? ' on' : ''}`} onClick={() => setLoot(k)}>
              {t(`loot.${k}`)}
            </button>
          ))}
        </div>
      </div>
      <ModPicker me={me} value={mods} onChange={setMods} />
      <div className="button-row">
        <button
          type="button"
          className="btn btn-danger"
          onClick={() => {
            app.command({ type: 'attack', targetId, loot, mods });
            close();
          }}
        >
          {t('attack.go')}
        </button>
        <button type="button" className="btn btn-ghost" onClick={close}>
          {t('act.cancel')}
        </button>
      </div>
    </Modal>
  );
}

function BundleEditor({ items, max, value, onChange, maxGold }: {
  items: ItemId[];
  max: (item: ItemId) => number;
  value: Bundle;
  onChange: (b: Bundle) => void;
  maxGold: number;
}) {
  const t = useT();
  const set = (item: ItemId, n: number) => onChange({ ...value, items: { ...value.items, [item]: Math.max(0, Math.min(max(item), n)) } });
  return (
    <div className="bundle">
      <label className="bundle-line">
        <span>🪙 {t('trade.gold')}</span>
        <input
          className="input input-num"
          type="number"
          min={0}
          max={maxGold}
          value={value.gold}
          onChange={(e) => onChange({ ...value, gold: Math.max(0, Math.min(maxGold, Number(e.target.value) || 0)) })}
        />
      </label>
      {items.map((item) => (
        <div key={item} className="bundle-line">
          <span>{t(`item.${item}`)}</span>
          <span className="stepper">
            <button type="button" className="btn btn-mini" onClick={() => set(item, (value.items[item] ?? 0) - 1)}>−</button>
            <span className="stepper-n">{value.items[item] ?? 0}</span>
            <button type="button" className="btn btn-mini" onClick={() => set(item, (value.items[item] ?? 0) + 1)}>+</button>
          </span>
        </div>
      ))}
    </div>
  );
}

const WANTABLE: ItemId[] = ['rusk', 'canned', 'water', 'rationSmall', 'rationBig', 'bandage', 'immunizer', 'serum', 'folkRemedy', 'strongPotion', 'coupon', 'ingredient', 'trophy'];

function clean(bundle: Bundle): Bundle {
  const items: Bundle['items'] = {};
  for (const [k, n] of Object.entries(bundle.items)) if (n) items[k as ItemId] = n;
  return { gold: bundle.gold, items };
}

function TradeDialog({ me, targetId, close }: { me: SelfView; targetId: string; close: () => void }) {
  const t = useT();
  const app = useController();
  const ctx = useCtx();
  const [give, setGive] = useState<Bundle>({ gold: 0, items: {} });
  const [want, setWant] = useState<Bundle>({ gold: 0, items: {} });
  const mine = (Object.keys(me.inv) as ItemId[]).filter((i) => !UNTRADEABLE.includes(i));
  const empty = (b: Bundle) => b.gold === 0 && Object.values(b.items).every((n) => !n);
  return (
    <Modal title={t('trade.title', { name: ctx.name(targetId) })} onClose={close}>
      <div className="trade-cols">
        <div>
          <h3 className="sub">{t('trade.give')}</h3>
          <BundleEditor items={mine} max={(i) => me.inv[i] ?? 0} value={give} onChange={setGive} maxGold={me.gold} />
        </div>
        <div>
          <h3 className="sub">{t('trade.want')}</h3>
          <BundleEditor items={WANTABLE} max={() => 9} value={want} onChange={setWant} maxGold={99} />
        </div>
      </div>
      <p className="muted small">{t('trade.hint')}</p>
      <div className="button-row">
        <button
          type="button"
          className="btn btn-primary"
          disabled={empty(give) && empty(want)}
          onClick={() => {
            app.command({ type: 'offer', targetId, give: clean(give), want: clean(want) });
            close();
          }}
        >
          {t('trade.send')}
        </button>
        <button type="button" className="btn btn-ghost" onClick={close}>
          {t('act.cancel')}
        </button>
      </div>
    </Modal>
  );
}

function PickPlayerDialog({ view, kind, close }: { view: GameView; kind: 'court' | 'suspect'; close: () => void }) {
  const t = useT();
  const app = useController();
  const ctx = useCtx();
  const candidates = view.players.filter((p) => p.status === 'alive' && p.id !== view.you?.id && !p.isolated);
  return (
    <Modal title={kind === 'court' ? t('court.pick') : t('act.suspect')} onClose={close}>
      <ul className="pick-list">
        {candidates.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              className="btn btn-secondary btn-wide"
              onClick={() => {
                app.command(kind === 'court' ? { type: 'courtStart', accusedId: p.id } : { type: 'suspect', targetId: p.id });
                close();
              }}
            >
              {ctx.name(p.id)}
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="btn btn-ghost" onClick={close}>
        {t('act.cancel')}
      </button>
    </Modal>
  );
}

function NoteDialog({ close }: { close: () => void }) {
  const t = useT();
  const app = useController();
  const [text, setText] = useState('');
  return (
    <Modal title={t('act.note')} onClose={close}>
      <textarea className="input textarea" maxLength={CHAT_MAX} value={text} placeholder={t('act.notePlaceholder')} onChange={(e) => setText(e.target.value)} />
      <div className="button-row">
        <button
          type="button"
          className="btn btn-primary"
          disabled={!text.trim()}
          onClick={() => {
            app.command({ type: 'note', text: text.trim() });
            close();
          }}
        >
          {t('act.confirm')}
        </button>
        <button type="button" className="btn btn-ghost" onClick={close}>
          {t('act.cancel')}
        </button>
      </div>
    </Modal>
  );
}

function StashDialog({ me, close }: { me: SelfView; close: () => void }) {
  const t = useT();
  const app = useController();
  const items = (Object.keys(me.inv) as ItemId[]).filter((i) => i !== 'ticket');
  return (
    <Modal title={t('act.stash')} onClose={close}>
      <div className="button-row left">
        {[1, 2, 3].map((n) => (
          <button
            key={n}
            type="button"
            className="btn btn-secondary"
            disabled={me.gold < n}
            onClick={() => {
              app.command({ type: 'stash', gold: n, item: null });
              close();
            }}
          >
            {n} 🪙
          </button>
        ))}
        {items.map((item) => (
          <button
            key={item}
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              app.command({ type: 'stash', gold: 0, item });
              close();
            }}
          >
            {t(`item.${item}`)}
          </button>
        ))}
      </div>
      <button type="button" className="btn btn-ghost" onClick={close}>
        {t('act.cancel')}
      </button>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Things the server asks for
// ---------------------------------------------------------------------------

function LocationPicker({ exclude, closed, onPick }: { exclude: LocationId; closed: LocationId[]; onPick: (l: LocationId) => void }) {
  const t = useT();
  return (
    <div className="button-row left">
      {LOCATIONS.filter((l) => l !== exclude && l !== 'isolator' && !closed.includes(l)).map((l) => (
        <button key={l} type="button" className="btn btn-mini" onClick={() => onPick(l)}>
          {t(`loc.${l}`)}
        </button>
      ))}
    </div>
  );
}

/** Attacks, searches, stealth windows and the bachelor's choices. Shown over everything. */
export function Interrupts({ view }: { view: GameView }) {
  const t = useT();
  const app = useController();
  const ctx = useCtx();
  const me = view.you;
  const attackLeft = useSecondsLeft(view.attack?.deadline ?? null);
  const searchLeft = useSecondsLeft(view.search?.deadline ?? null);
  const stealthLeft = useSecondsLeft(view.stealthDeadline);
  const [mods, setMods] = useState<CombatMod[]>([]);
  const [fleeing, setFleeing] = useState(false);
  const [option, setOption] = useState(1);
  const [picked, setPicked] = useState<string[]>([]);
  if (!me) return null;

  const attack = view.attack;
  if (attack && attack.role === 'defender') {
    const night = view.phase === 'night';
    const flee = me.role === 'haruspex' && me.ready['fastLegs'] ? 'fastLegs' : me.role === 'angel' && night && me.ready['nightCover'] ? 'nightCover' : null;
    return (
      <Modal title={`${t('defend.title', { name: ctx.name(attack.otherId) })} · ${attackLeft ?? 0}s`}>
        <ModPicker me={me} value={mods} onChange={setMods} />
        {fleeing && flee ? (
          <>
            <p className="field-label">{t('defend.where')}</p>
            <LocationPicker
              exclude={me.location}
              closed={view.closed}
              onPick={(to) => {
                app.command({ type: 'defend', attackId: attack.id, mods: [], flee: { ability: flee, to } });
                setFleeing(false);
              }}
            />
          </>
        ) : (
          <div className="button-row">
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => {
                app.command({ type: 'defend', attackId: attack.id, mods });
                setMods([]);
              }}
            >
              {t('defend.fight')}
            </button>
            {flee && (
              <button type="button" className="btn btn-secondary" onClick={() => setFleeing(true)}>
                {t('defend.flee')}: {t(`defend.${flee}`)}
              </button>
            )}
          </div>
        )}
      </Modal>
    );
  }

  const search = view.search;
  if (search && search.role === 'target') {
    const owned = CONSUMABLES.filter((i) => (me.inv[i] ?? 0) > 0);
    return (
      <Modal title={`${t('search.title', { name: ctx.name(search.otherId) })} · ${searchLeft ?? 0}s`}>
        <p>{t('search.pick')}</p>
        <div className="button-row left">
          {owned.map((item) => (
            <button key={item} type="button" className="btn btn-secondary" onClick={() => app.command({ type: 'showItem', searchId: search.id, item })}>
              {t(`item.${item}`)}
            </button>
          ))}
          {owned.length === 0 && (
            <button type="button" className="btn btn-secondary" onClick={() => app.command({ type: 'showItem', searchId: search.id, item: null })}>
              {t('search.none')}
            </button>
          )}
        </div>
      </Modal>
    );
  }

  const prompt = view.prompts[0];
  if (prompt) {
    const candidates = view.players.filter((p) => p.status === 'alive');
    const toggle = (id: string) =>
      setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id].slice(-prompt.pick)));
    const submit = (ids: string[]) => {
      app.command({ type: 'choose', promptId: prompt.id, ids, option: prompt.kind === 'intel' ? option : undefined });
      setPicked([]);
    };
    return (
      <Modal title={t(`prompt.${prompt.kind}`)}>
        {prompt.kind === 'intel' && (
          <div className="seg seg-wide">
            {BANDIT_ABILITIES.map((_a, i) => (
              <button key={i} type="button" className={`seg-btn${option === i + 1 ? ' on' : ''}`} onClick={() => setOption(i + 1)}>
                {t('prompt.abilityN', { n: i + 1 })}
              </button>
            ))}
          </div>
        )}
        <ul className="pick-list">
          {candidates.map((p) => (
            <li key={p.id}>
              <button type="button" className={`btn btn-wide ${picked.includes(p.id) ? 'btn-primary' : 'btn-secondary'}`} onClick={() => toggle(p.id)}>
                {ctx.name(p.id)}
              </button>
            </li>
          ))}
        </ul>
        <div className="button-row">
          <button type="button" className="btn btn-primary" disabled={picked.length === 0} onClick={() => submit(picked)}>
            {t('act.confirm')}
          </button>
          {prompt.kind === 'forcedWater' && (
            <button type="button" className="btn btn-ghost" onClick={() => submit([])}>
              {t('prompt.keep')}
            </button>
          )}
        </div>
      </Modal>
    );
  }

  if (view.stealthDeadline !== null && stealthLeft !== null && stealthLeft > 0) {
    return (
      <div className="banner banner-stealth">
        <p className="field-label">
          {t('stealth.title')} · {stealthLeft}s
        </p>
        <LocationPicker exclude={me.location} closed={view.closed} onPick={(to) => app.command({ type: 'stealth', to })} />
      </div>
    );
  }
  if (attack && attack.role === 'attacker') {
    return <div className="banner">{t('attack.waiting', { name: ctx.name(attack.otherId) })} {attackLeft ?? 0}s</div>;
  }
  if (search && search.role === 'searcher') {
    return <div className="banner">{t('search.waiting', { name: ctx.name(search.otherId) })} {searchLeft ?? 0}s</div>;
  }
  return null;
}

/** The trial banner: who is accused, the count, and the vote for those in the town hall. */
export function CourtBanner({ view }: { view: GameView }) {
  const t = useT();
  const app = useController();
  const ctx = useCtx();
  const court = view.court;
  const left = useSecondsLeft(court?.deadline ?? null);
  if (!court) return null;
  const me = view.you;
  const inHall = me?.status === 'alive' && me.location === 'townhall' && me.isolatedUntil === null;
  return (
    <div className="banner banner-court" role="status">
      <p className="court-title">
        ⚖ {t('court.title', { name: ctx.name(court.accusedId) })} · {left ?? 0}s
      </p>
      <p className="small muted">{t('court.hint')}</p>
      <p className="small">{t('court.votes', { guilty: court.guilty, innocent: court.innocent })}</p>
      {court.myVote !== null && <p className="small">{t('court.yourVote', { vote: court.myVote ? t('court.guilty') : t('court.innocent') })}</p>}
      <div className="button-row left">
        {me?.status === 'alive' && me.location !== 'townhall' && me.isolatedUntil === null && (
          <button type="button" className="btn btn-mini" onClick={() => app.command({ type: 'move', to: 'townhall' })}>
            {t('court.goVote')}
          </button>
        )}
        {inHall && (
          <>
            <button type="button" className="btn btn-mini btn-danger" onClick={() => app.command({ type: 'courtVote', guilty: true })}>
              {t('court.guilty')}
            </button>
            <button type="button" className="btn btn-mini" onClick={() => app.command({ type: 'courtVote', guilty: false })}>
              {t('court.innocent')}
            </button>
          </>
        )}
        {me?.role === 'bachelor' && me.status === 'alive' && (
          <button type="button" className="btn btn-mini btn-ghost" onClick={() => app.command({ type: 'courtClose' })}>
            {t('court.close')}
          </button>
        )}
      </div>
    </div>
  );
}
