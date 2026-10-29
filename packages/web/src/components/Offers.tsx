import type { Bundle, GameView, ItemId } from '@plague/engine';
import { useController, useT } from '../hooks';
import type { TFn } from '../i18n';
import { useCtx } from './Chrome';

export function bundleText(bundle: Bundle, t: TFn): string {
  const parts: string[] = [];
  if (bundle.gold > 0) parts.push(`${bundle.gold} 🪙`);
  for (const [item, n] of Object.entries(bundle.items)) if (n) parts.push(`${t(`item.${item as ItemId}`)} ×${n}`);
  return parts.join(', ') || t('trade.nothing');
}

/** Open trade offers involving the viewer, incoming first. */
export function Offers({ view }: { view: GameView }) {
  const t = useT();
  const app = useController();
  const ctx = useCtx();
  const me = view.you;
  if (!me || view.offers.length === 0) return null;
  const sorted = [...view.offers].sort((a, b) => Number(a.fromId === me.id) - Number(b.fromId === me.id));
  return (
    <ul className="offers">
      {sorted.map((o) => {
        const incoming = o.toId === me.id;
        const other = ctx.name(incoming ? o.fromId : o.toId);
        const title =
          o.kind === 'ticket' && incoming ? t('trade.ticket', { name: other }) : incoming ? t('trade.incoming', { name: other }) : t('trade.outgoing', { name: other });
        return (
          <li key={o.id} className={`offer${incoming ? ' incoming' : ''}`}>
            <p className="offer-title">{title}</p>
            <p className="small">
              <b>{t('trade.give')}:</b> {bundleText(incoming ? o.want : o.give, t)}
              <br />
              <b>{t('trade.want')}:</b> {bundleText(incoming ? o.give : o.want, t)}
            </p>
            <div className="button-row left">
              {incoming && (
                <button type="button" className="btn btn-mini btn-primary-mini" onClick={() => app.command({ type: 'offerReply', offerId: o.id, accept: true })}>
                  {t('trade.accept')}
                </button>
              )}
              <button type="button" className="btn btn-mini" onClick={() => app.command({ type: 'offerReply', offerId: o.id, accept: false })}>
                {incoming ? t('trade.decline') : t('trade.withdraw')}
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
