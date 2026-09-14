'use client';
// CLIENT komponent uchun `t`. Provider (I18nProvider) layoutda joriy `lang`ni beradi.
// Client komponentda: `const t = useT();` soʻng `t('Oʻzbekcha matn')`.
import React, { createContext, useContext, useMemo } from 'react';
import { makeT, normalizeLang, type Lang, type TFn } from './core';

const LangCtx = createContext<Lang>('uz');

export function I18nProvider({ lang, children }: { lang: string; children: React.ReactNode }) {
  const value = normalizeLang(lang);
  return <LangCtx.Provider value={value}>{children}</LangCtx.Provider>;
}

export function useLang(): Lang {
  return useContext(LangCtx);
}

export function useT(): TFn {
  const lang = useContext(LangCtx);
  return useMemo(() => makeT(lang), [lang]);
}
