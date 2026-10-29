import { TIMER_PRESETS, type PublicParticipant, type TimerPreset } from '@plague/protocol';
import { useState } from 'react';
import { copyText, inviteLink } from '../clipboard';
import { useApp, useController, useT } from '../hooks';

export function Lobby() {
  const t = useT();
  const app = useController();
  const room = useApp((s) => s.room);
  const joined = useApp((s) => s.joined);
  const [copied, setCopied] = useState(false);
  if (!room || !joined) return null;

  const isHost = room.hostId === joined.selfId;
  const players = room.participants.filter((p) => p.kind === 'player');
  const watchers = room.participants.filter((p) => p.kind === 'spectator');
  const connectedPlayers = players.filter((p) => p.connected).length;
  const link = inviteLink(room.code);
  const enough = connectedPlayers >= room.minPlayers;

  const row = (p: PublicParticipant) => (
    <li key={p.id} className={`who${p.connected ? '' : ' who-off'}`}>
      <span className="who-name">
        {p.isHost && <span className="crown" title={t('lobby.host')}>♛</span>}
        {p.nickname}
        {p.id === joined.selfId && <span className="tag tag-you">{t('lobby.you')}</span>}
      </span>
      <span className="who-tags">
        {!p.connected && <span className="tag tag-off">{t('seat.offline')}</span>}
        {isHost && p.id !== joined.selfId && (
          <button type="button" className="btn btn-mini" onClick={() => app.kick(p.id)}>
            {t('lobby.kick')}
          </button>
        )}
      </span>
    </li>
  );

  return (
    <main className="lobby">
      <section className="sheet">
        <h2 className="sheet-title">{t('lobby.invite')}</h2>
        <div className="code-box">
          <span className="code-big" aria-label={t('home.code')}>{room.code}</span>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={async () => {
              setCopied(await copyText(link));
              setTimeout(() => setCopied(false), 1800);
            }}
          >
            {copied ? t('lobby.copied') : t('lobby.copyLink')}
          </button>
        </div>
        <p className="muted small">{t('lobby.shareHint', { min: room.minPlayers, max: room.maxPlayers })}</p>
      </section>

      <section className="sheet">
        <h2 className="sheet-title">{t('lobby.players', { count: players.length })}</h2>
        <ul className="who-list">{players.map(row)}</ul>
        {watchers.length > 0 && (
          <>
            <h3 className="sheet-sub">{t('lobby.spectators', { count: watchers.length })}</h3>
            <ul className="who-list">{watchers.map(row)}</ul>
          </>
        )}
      </section>

      <section className="sheet">
        <h2 className="sheet-title">{t('lobby.settings')}</h2>
        <div className="field">
          <span className="field-label">{t('lobby.timers')}</span>
          <div className="seg seg-wide" role="group" aria-label={t('lobby.timers')}>
            {TIMER_PRESETS.map((preset: TimerPreset) => (
              <button
                key={preset}
                type="button"
                disabled={!isHost}
                className={`seg-btn${room.settings.timerPreset === preset ? ' on' : ''}`}
                aria-pressed={room.settings.timerPreset === preset}
                onClick={() => app.updateSettings({ timerPreset: preset })}
              >
                {t(`preset.${preset}`)}
              </button>
            ))}
          </div>
          <span className="field-hint">{t(`preset.${room.settings.timerPreset}.hint`)}</span>
        </div>
        <label className="check">
          <input
            type="checkbox"
            disabled={!isHost}
            checked={room.settings.allowSpectators}
            onChange={(e) => app.updateSettings({ allowSpectators: e.target.checked })}
          />
          <span>{t('lobby.allowSpectators')}</span>
        </label>
      </section>

      <div className="lobby-actions">
        {isHost ? (
          <>
            <button type="button" className="btn btn-primary btn-lg" disabled={!enough} onClick={() => app.startGame()}>
              {t('lobby.start')}
            </button>
            {!enough && <p className="muted small">{t('lobby.need', { min: room.minPlayers })}</p>}
          </>
        ) : (
          <p className="muted">{t('lobby.waitHost')}</p>
        )}
      </div>
    </main>
  );
}
