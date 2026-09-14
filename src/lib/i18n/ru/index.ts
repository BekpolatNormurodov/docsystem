// Barcha boʻlim RU lugʻatlari shu yerda birlashadi. Bir kalit bir marta boʻlsin (boʻlimlar orasida
// takrorlanmasin) — takrorlansa keyingisi ustun keladi. Yangi boʻlim qoʻshilganda: importni va
// SECTIONS roʻyxatiga qoʻshing.
import { common } from './common';
import { app } from './app';
import { routes } from './routes';
import { gaps } from './gaps';
import { courtResult } from './court-result';

const SECTIONS: Record<string, string>[] = [
  app,      // avto-generatsiya (workflow) — sayt UI
  routes,   // avto-generatsiya (workflow) — API route xabarlari
  gaps,     // avto-generatsiya (workflow) — yorliq-map render'lari + toast
  courtResult, // sud natijasi (court-result.ts) yorliq/izoh/tavsiya
  common,   // qo'lda yozilgan umumiy (ustun — app'dagini bekor qiladi)
];

export const RU: Record<string, string> = Object.assign({}, ...SECTIONS);
