// Barcha boʻlim RU lugʻatlari shu yerda birlashadi. Bir kalit bir marta boʻlsin (boʻlimlar orasida
// takrorlanmasin) — takrorlansa keyingisi ustun keladi. Yangi boʻlim qoʻshilganda: importni va
// SECTIONS roʻyxatiga qoʻshing.
import { common } from './common';
import { app } from './app';

const SECTIONS: Record<string, string>[] = [
  app,      // avto-generatsiya (workflow) — sayt UI
  common,   // qo'lda yozilgan umumiy (ustun — app'dagini bekor qiladi)
];

export const RU: Record<string, string> = Object.assign({}, ...SECTIONS);
