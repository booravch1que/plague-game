import { SERUM_GOAL, type GameView } from '@plague/engine';
import { useT } from '../hooks';
import { clock, useSecondsLeft } from './Chrome';

/** Phase, countdown, serum progress and the player's moves and actions. */
export function StatusBar({ view }: { view: GameView }) {
  const t = useT();
  const left = useSecondsLeft(view.deadline);
  const me = view.you;
  const title = view.paused ? t('phase.court') : t(`phase.${view.phase}`, { day: view.day });
  return (
    <div className={`status status-${view.paused ? 'court' : view.phase}`}>
      <div className="status-phase">
        <span className="status-icon" aria-hidden="true">{view.paused ? '⚖' : view.phase === 'night' ? '☾' : view.phase === 'summary' ? '☖' : '☀'}</span>
        <span className="status-title">{title}</span>
        {left !== null && <span className={`status-clock${left <= 15 ? ' urgent' : ''}`} role="timer" aria-label={t('timer.label')}>{clock(left)}</span>}
      </div>
      <div className="status-serum" title={t('stat.serum')}>
        <span className="small muted">{t('stat.serum')}</span>
        <div className="meter" aria-label={`${view.serum}/${SERUM_GOAL}`}>
          <div className="meter-fill serum" style={{ width: `${(view.serum / SERUM_GOAL) * 100}%` }} />
        </div>
        <span className="small">{view.serum}/{SERUM_GOAL}</span>
      </div>
      {me && me.status === 'alive' && (view.phase === 'day' || view.phase === 'night') && (
        <div className="status-budget">
          <span className="budget" title={t('stat.moves')}>👣 {me.moves}</span>
          <span className="budget" title={t('stat.actions')}>✋ {me.actions}</span>
          {me.attackActions > 0 && <span className="budget" title={t('stat.attack')}>🗡 {me.attackActions}</span>}
        </div>
      )}
    </div>
  );
}
