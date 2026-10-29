import { useState } from 'react';
import { CourtBanner, DialogHost, Interrupts, type DialogSpec } from '../components/Dialogs';
import { HerePanel } from '../components/Here';
import { LogPanel } from '../components/Log';
import { MapPanel } from '../components/Map';
import { MePanel } from '../components/Me';
import { StatusBar } from '../components/Status';
import { useApp, useT } from '../hooks';
import { End } from './End';

type Tab = 'map' | 'here' | 'me' | 'log';
const TABS: Tab[] = ['map', 'here', 'me', 'log'];

/**
 * The playing screen. On wide screens all four panels sit side by side; on a
 * phone one panel shows at a time with tabs at the bottom.
 */
export function Game() {
  const t = useT();
  const view = useApp((s) => s.view);
  const [tab, setTab] = useState<Tab>('here');
  const [dialog, setDialog] = useState<DialogSpec | null>(null);
  if (!view) return <main className="loading">{t('loading')}</main>;

  return (
    <main className={`game phase-${view.phase}${view.paused ? ' paused' : ''}`}>
      <StatusBar view={view} />
      <CourtBanner view={view} />
      <Interrupts view={view} />
      <div className={`board tab-${tab}`}>
        <section className="col col-map">
          <MapPanel view={view} onMoved={() => setTab('here')} />
        </section>
        <section className="col col-here">
          <HerePanel view={view} open={setDialog} />
        </section>
        <section className="col col-me">
          <MePanel view={view} open={setDialog} />
        </section>
        <section className="col col-log">
          <LogPanel view={view} />
        </section>
      </div>
      <nav className="tabs" aria-label="tabs">
        {TABS.map((key) => (
          <button key={key} type="button" className={`tab${tab === key ? ' on' : ''}`} aria-pressed={tab === key} onClick={() => setTab(key)}>
            {t(`tab.${key}`)}
          </button>
        ))}
      </nav>
      <DialogHost view={view} spec={dialog} close={() => setDialog(null)} />
      {view.phase === 'over' && <End view={view} />}
    </main>
  );
}
