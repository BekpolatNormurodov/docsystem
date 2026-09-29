// scripts/tlb-manual-build.ts yasagan <FIRMA>_rows.json → xat.hippo reyestr, firmaning SAQLANGAN hippo
// sessiyasi bilan (Ulanishlar → «Ula»). DB'ga hech narsa YOZMAYDI — faqat sessiyani o'qiydi; hippo
// holat-sinxroni (worker, har soat) yangi reyestrni o'zi tortadi.
//   npx tsx scripts/tlb-manual-send.ts <rows.json>                  → TEKSHIRUV: shablon/org/filial/balans, hech narsa yaratilmaydi
//   npx tsx scripts/tlb-manual-send.ts <rows.json> --send --yes     → reyestr + autoSend (HAQIQIY jo'natish)
//   npx tsx scripts/tlb-manual-send.ts <rows.json> --status <regId> → reyestr holati (jami / jo'natilgan / xato)
//   npx tsx scripts/tlb-manual-send.ts <rows.json> --resend-unsent <regId> [--send --yes]
//                                   → «Completed» reyestrning isSend=false xatlarini YANGI reyestr bilan qayta yuborish
// Qo'shimcha: --template <id> (akkauntda bir nechta «Talabnoma» bo'lsa), --branch <id>, --limit <N>.
import fs from 'node:fs';
import { getStoredHippoSession } from '../src/lib/hippo/session';
import { api, getTemplates, resolveContext, checkBalanceFor, getRegistry, listRegistries, listRegistryMails } from '../src/lib/hippo/xat';
import { talabnomaRowsToMails, sendNonce } from '../src/lib/hippo/talabnoma-send';
import { hippoTemplateIdByStir, hippoBranchIdByStir } from '../src/lib/firms';
import type { HippoSession } from '../src/lib/hippo/login';
import type { TalabnomaRow } from '../src/lib/hippo/talabnoma-excel';

const args = process.argv.slice(2);
const file = args[0];
const has = (n: string) => args.includes(n);
const opt = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const items = (j: any): any[] => (Array.isArray(j) ? j : j?.data?.items ?? j?.items ?? j?.data ?? []);
const CREATE_TIMEOUT_MS = 180_000; // 1000+ xatli reyestr 30s'dan uzoq ketishi mumkin

async function printStatus(s: HippoSession, id: string) {
  const reg = await getRegistry(s, id);
  const r = reg.json?.data ?? reg.json ?? {};
  console.log(`reyestr #${id}: status=${r.status ?? r.state ?? '?'} mails=${r.mailCount ?? r.totalCount ?? '?'} created=${r.createdAt ?? r.createdOn ?? '?'}`);
  const bySend = new Map<string, number>();
  const errSamples: any[] = [];
  const errText = new Map<string, number>();
  let total = 0; let sent = 0;
  for (let page = 1; ; page++) {
    const arr = items((await listRegistryMails(s, id, page, 100)).json);
    for (const m of arr) {
      total++; if (m.isSend) sent++;
      const k = `${m.sendStatus ?? '?'}${m.activePerform?.performType ? '/' + m.activePerform.performType : ''}`;
      bySend.set(k, (bySend.get(k) ?? 0) + 1);
      if (!['Success', 'InProgress', 'Null', 'null', 'undefined'].includes(String(m.sendStatus))) {
        if (errSamples.length < 2) errSamples.push(m);
        // Xato matni qaysi maydonda bo'lsa ham — «error/message/reason» kalitli barcha qiymatlar.
        const txt = Object.entries(m).filter(([key, v]) => /error|message|reason|comment|note/i.test(key) && v).map(([key, v]) => `${key}=${String(typeof v === 'object' ? JSON.stringify(v) : v).slice(0, 160)}`).join(' | ') || '(xato matni yoʻq)';
        errText.set(txt, (errText.get(txt) ?? 0) + 1);
      }
    }
    if (arr.length < 100) break;
  }
  console.log(`xatlar: jami=${total} jo'natilgan(isSend)=${sent}`, Object.fromEntries(bySend));
  if (errText.size) {
    console.log('xato sabablari:'); for (const [t, n] of errText) console.log(`  ${n} ta: ${t}`);
    console.log('xato namunasi:', JSON.stringify(errSamples[0]).slice(0, 900));
  }
}

async function main() {
  if (!file) throw new Error('usage: tlb-manual-send.ts <rows.json> [--send --yes] [--status <regId>]');
  const { firm, rows: raw } = JSON.parse(fs.readFileSync(file, 'utf8'));
  // JSON'da sanalar ISO string (UTC yarim tun) — Date'ga qaytaramiz.
  const rows: TalabnomaRow[] = raw.map((r: any) => ({ ...r, date: new Date(r.date), contract_date: r.contract_date ? new Date(r.contract_date) : null }));
  const limit = Number(opt('--limit')) || 0;
  let batch = limit > 0 ? rows.slice(0, limit) : rows;

  const session = await getStoredHippoSession(firm.stir);
  console.log(`firma=${firm.name} stir=${firm.stir} qator=${batch.length}/${rows.length} · ulangan kalit: ${session.key?.info?.cn ?? '?'} / ${session.key?.info?.org ?? '?'} (tin ${session.key?.info?.tin ?? '?'})`);
  const tin = String(session.key?.info?.tin ?? '').replace(/\D/g, '');
  if (tin && tin !== String(firm.stir)) throw new Error(`Sessiya boshqa firmaniki: kalit STIR ${tin} ≠ ${firm.stir}`);

  const statusId = opt('--status');
  if (statusId) return printStatus(session, statusId);

  // Pul tugab «Completed» bo'lgan reyestrning jo'natilmagan (isSend=false) xatlari — hippo ularni o'zi davom
  // ettirmaydi (BRIGHT #186 3 hafta shunday turdi). Faqat Completed bo'lsa: aks holda hippo hali jo'natishi
  // mumkin → ikki nusxa. Xat → qator: clientCustomId («<contract_id>-<nonce>»), bo'lmasa noyob F.I.Sh.
  const resendId = opt('--resend-unsent');
  if (resendId) {
    const reg = await getRegistry(session, resendId);
    const st = String((reg.json?.data ?? reg.json ?? {}).status ?? '?');
    if (!/^completed$/i.test(st)) throw new Error(`Reyestr #${resendId} hali «${st}» — hippo tugatmaguncha qayta yubormaymiz (ikki nusxa xavfi)`);
    const unsent: any[] = [];
    for (let page = 1; ; page++) {
      const arr = items((await listRegistryMails(session, resendId, page, 100)).json);
      unsent.push(...arr.filter((m) => !m.isSend));
      if (arr.length < 100) break;
    }
    if (unsent[0]) console.log('xat maydonlari:', Object.keys(unsent[0]).join(','));
    const byCid = new Map(rows.map((r) => [String(r.contract_id), r]));
    const nameCount = new Map<string, number>();
    for (const r of rows) nameCount.set(r.receiver, (nameCount.get(r.receiver) ?? 0) + 1);
    const byName = new Map(rows.filter((r) => nameCount.get(r.receiver) === 1).map((r) => [r.receiver, r]));
    const picked = new Map<string, TalabnomaRow>();
    let unmatched = 0;
    for (const m of unsent) {
      const cid = String(m.clientCustomId ?? m.customId ?? m.custom_id ?? '').replace(/-[a-z0-9]+$/i, '');
      const r = byCid.get(cid) ?? byName.get(String(m.receiverName ?? m.receiver ?? '').trim());
      if (r) picked.set(String(r.contract_id), r); else unmatched++;
    }
    batch = [...picked.values()];
    console.log(`#${resendId}: jo'natilmagan ${unsent.length} · qatorga moslandi ${batch.length} · moslanmadi ${unmatched}`);
    if (!batch.length) return;
  }

  const tpls = items((await getTemplates(session)).json);
  console.log('shablonlar:', tpls.map((t) => `${t.id} «${t.name}» org=${t.organizationId}`).join(' | ') || '—');
  const templateId = Number(opt('--template')) || hippoTemplateIdByStir(firm.stir);
  // Bir login bir nechta org shablonini ko'rishi mumkin (masalan BRIGHT/FUNDFLOW direktori bitta) — nom
  // bo'yicha birinchisini olish BOSHQA firma blankasiga yuborib yuboradi. Aniq id talab qilamiz.
  const talabTpls = tpls.filter((t) => /talabnoma/i.test(String(t.name ?? '')));
  if (!templateId && talabTpls.length > 1 && has('--send')) throw new Error(`«Talabnoma» shablonlari ${talabTpls.length} ta — --template <id> bilan aniq tanlang`);
  const ctx = await resolveContext(session, 'talabnoma', templateId, Number(opt('--branch')) || hippoBranchIdByStir(firm.stir));
  // Filial reyestrdan aniqlanmasa (yangi akkaunt, hali reyestri yo'q — MUVAFFAQIYAT): hippo frontendining
  // o'z endpointlari (organizationStore): /branch/my-organization-branches, /permission/my-branches, /branch/my-branch.
  if (!ctx.branchId) {
    const found: any[] = [];
    for (const p of ['/branch/my-organization-branches', '/permission/my-branches', '/branch/my-branch']) {
      const r = await api(session, p);
      const arr: any[] = Array.isArray(r.json) ? r.json : r.json?.id ? [r.json] : items(r.json);
      console.log(`filiallar ${p} → ${r.status}:`, JSON.stringify(arr).slice(0, 400));
      found.push(...arr.filter((b) => b && typeof b === 'object'));
    }
    const orgOf = (b: any) => Number(b.organizationId ?? b.organization?.id ?? ctx.organizationId);
    const mine = [...new Map(found.filter((b) => Number(b.id) > 0 && orgOf(b) === ctx.organizationId).map((b) => [Number(b.id), b])).values()];
    if (mine.length === 1) { ctx.branchId = Number(mine[0].id); console.log(`filial topildi: ${ctx.branchId} «${mine[0].name ?? mine[0].fullName ?? ''}»`); }
    else console.log(`filial: ${mine.length} ta mos keldi — ${mine.length ? '--branch <id> bilan tanlang' : 'hippo «Filiallar»da filial yarating'}`);
  }
  // Ma'lum firmalarning shablonlari (firms.ts) — boshqa firma ro'yxati BU blankada ketmasin.
  const KNOWN_TPL: Record<number, string> = { 42: 'BRIGHT', 45: 'BRIGHT', 119: 'URBAN', 123: 'COMMUNITY' };
  const owner = KNOWN_TPL[Number(ctx.templateId)];
  if (owner && owner !== firm.name && has('--send')) throw new Error(`Shablon ${ctx.templateId} «${ctx.templateName}» — ${owner} firmasiniki, ${firm.name} uchun emas. --template <id> bilan to'g'risini tanlang`);
  const bal = await checkBalanceFor(session, batch.length);
  // Tarif API narxni 0 deb qaytaradi, lekin hippo haqiqatda xat boshiga 10 800 so'm yechadi (2026-09-29).
  const price = Math.max(bal.pricePerMail, Number(process.env.HIPPO_PRICE_PER_MAIL) || 10_800);
  const need = price * batch.length;
  const enough = bal.spendable >= need;
  console.log('kontekst:', ctx);
  console.log(`balans: ${bal.balance} (kredit ${bal.allowCredit ? bal.creditAmount : 0}) · 1 xat ${price} · ${batch.length} xat = ${need} · yetadi=${enough} (pul ${Math.floor(bal.spendable / price)} xatga yetadi)`);

  const mails = talabnomaRowsToMails(batch, ctx.templateName, sendNonce());
  const badGeo = mails.filter((m) => !m.regionId || !m.areaId);
  console.log('namuna:', JSON.stringify(mails[0]));
  if (!(has('--send') && has('--yes'))) { console.log('TEKSHIRUV — hech narsa yaratilmadi. Haqiqiy yuborish: --send --yes'); return; }

  if (!ctx.organizationId) throw new Error('organizationId aniqlanmadi — shablon topilmadi');
  if (!enough) throw new Error(`Balans yetarli emas: ${batch.length} xat × ${price} = ${need} so'm kerak, bor ${bal.spendable} (${need - bal.spendable} kam) — hech narsa yuborilmadi`);
  if (badGeo.length) throw new Error(`${badGeo.length} ta xatda viloyat/tuman 0 — hippo rad etadi`);

  const base = { organizationId: ctx.organizationId, templateId: ctx.templateId, templateName: ctx.templateName, autoSend: true, mails };
  const post = (path: string, branchId: number | null) =>
    api(session, path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...base, branchId }) }, CREATE_TIMEOUT_MS);
  // talabnoma-send.ts bilan bir xil tartib: targeting/branch xatolarida keyingi variant, boshqa xatoda to'xtaydi.
  const attempts: [string, () => ReturnType<typeof post>][] = [
    ['internal+branch', () => post('/registry/process-mails', ctx.branchId || null)],
    ['external+branch', () => post('/registry/process-mails/external', ctx.branchId || null)],
    ['internal-noBranch', () => post('/registry/process-mails', null)],
    ['external-noBranch', () => post('/registry/process-mails/external', null)],
  ];
  const before = new Set(items((await listRegistries(session, { PageIndex: 1, PageSize: 20 })).json).map((r) => Number(r.id)));
  let res: { ok: boolean; status: number; json: any } | null = null;
  let success = false;
  for (const [label, run] of attempts) {
    try {
      res = await run();
    } catch (e) {
      // Timeout/uzilish: reyestr hippo'da yaratilgan bo'lishi mumkin — QAYTA YUBORMAYMIZ (ikki marta ketadi).
      const fresh = items((await listRegistries(session, { PageIndex: 1, PageSize: 20 })).json).filter((r) => !before.has(Number(r.id)));
      console.error(`✗ ${label}: ${e instanceof Error ? e.message : e}. Yangi reyestr(lar): ${fresh.map((r) => r.id).join(', ') || 'yoʻq'} — --status bilan tekshiring, qayta yubormang.`);
      return;
    }
    const code = Number(res.json?.code);
    const err = String(res.json?.error ?? res.json?.message ?? '');
    if (res.ok && !(Number.isFinite(code) && code >= 400)) { success = true; console.log(`✓ variant «${label}»`); break; }
    console.warn(`variant «${label}» → ${res.status} ${err.slice(0, 200)}`);
    if (!/invalid targeting|mandatory|branch/i.test(err)) break;
  }
  if (!success || !res) { console.error('✗ hippo rad etdi — hech narsa yuborilmadi:', JSON.stringify(res?.json)?.slice(0, 300)); process.exitCode = 1; return; }

  const d = res.json?.data ?? {};
  const fresh = items((await listRegistries(session, { PageIndex: 1, PageSize: 20 })).json).filter((r) => !before.has(Number(r.id)));
  const registryId = res.json?.id ?? d.id ?? d.registryId ?? fresh[0]?.id ?? null;
  const out = { firm: firm.name, registryId, count: mails.length, queued: d.queuedCount, errors: d.errorCount, errorMessages: (d.errorMessages ?? []).slice(0, 20), at: new Date().toISOString() };
  console.log('NATIJA:', JSON.stringify(out));
  fs.writeFileSync(file.replace(/\.json$/, `.sent-${Date.now()}.json`), JSON.stringify({ ...out, response: res.json }, null, 1));
}

main().then(() => process.exit(process.exitCode ?? 0)).catch((e) => { console.error('✗', e instanceof Error ? e.message : e); process.exit(1); });
