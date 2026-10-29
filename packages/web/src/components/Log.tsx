import type { GameView } from '@plague/engine';
import { useEffect, useRef } from 'react';
import { useT } from '../hooks';
import { describe } from '../logic/describe';
import { useCtx } from './Chrome';

/** Location chatter lives in the place panel; everything else — news, private notes — is here. */
const LOCAL_ONLY = new Set(['msg.arrived', 'msg.left']);

export function LogPanel({ view }: { view: GameView }) {
  const t = useT();
  const ctx = useCtx();
  const end = useRef<HTMLLIElement>(null);
  const lines = view.messages.filter((m) => m.kind !== 'chat' && m.kind !== 'ghost' && !(m.key && LOCAL_ONLY.has(m.key))).slice(-150);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' });
  }, [lines.length]);
  return (
    <div className="panel log">
      <h2 className="panel-title">{t('log.title')}</h2>
      {lines.length === 0 && <p className="muted small">{t('log.empty')}</p>}
      <ol className="log-list">
        {lines.map((m) => {
          const day = m.key === 'msg.dayStarts' || m.key === 'msg.nightStarts';
          const cls = day ? 'log-day' : m.to === 'all' ? 'log-public' : 'log-private';
          return (
            <li key={m.id} className={`log-line ${cls}`}>
              {m.kind === 'note' ? (
                <>
                  <b>✉ {t('log.note')}:</b> {m.text}
                </>
              ) : (
                describe(m.key ?? '', m.params, ctx)
              )}
            </li>
          );
        })}
        <li ref={end} aria-hidden="true" />
      </ol>
    </div>
  );
}
