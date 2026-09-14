// SERVER komponent/route uchun `t`. `lang` cookie'ni oʻqiydi (LanguageSwitcher qoʻyadi).
// Server komponentda: `const t = getT();` soʻng `t('Oʻzbekcha matn')`.
import { cookies } from 'next/headers';
import { makeT, normalizeLang, type Lang, type TFn } from './core';

export function getLang(): Lang {
  return normalizeLang(cookies().get('lang')?.value);
}

export function getT(): TFn {
  return makeT(getLang());
}
