// Resolve docsystem region/district (Cyrillic) -> hippo {regionId, areaId}.
//
// Inputs come from the portfolio: `regionName` is Russian oblast style
// ("САМАРКАHДСКАЯ ОБЛАСТЬ", with stray Latin H/I), `distr_name` is Uzbek
// Cyrillic ("ОКДАРЁ ТУМАНИ"). Hippo area names are also Uzbek Cyrillic, so
// area matching is Cyrillic-to-Cyrillic on a normalized core + a shahar flag.
import { HIPPO_REGIONS, HIPPO_AREAS, type HippoArea } from './hippo-regions-data';

// Latin H/I leak into the Cyrillic portfolio data; fold them back, then strip
// to a bare uppercase Cyrillic letter core.
function cyrUpper(s: string): string {
  return String(s ?? '')
    .replace(/H/g, 'Н').replace(/h/g, 'н')
    .replace(/I/g, 'И').replace(/i/g, 'и')
    .replace(/P/g, 'Р').replace(/C/g, 'С').replace(/O/g, 'О').replace(/A/g, 'А').replace(/E/g, 'Е')
    .toUpperCase();
}

// 14 regions — match the Russian/Uzbek region name to a hippo region id.
const REGION_RULES: [RegExp, number][] = [
  [/КАРАКАЛПАК|КОРАКАЛПОГ/, 13],
  [/ГОРОД\s*ТАШКЕН|ТАШКЕН.*ГОРОД|Г\.?\s*ТАШКЕН/, 1],
  [/ТАШКЕН/, 2],          // Ташкентская область (after the city rule)
  [/САМАРКАН/, 3],
  [/ДЖИЗАК|ЖИЗЗАХ|ЖИЗАХ/, 4],
  [/СЫРДАР|СИРДАР/, 5],
  [/ФЕРГАН|ФАРГОН|ФАРГАН/, 6],
  [/АНДИЖАН|АНДИЖОН/, 7],
  [/НАМАНГАН/, 8],
  [/КАШКАДАР/, 9],
  [/СУРХАНДАР|СУРХОНДАР/, 10],
  [/БУХАР|БУХОР/, 11],
  [/НАВОИ/, 12],
  [/ХОРЕЗМ|ХОРАЗМ/, 14],
];

export function resolveRegionId(regionName: string): number {
  const s = cyrUpper(regionName);
  for (const [re, id] of REGION_RULES) if (re.test(s)) return id;
  return 0;
}

// Reduce a district/area name to a comparable core + shahar flag.
function areaKey(name: string): { core: string; shahar: boolean } {
  let s = cyrUpper(name);
  const shahar = /ШАХ|ШАҲ/.test(s);
  s = s
    .replace(/ТУМАНИ|ТУМАН|РАЙОН|Р-?Н|ШАҲРИ|ШАХРИ|ШАҲАР|ШАХАР|ШАХ|ГОРОД|ШФЙ|МФЙ/g, '')
    // fold Uzbek-specific letters to their simplified Russian forms
    .replace(/Қ/g, 'К').replace(/Ў/g, 'У').replace(/Ғ/g, 'Г').replace(/Ҳ/g, 'Х').replace(/Ё/g, 'Е')
    .replace(/[^А-ЯЎҚҒҲ]/g, '');
  return { core: s, shahar };
}

// Pre-index hippo areas by region -> list of {key, area}.
const AREA_INDEX = new Map<number, { core: string; shahar: boolean; area: HippoArea }[]>();
for (const a of HIPPO_AREAS) {
  const k = areaKey(a.name);
  const list = AREA_INDEX.get(a.regionId) ?? [];
  list.push({ ...k, area: a });
  AREA_INDEX.set(a.regionId, list);
}

// Manual overrides for districts whose core doesn't line up (filled after
// running the coverage check). Key: `${regionId}|${core}` -> areaId.
const AREA_OVERRIDES: Record<string, number> = {
  '13|АМУДАРЕ': 182,       // Амурдарья тумани
  '13|КУНГИРОТ': 180,      // Кунград тумани
  '13|КОНЛИКУЛ': 178,      // Канлыкуль тумани
  '1|МИРЗОУЛУГБЕК': 2,     // М. Улугбек тумани
  '4|ШАРОФРАШИДОВ': 48,    // Ш.Рашидов тумани
};

export function resolveAreaId(regionId: number, districtName: string): number {
  if (!regionId) return 0;
  const { core, shahar } = areaKey(districtName);
  if (!core) return 0;
  const ov = AREA_OVERRIDES[`${regionId}|${core}`];
  if (ov) return ov;
  const list = AREA_INDEX.get(regionId) ?? [];
  const exact = list.filter((x) => x.core === core);
  if (exact.length === 1) return exact[0].area.id;
  if (exact.length > 1) {
    const byFlag = exact.find((x) => x.shahar === shahar);
    return (byFlag ?? exact[0]).area.id;
  }
  // startsWith / contains fallback (handles minor spelling drift)
  const partial = list.filter((x) => x.core.startsWith(core) || core.startsWith(x.core) || x.core.includes(core) || core.includes(x.core));
  if (partial.length) {
    const byFlag = partial.find((x) => x.shahar === shahar);
    return (byFlag ?? partial[0]).area.id;
  }
  // Bounded edit-distance nearest match within the region — catches Cyrillic
  // spelling drift (КУМКУРГОН↔Кумкурган, ТЕРМИЗ↔Термез, ЯНГИЙУЛ↔Янгиюл).
  // Rank by distance, then break ties by matching the shahar/tuman flag so
  // "Termiz tumani" doesn't collapse onto "Termiz shahar".
  const maxAllowed = core.length <= 5 ? 1 : core.length <= 8 ? 2 : 3;
  const scored = list
    .map((x) => ({ id: x.area.id, d: editDistance(core, x.core), sameFlag: x.shahar === shahar }))
    .filter((x) => x.d <= maxAllowed)
    .sort((a, b) => a.d - b.d || Number(b.sameFlag) - Number(a.sameFlag));
  return scored.length ? scored[0].id : 0;
}

function editDistance(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

export function resolveHippoRegionArea(regionName: string, districtName: string): { regionId: number; areaId: number } {
  const regionId = resolveRegionId(regionName);
  return { regionId, areaId: resolveAreaId(regionId, districtName) };
}

const REGION_BY_ID = new Map(HIPPO_REGIONS.map((r) => [r.id, r.name]));
const AREA_BY_ID = new Map(HIPPO_AREAS.map((a) => [a.id, a.name]));
export const regionName = (id: number): string => REGION_BY_ID.get(id) ?? '';
export const areaName = (id: number): string => AREA_BY_ID.get(id) ?? '';

export { HIPPO_REGIONS, HIPPO_AREAS };
