// Barcha boʻlim RU lugʻatlari shu yerda birlashadi. Bir kalit bir marta boʻlsin (boʻlimlar orasida
// takrorlanmasin) — takrorlansa keyingisi ustun keladi. Yangi boʻlim qoʻshilganda: importni va
// SECTIONS roʻyxatiga qoʻshing.
import { common } from './common';
import { app } from './app';
import { routes } from './routes';
import { gaps } from './gaps';
import { filenames } from './filenames';
import { courtResult } from './court-result';
import { sudShell } from './sud-shell';
import { sudReturns } from './sud-returns';
import { sudSend } from './sud-send';
import { sudSendApi } from './sud-send-api';
import { judges } from './judges';
import { casePause } from './case-pause';

const SECTIONS: Record<string, string>[] = [
  app,      // avto-generatsiya (workflow) — sayt UI
  routes,   // avto-generatsiya (workflow) — API route xabarlari
  gaps,     // avto-generatsiya (workflow) — yorliq-map render'lari + toast
  filenames, // yuklab olinadigan hisobot/eksport fayllari nomlari
  courtResult, // sud natijasi (court-result.ts) yorliq/izoh/tavsiya
  sudShell, sudReturns, sudSend, sudSendApi, // /sud 3 tab (2026-09-19): qobiq · qaytganlar · sudga o'tkazish (UI + API)
  judges,   // sudya sinxroni (Hisobot «Sudyalar» + MIB «Sudyalarni topish»), 2026-09-28
  casePause, // ish pauzasi (meta.pause) — karta paneli, «Pauzada» tab, 3-tab to'sig'i, API, 2026-09-30
  common,   // qo'lda yozilgan umumiy (ustun — app'dagini bekor qiladi)
];

export const RU: Record<string, string> = Object.assign({}, ...SECTIONS);
