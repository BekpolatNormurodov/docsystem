// i18n yadrosi — SERVER va CLIENT'da ishlaydi (next/headers'ga bogʻliq emas). Kalit = manba (oʻzbek
// lotin) matni; `ru` lugʻatdan olinadi, `uz-cyrl` avtomatik transliteratsiya. Topilmasa — oʻzbekcha
// (manba) qaytadi, shuning uchun qamrov toʻliq boʻlmasa ham hech narsa buzilmaydi.
import { RU } from './ru';
import { toCyrl } from './translit';

export type Lang = 'uz' | 'uz-cyrl' | 'ru';
export const LANGS: Lang[] = ['uz', 'uz-cyrl', 'ru'];

export function normalizeLang(v?: string | null): Lang {
  return v === 'ru' || v === 'uz-cyrl' ? v : 'uz';
}

/** Bitta manba (oʻzbek lotin) matnini joriy tilга oʻgiradi. */
export function translate(uz: string, lang: Lang): string {
  if (uz == null) return uz;
  if (lang === 'ru') return RU[uz] ?? uz;      // ru topilmasa — oʻzbekcha (manba) qoladi
  if (lang === 'uz-cyrl') return toCyrl(uz);   // avtomatik kirill
  return uz;                                    // uz — oʻzgarmaydi
}

export type TFn = (uz: string) => string;
export const makeT = (lang: Lang): TFn => (uz) => translate(uz, lang);
