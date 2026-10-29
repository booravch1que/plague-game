import { SERUM_GOAL, type GameView, type Message, type SelfView } from '@plague/engine';
import { CHAT_MAX } from '@plague/protocol';
import { useEffect, useRef, useState } from 'react';
import { useApp, useController, useT } from '../hooks';
import { describe } from '../logic/describe';
import { useCtx, useNow } from './Chrome';
import type { Open } from './Dialogs';
import { Offers } from './Offers';

/** The current location: who is here, what can be done, the dice and the talk. */
export function HerePanel({ view, open }: { view: GameView; open: Open }) {
  const t = useT();
  const me = view.you;
  const here = view.here;

  if (view.phase === 'summary') return <SummaryPanel view={view} />;
  if (!me || !here) {
    return (
      <div className="panel here">
        <p className="muted">{me?.status === 'dead' ? t('me.dead') : me?.status === 'escaped' ? t('me.escaped') : t('here.summary')}</p>
      </div>
    );
  }
  const ghost = me.status === 'dead';
  return (
    <div className="panel here">
      <h2 className="panel-title">{t(`loc.${here.location}`)}</h2>
      {ghost && <p className="muted small">{t('here.ghostView')}</p>}
      <People view={view} me={me} open={open} />
      <Offers view={view} />
      {!ghost && <PlaceActions view={view} me={me} />}
      <Dice view={view} />
      <Chat view={view} ghost={ghost} />
    </div>
  );
}

function People({ view, me, open }: { view: GameView; me: SelfView; open: Open }) {
  const t = useT();
  const app = useController();
  const ctx = useCtx();
  const here = view.here;
  if (!here) return null;
  const others = here.people.filter((p) => p.id !== me.id);
  const living = here.people.filter((p) => p.kind === 'alive').length;
  const canAct = me.status === 'alive' && (view.phase === 'day' || view.phase === 'night') && !view.paused && me.isolatedUntil === null;
  const night = view.phase === 'night';

  return (
    <div className="people">
      <h3 className="sub">{t('here.people')}</h3>
      {others.length === 0 && <p className="muted small">{t('here.alone')}</p>}
      <ul className="people-list">
        {others.map((p) => {
          const pub = view.players.find((x) => x.id === p.id);
          return (
            <li key={p.id} className={`person person-${p.kind}`}>
              <span className="person-name">
                {ctx.name(p.id)}
                {pub?.bachelor && <span className="tag tag-elite">{t('role.bachelor')}</span>}
                {p.kind === 'body' && <span className="tag tag-out">{t('here.body')}</span>}
                {p.kind === 'ghost' && <span className="tag tag-plague">{t('here.ghost')}</span>}
                {me.huntTargetId === p.id && <span className="tag tag-target">🎯</span>}
              </span>
              {p.kind === 'alive' && canAct && (
                <span className="person-actions">
                  <button type="button" className="btn btn-mini" title={t('act.ask.hint')} onClick={() => app.command({ type: 'infoRequest', askerId: p.id })}>
                    {t('act.ask')}
                  </button>
                  <button type="button" className="btn btn-mini" onClick={() => open({ kind: 'trade', targetId: p.id })}>
                    {t('act.trade')}
                  </button>
                  {living === 2 && !(night && pub?.bachelor) && (me.actions > 0 || me.attackActions > 0) && (
                    <button type="button" className="btn btn-mini btn-danger" onClick={() => open({ kind: 'attack', targetId: p.id })}>
                      {t('act.attack')}
                    </button>
                  )}
                  {me.role === 'bachelor' && (
                    <>
                      <button type="button" className="btn btn-mini" onClick={() => app.command({ type: 'search', targetId: p.id })}>
                        {t('act.search')}
                      </button>
                      {me.ready['heal'] && (
                        <button type="button" className="btn btn-mini" onClick={() => app.command({ type: 'heal', targetId: p.id })}>
                          {t('act.heal')}
                        </button>
                      )}
                    </>
                  )}
                  {me.role === 'ripper' && living >= 3 && me.ready['bleed'] && (
                    <button type="button" className="btn btn-mini btn-danger" onClick={() => app.command({ type: 'bleed', targetId: p.id })}>
                      {t('act.bleed')}
                    </button>
                  )}
                  {me.role === 'ripper' && (
                    <button type="button" className="btn btn-mini" onClick={() => app.command({ type: 'buyTicket', sellerId: p.id })}>
                      {t('act.buyTicket', { price: me.ticketPrice })}
                    </button>
                  )}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {me.role === 'bachelor' && me.status === 'alive' && me.ready['heal'] && me.infection > 0 && canAct && (
        <button type="button" className="btn btn-mini" onClick={() => app.command({ type: 'heal', targetId: me.id })}>
          {t('act.heal')} ({t('you')})
        </button>
      )}
    </div>
  );
}

/** Buttons that depend on the place: shops, the serum, the well, the corpse, the train. */
function PlaceActions({ view, me }: { view: GameView; me: SelfView }) {
  const t = useT();
  const app = useController();
  const [hidden, setHidden] = useState(false);
  const here = view.here;
  if (!here || me.status !== 'alive' || me.isolatedUntil !== null) return null;
  if (view.phase !== 'day' && view.phase !== 'night') return null;
  const loc = here.location;
  const night = view.phase === 'night';
  const buttons: { key: string; label: string; run: () => void; tone?: string }[] = [];
  const add = (key: string, run: () => void, tone?: string, params?: Record<string, string | number>) =>
    buttons.push({ key, label: t(key, params), run, tone });

  if (!view.paused) {
    if (loc === 'townhall' && view.serum < SERUM_GOAL) {
      if (me.role === 'bachelor') {
        if (me.ready['serumRoll']) add('act.serumRoll', () => app.command({ type: 'serumRoll' }), 'primary');
        if (me.ready['megaphone']) add('act.megaphone', () => app.command({ type: 'megaphone' }));
      } else {
        add('act.serumHelp', () => app.command({ type: 'serumHelp' }));
      }
      if (me.role === 'haruspex' && me.ingredients >= 2 && me.ready['donate']) add('act.donate', () => app.command({ type: 'donateIngredients' }));
    }
    if (here.well) add('act.well', () => app.command({ type: 'well' }));
    if (here.rumors) add('act.rumor', () => app.command({ type: 'rumor' }));
    if (here.corpse) add('act.corpse', () => app.command({ type: 'corpse' }), 'primary');
    if (loc === 'cemetery' && me.role === 'haruspex' && night && me.ready['herbs']) add('act.herbs', () => app.command({ type: 'gatherHerbs' }));
    if (loc === 'station' && me.role === 'ripper' && (me.inv.ticket ?? 0) > 0) add('act.escape', () => app.command({ type: 'escape' }), 'primary');
    if (loc === 'factory' && me.role === 'grif' && me.working && me.ready['outlaw'] && !night) add('act.outlaw', () => app.command({ type: 'outlaw' }));
  }

  const shop = here.shop;
  const showShop = loc === 'market' || loc === 'blackmarket' || shop.length > 0;
  return (
    <div className="place-actions">
      {buttons.length > 0 && (
        <div className="button-row left">
          {buttons.map((b) => (
            <button key={b.key} type="button" className={`btn ${b.tone === 'primary' ? 'btn-primary' : 'btn-secondary'}`} onClick={b.run}>
              {b.label}
            </button>
          ))}
        </div>
      )}
      {showShop && (
        <div className="shop">
          <h3 className="sub">{t('here.shop')}</h3>
          {shop.length === 0 && <p className="muted small">{loc === 'market' && night ? t('here.closedNight') : t('here.noShop')}</p>}
          <ul className="shop-list">
            {shop.map((line) => (
              <li key={line.item} className="shop-line">
                <span>
                  {t(`item.${line.item}`)}
                  {line.amount > 1 && ` ×${line.amount}`} <span className="muted small">{t(`itemDesc.${line.item}`)}</span>
                </span>
                <button
                  type="button"
                  className="btn btn-mini"
                  disabled={me.gold < line.gold || (me.inv.coupon ?? 0) < line.coupons || view.paused}
                  onClick={() => app.command({ type: 'buy', item: line.item, hidden })}
                >
                  {line.coupons > 0 ? t('here.coupon', { n: line.coupons }) : `${line.gold} 🪙`}
                </button>
              </li>
            ))}
          </ul>
          {me.role === 'angel' && loc === 'market' && shop.length > 0 && (
            <label className="check small">
              <input type="checkbox" checked={hidden} disabled={!me.ready['offer']} onChange={(e) => setHidden(e.target.checked)} />
              <span>{t('ab.offer')}</span>
            </label>
          )}
          {here.buyback.length > 0 && (
            <>
              <h3 className="sub">{t('here.sellTitle')}</h3>
              <ul className="shop-list">
                {here.buyback.map((line) => (
                  <li key={line.item} className="shop-line">
                    <span>{t(`item.${line.item}`)} ×{me.inv[line.item] ?? 0}</span>
                    <button type="button" className="btn btn-mini" disabled={view.paused} onClick={() => app.command({ type: 'sell', item: line.item })}>
                      +{line.price} 🪙
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Rolls made here, visible for 20 seconds. */
function Dice({ view }: { view: GameView }) {
  const t = useT();
  const ctx = useCtx();
  const viewAt = useApp((s) => s.viewAt);
  const now = useNow(500);
  const dice = (view.here?.dice ?? []).filter((d) => viewAt + d.ttl > now);
  if (dice.length === 0) return null;
  return (
    <div className="dice">
      <h3 className="sub">🎲 {t('here.dice')}</h3>
      <ul>
        {dice.map((d) => (
          <li key={d.id} className="dice-line">
            {describe(d.key, d.params, ctx)}
            <span className="dice-ttl">{Math.ceil((viewAt + d.ttl - now) / 1000)}s</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ChatLine({ m }: { m: Message }) {
  const ctx = useCtx();
  if (m.kind === 'chat') {
    return (
      <li className="chat-line">
        <b>{ctx.name(m.fromId ?? '')}:</b> {m.text}
      </li>
    );
  }
  return <li className="chat-line chat-sys">{describe(m.key ?? '', m.params, ctx)}</li>;
}

const LOCAL_EVENTS = new Set(['msg.arrived', 'msg.left', 'msg.bought', 'msg.infoRequest', 'msg.someoneDied', 'msg.ghostArrived', 'msg.ghostLeft', 'msg.serumHelp', 'msg.donated', 'msg.trainLeft']);

export function Chat({ view, ghost, summary = false }: { view: GameView; ghost: boolean; summary?: boolean }) {
  const t = useT();
  const app = useController();
  const [text, setText] = useState('');
  const end = useRef<HTMLLIElement>(null);
  const location = summary ? 'square' : view.here?.location;
  const lines = view.messages
    .filter((m) => m.day === view.day && m.location === location && (m.kind === 'chat' || (m.key !== undefined && LOCAL_EVENTS.has(m.key))))
    .filter((m) => (summary ? m.to === 'all' : m.to !== 'all'))
    .slice(-60);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' });
  }, [lines.length]);
  const canTalk = !ghost && view.you?.status === 'alive';
  const send = () => {
    const clean = text.trim();
    if (!clean) return;
    app.command({ type: 'chat', text: clean });
    setText('');
  };
  return (
    <div className="chat">
      <h3 className="sub">{t('here.chat')}</h3>
      <ul className="chat-list">
        {lines.map((m) => (
          <ChatLine key={m.id} m={m} />
        ))}
        <li ref={end} aria-hidden="true" />
      </ul>
      {canTalk && (
        <form
          className="chat-form"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <input className="input" value={text} maxLength={CHAT_MAX} placeholder={t('here.chatPlaceholder')} onChange={(e) => setText(e.target.value)} />
          <button type="submit" className="btn btn-secondary" disabled={!text.trim()}>
            {t('here.send')}
          </button>
        </form>
      )}
    </div>
  );
}

function SummaryPanel({ view }: { view: GameView }) {
  const t = useT();
  const app = useController();
  const ctx = useCtx();
  const me = view.you;
  const news = view.messages.filter((m) => m.day === view.day && m.kind === 'sys' && (m.key === 'msg.summary' || m.key?.endsWith('.soon') || m.key?.startsWith('secret.')));
  return (
    <div className="panel here summary">
      <h2 className="panel-title">{t('loc.square')}</h2>
      <p className="muted">{t('here.summary')}</p>
      <ul className="news">
        {news.map((m) => (
          <li key={m.id} className={m.to === 'all' ? '' : 'private'}>
            {describe(m.key ?? '', m.params, ctx)}
          </li>
        ))}
      </ul>
      {me?.status === 'alive' && (
        <button type="button" className="btn btn-primary" disabled={me.isReady} onClick={() => app.command({ type: 'ready' })}>
          {me.isReady ? t('act.readyDone') : t('act.ready')}
        </button>
      )}
      <Chat view={view} ghost={me?.status !== 'alive'} summary />
    </div>
  );
}
