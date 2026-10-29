import { en } from './en';
import { ru } from './ru';

export type Lang = 'en' | 'ru';
export const LANGS: readonly Lang[] = ['en', 'ru'];
export type Params = Record<string, string | number>;
export type TFn = (key: string, params?: Params) => string;
export type Dict = Record<string, string>;

export const DICTIONARIES: Record<Lang, Dict> = { en, ru };

/**
 * Builds a translate function. Keys are flat strings. When `count` is passed, the
 * plural form is picked with the language's own rules (Intl.PluralRules), looking for
 * `key_one`, `key_few`, `key_many`, `key_other`. Russian needs all four.
 * Missing keys fall back to English, then to the key itself.
 */
export function makeT(lang: Lang, dictionaries: Record<Lang, Dict> = DICTIONARIES): TFn {
  const rules = new Intl.PluralRules(lang);
  const lookup = (dict: Dict, key: string, params: Params): string | undefined => {
    if (typeof params['count'] === 'number') {
      return dict[`${key}_${rules.select(params['count'])}`] ?? dict[`${key}_other`] ?? dict[key];
    }
    return dict[key];
  };
  return (key, params = {}) => {
    const template = lookup(dictionaries[lang], key, params) ?? lookup(dictionaries.en, key, params) ?? key;
    return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole));
  };
}

export function detectLang(saved: string | null | undefined, browser: string | undefined): Lang {
  if (saved === 'en' || saved === 'ru') return saved;
  return browser?.toLowerCase().startsWith('ru') ? 'ru' : 'en';
}
