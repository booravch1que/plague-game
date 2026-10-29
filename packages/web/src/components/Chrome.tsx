import { useEffect, useState } from 'react';
import { copyText, inviteLink } from '../clipboard';
import { nameIn } from '../controller';
import { useApp, useController, useT } from '../hooks';
import { DICTIONARIES, LANGS } from '../i18n';
import type { Ctx } from '../logic/describe';

export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** Translation plus player names, for describing engine messages. */
export function useCtx(): Ctx {
  const t = useT();
  const room = useApp((s) => s.room);
  const selfId = useApp((s) => s.joined?.selfId);
  return { t, name: (id: string) => (id === selfId ? `${nameIn(room, id)} (${t('you')})` : nameIn(room, id)) };
}

/** Seconds left until a server deadline, ticking on this device. */
export function useSecondsLeft(serverDeadline: number | null): number | null {
  const app = useController();
  const now = useNow(250);
  if (serverDeadline === null) return null;
  return Math.max(0, Math.ceil((app.localTime(serverDeadline) - now) / 1000));
}

export function clock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Title, room code, language and leave. Shown on every screen. */
export function TopBar() {
  const t = useT();
  const app = useController();
  const lang = useApp((s) => s.lang);
  const joined = useApp((s) => s.joined);
  const [sure, setSure] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!sure) return;
    const id = setTimeout(() => setSure(false), 3000);
    return () => clearTimeout(id);
  }, [sure]);

  return (
    <header className="topbar">
      <div className="brand">
        <svg viewBox="0 0 64 64" className="brand-mark" aria-hidden="true" focusable="false">
          <path d="M32 8c-6 8-14 12-14 24a14 14 0 0 0 28 0C46 20 38 16 32 8z" />
        </svg>
        <span className="brand-name">{t('app.title')}</span>
      </div>
      <div className="topbar-right">
        {joined && (
          <button
            type="button"
            className="chip chip-code"
            title={t('lobby.copyLink')}
            onClick={async () => {
              setCopied(await copyText(inviteLink(joined.code)));
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? t('lobby.copied') : joined.code}
          </button>
        )}
        <div className="seg" role="group" aria-label={t('top.language')}>
          {LANGS.map((l) => (
            <button key={l} type="button" className={`seg-btn${lang === l ? ' on' : ''}`} onClick={() => app.setLang(l)} aria-pressed={lang === l}>
              {l.toUpperCase()}
            </button>
          ))}
        </div>
        {joined && (
          <button type="button" className={`chip chip-leave${sure ? ' sure' : ''}`} onClick={() => (sure ? app.leaveRoom() : setSure(true))}>
            {sure ? t('top.leaveSure') : t('top.leave')}
          </button>
        )}
      </div>
    </header>
  );
}

export function Toasts() {
  const t = useT();
  const app = useController();
  const lang = useApp((s) => s.lang);
  const toast = useApp((s) => s.toast);
  const conn = useApp((s) => s.conn);
  const closed = useApp((s) => s.closed);
  const known = toast && DICTIONARIES[lang][`err.${toast.code}`] !== undefined;
  return (
    <div className="toasts" aria-live="assertive">
      {conn === 'offline' && <div className="toast toast-warn">{t('conn.offline')}</div>}
      {closed && (
        <button type="button" className="toast toast-warn" onClick={() => app.dismissClosed()}>
          {t(`closed.${closed}`)}
        </button>
      )}
      {toast && (
        <button type="button" className="toast toast-error" onClick={() => app.dismissToast()}>
          {known ? t(`err.${toast.code}`) : toast.message}
        </button>
      )}
    </div>
  );
}

/** A modal sheet. Closes on the backdrop or Escape when `onClose` is given. */
export function Modal({ title, onClose, children }: { title: string; onClose?: () => void; children: React.ReactNode }) {
  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="sheet modal">
        <h2 className="sheet-title">{title}</h2>
        {children}
      </div>
    </div>
  );
}
