import type { MsgParams } from '@plague/engine';
import type { TFn } from '../i18n';

export interface Ctx {
  t: TFn;
  name: (id: string) => string;
}

const list = (value: string | number): string[] => (value === '-' || value === '' ? [] : String(value).split(','));

/**
 * Turns the engine's message parameters into words. The engine sends ids and
 * keys only; the naming convention of the parameter says how to show it.
 */
export function formatParams(params: MsgParams, ctx: Ctx): Record<string, string | number> {
  const { t, name } = ctx;
  const out: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(params)) {
    if (key.endsWith('Id')) out[key] = name(String(value));
    else if (key === 'loc') out[key] = t(`loc.${value}`);
    else if (key === 'item') out[key] = value === '-' ? t('trade.nothing') : t(`item.${value}`);
    else if (key === 'items' || key === 'valuables') out[key] = list(value).map((i) => t(`item.${i}`)).join(', ') || '—';
    else if (key === 'role') out[key] = t(`role.${value}`);
    else if (key === 'event') out[key] = t(`event.${value}.name`);
    else if (key === 'events') out[key] = list(value).map((e) => t(`event.${e}.name`)).join(', ') || '—';
    else if (key === 'died' || key === 'escaped') out[key] = list(value).map(name).join(', ') || t('none');
    else if (key === 'ability') out[key] = t(`bandit.${value}`);
    else if (key === 'cause') out[key] = t(`cause.${value}`);
    else if (key === 'what') out[key] = describeLoot(String(value), t);
    else out[key] = value;
  }
  return out;
}

function describeLoot(what: string, t: TFn): string {
  if (what.startsWith('gold:')) return `${what.slice(5)} ${t('stat.gold').toLowerCase()}`;
  if (what.startsWith('item:')) return t(`item.${what.slice(5)}`);
  return t('trade.nothing');
}

export function describe(key: string, params: MsgParams | undefined, ctx: Ctx): string {
  return ctx.t(key, formatParams(params ?? {}, ctx));
}
