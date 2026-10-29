import { NICKNAME_MAX, NICKNAME_MIN, normalizeNickname, normalizeRoomCode } from '@plague/protocol';
import { useState } from 'react';
import { useApp, useController, useT } from '../hooks';

const HOW = ['time', 'move', 'see', 'plague', 'serum', 'win'] as const;

export function Home() {
  const t = useT();
  const app = useController();
  const savedNick = useApp((s) => s.nickname);
  const invite = useApp((s) => s.inviteCode);
  const conn = useApp((s) => s.conn);
  const rejoining = useApp((s) => s.rejoining);
  const [nick, setNick] = useState(savedNick);
  const [code, setCode] = useState(invite);

  const nickOk = normalizeNickname(nick).ok;
  const codeOk = normalizeRoomCode(code).ok;
  const online = conn === 'online' && !rejoining;

  return (
    <main className="home">
      <section className="hero">
        <h1 className="hero-title">{t('app.title')}</h1>
        <p className="hero-tag">{t('home.tagline')}</p>
      </section>

      <section className="sheet">
        <label className="field">
          <span className="field-label">{t('home.nickname')}</span>
          <input
            className="input"
            value={nick}
            maxLength={NICKNAME_MAX}
            autoComplete="nickname"
            placeholder={t('home.nicknamePlaceholder')}
            onChange={(e) => setNick(e.target.value)}
          />
          <span className="field-hint">{t('home.nicknameHint', { min: NICKNAME_MIN, max: NICKNAME_MAX })}</span>
        </label>

        {invite && <p className="invite-note">{t('home.invited', { code: invite })}</p>}

        <div className="home-actions">
          {!invite && (
            <button type="button" className="btn btn-primary btn-lg" disabled={!nickOk || !online} onClick={() => app.createRoom(nick)}>
              {t('home.create')}
            </button>
          )}
          {!invite && <div className="divider"><span>{t('home.or')}</span></div>}
          <div className="join-row">
            <input
              className="input input-code"
              value={code}
              maxLength={5}
              spellCheck={false}
              autoCapitalize="characters"
              placeholder="ABCDE"
              aria-label={t('home.code')}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
            <button
              type="button"
              className={`btn btn-lg ${invite ? 'btn-primary' : 'btn-secondary'}`}
              disabled={!nickOk || !codeOk || !online}
              onClick={() => app.joinRoom(code, nick)}
            >
              {t('home.join')}
            </button>
          </div>
        </div>
        {!online && <p className="muted small">{rejoining ? t('home.rejoining') : t('conn.offline')}</p>}
      </section>

      <details className="sheet how">
        <summary>{t('home.howTo')}</summary>
        <ul>
          {HOW.map((key) => (
            <li key={key}>{t(`how.${key}`)}</li>
          ))}
        </ul>
      </details>
    </main>
  );
}
