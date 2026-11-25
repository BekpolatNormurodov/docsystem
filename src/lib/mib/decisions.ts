// MIB «Ижро ҳаракатлари → Чиқарилган қарорлар» — modda (qaror turi) bo'yicha tasnif. Dashboard filtri/kesimi
// va Excel («Moddalar» varag'i, «Moddalar» ustuni) shu bitta joydan foydalanadi. Sof funksiyalar.
//
// mib.uz matni har xil keladi: «23-Модда (…)», «21 Модда (…)» (chiziqchasiz), «21-модда (…)» (kichik harf),
// «56-модда. …», raqamsiz «Ижро йигимини ундириш тугрисида». 21-modda bir nechta turga bo'linadi (chegara,
// OVIR, mol-mulk, hisob raqam, notarius) — ular operator uchun alohida ma'noli, shuning uchun alohida guruh.

export interface Decision { article: string; date: string }

export interface ModdaGroup {
  /** Saralash va filtr kaliti: «23», «21-chegara», «ijro-yigimi», «boshqa», … */
  key: string;
  /** Ko'rinadigan nom: «23 · Ijro ishini qo'zg'atish». */
  label: string;
  /** Modda raqami (raqamsiz qarorda null). */
  no: number | null;
}

// Ma'lum moddalar (mib.uz qavs ichidagi nomi + operator ro'yxati, 2026-11-25).
const KNOWN: Record<number, string> = {
  20: 'Mutaxassis tayinlash',
  23: 'Ijro ishini qoʻzgʻatish',
  33: 'Ijro harakatlarini keyinga qoldirish',
  35: 'Ijro ishini toʻxtatib turish',
  40: 'Ijro hujjatini qaytarish',
  42: 'Qarzdor / mol-mulkni qidirish',
  56: 'Mol-mulkni realizatsiya qilish',
  64: 'Ish haqiga qaratish',
  67: 'Jazo oʻtayotgan qarzdor ish haqiga qaratish',
  82: 'Ijroga toʻsqinlik uchun javobgarlik',
};

// 21-modda — taqiq turlari (qavs ichidagi matndan).
const ART21: [RegExp, string, string][] = [
  [/чегара|chegara/i, '21-chegara', 'Chegaradan chiqishga taqiq'],
  [/овир|ovir/i, '21-ovir', 'OVIR taqiq'],
  [/ҳ\s*\/\s*р|х\s*\/\s*р|ҳисоб|hisob|банд/i, '21-hisob', 'Hisob raqamga band qoʻyish'],
  [/нотариус|notarius/i, '21-notarius', 'Notariusga taqiq'],
  // mib.uz «Aвтомототранспорт» — birinchi «A» lotincha keladi, shuning uchun «втомото»/«транспорт» bo'yicha.
  [/втомото|транспорт|avto|transport/i, '21-avto', 'Avtotransportga taqiq'],
  [/кўчмас|кучмас|мол-мулк|mol-mulk|ko.?chmas/i, '21-mulk', 'Koʻchmas mol-mulkka taqiq'],
];

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Bitta qaror matnini guruhga ajratadi. */
export function classifyDecision(articleRaw: string): ModdaGroup {
  const a = clean(articleRaw ?? '');
  const m = a.match(/^(\d{1,3})\s*[-–]?\s*модда/i) || a.match(/^(\d{1,3})\s*[-–]?\s*modda/i);
  if (m) {
    const no = Number(m[1]);
    if (no === 21) {
      for (const [re, key, label] of ART21) if (re.test(a)) return { key, label: `21 · ${label}`, no };
      return { key: '21', label: '21 · Taqiq qoʻyish (boshqa)', no };
    }
    const known = KNOWN[no];
    if (known) return { key: String(no), label: `${no} · ${known}`, no };
    // Noma'lum raqam — mib.uz'dagi qavs ichidagi (yoki nuqtadan keyingi) nomi bilan.
    const name = (a.match(/\(([^)]+)\)/)?.[1] ?? a.replace(/^\d+\s*[-–]?\s*модда\.?\s*/i, '')).slice(0, 60);
    return { key: String(no), label: `${no} · ${clean(name) || 'modda'}`, no };
  }
  if (/йиғим|йигим|yig.?im/i.test(a)) return { key: 'ijro-yigimi', label: 'Ijro yigʻimini undirish', no: null };
  return { key: 'boshqa', label: 'Boshqa (raqamsiz qaror)', no: null };
}

/** Qarorlar ro'yxatidan: guruhlar (takrorsiz), oxirgi qaror va uning sanasi. */
export function summarizeDecisions(list: Decision[] | null | undefined): { groups: ModdaGroup[]; last: Decision | null; codes: string } {
  const arr = Array.isArray(list) ? list.filter((d) => d && d.article) : [];
  const seen = new Map<string, ModdaGroup>();
  for (const d of arr) { const g = classifyDecision(d.article); if (!seen.has(g.key)) seen.set(g.key, g); }
  const groups = [...seen.values()].sort(groupOrder);
  // Oxirgi harakat — eng kech sana (bir xil bo'lsa ro'yxatdagi oxirgisi).
  const ts = (d: Decision) => { const m = (d.date ?? '').match(/^(\d{2})\.(\d{2})\.(\d{4})/); return m ? Date.UTC(+m[3]!, +m[2]! - 1, +m[1]!) : -1; };
  let last: Decision | null = null;
  for (const d of arr) if (!last || ts(d) >= ts(last)) last = d;
  const short = (g: ModdaGroup) => (g.no != null ? String(g.no) : g.key === 'ijro-yigimi' ? 'yigʻim' : 'boshqa');
  return { groups, last, codes: groups.map(short).filter((v, i, x) => x.indexOf(v) === i).join(', ') };
}

/** Guruhlar tartibi: raqam bo'yicha, raqamsizlar oxirida. */
export function groupOrder(a: ModdaGroup, b: ModdaGroup): number {
  return (a.no ?? 999) - (b.no ?? 999) || a.key.localeCompare(b.key);
}

export interface ModdaRow { key: string; label: string; no: number | null; cases: number; clients: number; debt: number; lastDate: string }
/** Modda kesimi: har guruh — nechta ish/mijozda uchraydi, ularning qoldig'i, eng oxirgi sana. */
export function moddaBreakdown(clients: { id: number; cases: { decisions?: unknown; remainingDebt: string | null }[] }[], parseMoney: (s: string | null) => number): ModdaRow[] {
  const rows = new Map<string, ModdaRow & { cl: Set<number>; lastTs: number }>();
  for (const c of clients) for (const k of c.cases) {
    const list = (Array.isArray(k.decisions) ? k.decisions : []) as Decision[];
    const per = new Map<string, { g: ModdaGroup; ts: number; date: string }>();
    for (const d of list) {
      if (!d?.article) continue;
      const g = classifyDecision(d.article);
      const m = (d.date ?? '').match(/^(\d{2})\.(\d{2})\.(\d{4})/); const t = m ? Date.UTC(+m[3]!, +m[2]! - 1, +m[1]!) : -1;
      const p = per.get(g.key); if (!p || t > p.ts) per.set(g.key, { g, ts: t, date: d.date ?? '' });
    }
    for (const { g, ts, date } of per.values()) {
      const r = rows.get(g.key) ?? { ...g, cases: 0, clients: 0, debt: 0, lastDate: '', cl: new Set<number>(), lastTs: -1 };
      r.cases += 1; r.cl.add(c.id); r.debt += parseMoney(k.remainingDebt);
      if (ts > r.lastTs) { r.lastTs = ts; r.lastDate = date; }
      rows.set(g.key, r);
    }
  }
  return [...rows.values()].map(({ cl, lastTs: _t, ...r }) => ({ ...r, clients: cl.size })).sort(groupOrder);
}
