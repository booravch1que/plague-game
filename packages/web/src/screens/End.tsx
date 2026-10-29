import type { GameView } from '@plague/engine';
import { nameIn } from '../controller';
import { useApp, useController, useT } from '../hooks';

/** Outcome, everyone's role and fate, and rematch controls. */
export function End({ view }: { view: GameView }) {
  const t = useT();
  const app = useController();
  const room = useApp((s) => s.room);
  const joined = useApp((s) => s.joined);
  const result = view.result;
  if (!result || !room || !joined) return null;

  const mine = result.players.find((p) => p.id === joined.selfId);
  const me = room.participants.find((p) => p.id === joined.selfId);
  const isHost = room.hostId === joined.selfId;
  const ready = room.participants.filter((p) => p.ready);
  const everyone = room.participants.filter((p) => p.kind === 'player' && p.connected);

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="end-title">
      <div className={`end sheet end-${result.winner}`}>
        <p className="end-mark" aria-hidden="true">{result.winner === 'town' ? '⚕' : '☠'}</p>
        <h2 id="end-title" className="end-title">{result.winner === 'town' ? t('end.town') : t('end.plague')}</h2>
        {mine && <p className={mine.won ? 'good' : 'warn'}>{mine.won ? t('end.youWon') : t('end.youLost')}</p>}
        <ul className="standings">
          {result.players.map((p) => (
            <li key={p.id} className={`standing${p.won ? ' winner' : ''}`}>
              <span className="standing-name">{nameIn(room, p.id)}</span>
              <span className="small">{t(`role.${p.role}`)}</span>
              <span className="small muted">{t(`end.status.${p.status}`)}</span>
              <span className={`tag ${p.won ? 'tag-pass' : 'tag-out'}`}>{p.won ? t('end.won') : t('end.lost')}</span>
            </li>
          ))}
        </ul>
        <div className="button-row">
          <button type="button" className="btn btn-primary btn-lg" disabled={me?.ready} onClick={() => app.playAgain()}>
            {me?.ready ? t('end.waiting') : t('end.playAgain')}
          </button>
          {isHost && ready.length >= room.minPlayers && ready.length < everyone.length && (
            <button type="button" className="btn btn-secondary" onClick={() => app.startGame()}>
              {t('end.startNow', { count: ready.length })}
            </button>
          )}
          <button type="button" className="btn btn-ghost" onClick={() => app.leaveRoom()}>
            {t('end.leave')}
          </button>
        </div>
        <p className="muted small">{t('end.ready', { ready: ready.length, total: everyone.length })}</p>
      </div>
    </div>
  );
}
