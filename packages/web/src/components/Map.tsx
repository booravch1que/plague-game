import { LOCATIONS, type GameView, type LocationId } from '@plague/engine';
import { useController, useT } from '../hooks';

const ICON: Record<LocationId, string> = {
  square: '⛲',
  factory: '🏭',
  townhall: '🏛',
  market: '🛒',
  blackmarket: '🕯',
  cemetery: '✝',
  station: '🚂',
  isolator: '🔒',
};

/** The town: one button per location. Living players walk; the dead visit once a day. */
export function MapPanel({ view, onMoved }: { view: GameView; onMoved?: () => void }) {
  const t = useT();
  const app = useController();
  const me = view.you;
  const playing = view.phase === 'day' || view.phase === 'night';
  const alive = me?.status === 'alive';
  const dead = me?.status === 'dead';
  const here = dead ? me?.haunt : me?.location;

  return (
    <div className="panel map">
      <h2 className="panel-title">{t('map.title')}</h2>
      <ul className="map-grid">
        {LOCATIONS.map((loc) => {
          const closed = view.closed.includes(loc);
          const burning = view.fire === loc;
          const current = here === loc;
          let action: (() => void) | null = null;
          let label = '';
          if (alive && playing && !current && me && me.isolatedUntil === null) {
            if (view.paused) {
              if (loc === 'townhall') {
                action = () => app.command({ type: 'move', to: loc });
                label = t('map.goFree');
              }
            } else if (!closed && me.moves > 0) {
              action = () => app.command({ type: 'move', to: loc });
              label = t('map.go');
            }
          }
          if (dead && playing && me?.canHaunt && !current) {
            action = () => app.command({ type: 'haunt', to: loc });
            label = t('act.haunt');
          }
          return (
            <li key={loc}>
              <button
                type="button"
                className={`place place-${loc}${current ? ' here' : ''}${closed ? ' closed' : ''}${burning ? ' burning' : ''}`}
                disabled={!action}
                onClick={() => {
                  action?.();
                  onMoved?.();
                }}
              >
                <span className="place-icon" aria-hidden="true">{ICON[loc]}</span>
                <span className="place-name">{t(`loc.${loc}`)}</span>
                <span className="place-note">
                  {current ? t('map.here') : burning ? t('map.fire') : closed ? t('map.closed') : action ? label : ''}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
