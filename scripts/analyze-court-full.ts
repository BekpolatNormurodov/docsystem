// FULL analysis of the assembled 5-sud BRIGHT package. Read-only: modifies nothing.
// Produces ~/Downloads/5-sud_TOLIQ_ANALIZ.xlsx (Xulosa + Har mijoz + Kamomad + KEEP + Firma)
// and prints a complete terminal summary.
import fs from 'node:fs'; import path from 'node:path';
import Excel from 'exceljs';

const SUD   = '/private/tmp/claude-501/-Users-khurshid28-Desktop-apps-docsystem/c1691449-e956-4d32-8c83-d27c0048a86f/scratchpad/sample_sud/5-sud BRIGHT';
const CH    = '/Users/khurshid28/Downloads/OFERTA_CHIQDI';
const BACKUP= '/private/tmp/claude-501/-Users-khurshid28-Desktop-apps-docsystem/c1691449-e956-4d32-8c83-d27c0048a86f/scratchpad/court_backup';
const OUT   = '/Users/khurshid28/Downloads/5-sud_TOLIQ_ANALIZ.xlsx';
const FN: Record<string,string> = { '12842':'BRIGHT','06292':'URBAN','55890':'COMMUNITY' };
const norm=(s:string)=>s.toUpperCase().replace(/[`'ʻʼ‘’]/g,"'").replace(/\s+/g,' ').replace(/\.PDF$/,'').replace(/-/g,' ').trim();

// CHIQDI: name -> pinfl + per-firm expected oferta counts
const pinflOf=new Map<string,string>();
const expFirm=new Map<string,Record<string,number>>();
for(const firm of fs.readdirSync(CH)){const fp=path.join(CH,firm);if(!fs.statSync(fp).isDirectory())continue;const code=firm.split(' ')[0];
  for(const cl of fs.readdirSync(fp)){const cp=path.join(fp,cl);if(!fs.statSync(cp).isDirectory())continue;const m=cl.match(/^(\d{14})\s+(.*)$/);if(!m)continue;
    const k=norm(m[2]); pinflOf.set(k,m[1]);
    const n=fs.readdirSync(cp).filter(f=>/\.pdf$/i.test(f)).length;
    if(!expFirm.has(k))expFirm.set(k,{}); expFirm.get(k)![code]=(expFirm.get(k)![code]||0)+n;}}

const replaceSet=new Set(fs.existsSync(BACKUP)?fs.readdirSync(BACKUP):[]);

interface R{pinfl:string;client:string;firms:string;davo:boolean;ariza:boolean;guvox:boolean;ishonch:boolean;shart:boolean;
  receipt:string;ofB:number;ofU:number;ofC:number;placed:number;expected:number;amal:string;holat:string}
const rows:R[]=[];
for(const folder of fs.readdirSync(SUD)){const fp=path.join(SUD,folder);if(!fs.statSync(fp).isDirectory())continue;
  const files=fs.readdirSync(fp); const nf=norm(folder);
  const davo=files.some(f=>norm(f)===nf);
  const ariza=files.some(f=>/ariza|arizza/i.test(f));
  const guvox=files.some(f=>/guvox/i.test(f));
  const ishonch=files.some(f=>/ishonch/i.test(f));
  const shart=files.some(f=>/shartnoma/i.test(f));
  const receipt=files.some(f=>/receipt|td\d+_/i.test(f))?'TD':files.some(f=>/^кимга/i.test(f))?'Кимга':'YO\'Q';
  const placed=files.filter(f=>/oferta/i.test(f)&&/\.pdf$/i.test(f)).length;
  const e=expFirm.get(nf)||{}; const expected=Object.values(e).reduce((a,b)=>a+b,0);
  const amal=replaceSet.has(folder)?'REPLACE':(placed>expected?'KEEP':'INJECT');
  const miss:string[]=[];
  if(!davo)miss.push('da\'vo(ism.pdf)'); if(!ariza)miss.push('ariza'); if(!guvox)miss.push('guvoxnoma');
  if(!ishonch)miss.push('ishonchnoma'); if(!shart)miss.push('shartnoma'); if(receipt==='YO\'Q')miss.push('kvitansiya');
  if(placed<expected)miss.push(`oferta kam(${placed}/${expected})`);
  const holat=miss.length?('KAMOMAD: '+miss.join(', ')):'TO\'LIQ';
  rows.push({pinfl:pinflOf.get(nf)||'',client:folder,firms:Object.keys(e).map(c=>FN[c]||c).join('+'),
    davo,ariza,guvox,ishonch,shart,receipt,ofB:e['12842']||0,ofU:e['06292']||0,ofC:e['55890']||0,
    placed,expected,amal,holat});}

rows.sort((a,b)=>a.client.localeCompare(b.client));
const tot=(f:(r:R)=>boolean)=>rows.filter(f).length;
const sum=(f:(r:R)=>number)=>rows.reduce((a,r)=>a+f(r),0);
const toliq=rows.filter(r=>r.holat==='TO\'LIQ').length;
const kamomad=rows.filter(r=>r.holat!=='TO\'LIQ');

console.log('════════ 5-sud BRIGHT — TO\'LIQ ANALIZ ════════');
console.log('Mijoz papka:',rows.length,' | TO\'LIQ:',toliq,' | biror kamomadли:',kamomad.length);
console.log('\n── Hujjat turi bo\'yicha to\'liqlik (284 dan) ──');
console.log('  da\'vo (ism.pdf) :',tot(r=>r.davo),'  yo\'q:',tot(r=>!r.davo));
console.log('  ariza           :',tot(r=>r.ariza),'  yo\'q:',tot(r=>!r.ariza));
console.log('  guvoxnoma       :',tot(r=>r.guvox),'  yo\'q:',tot(r=>!r.guvox));
console.log('  ishonchnoma     :',tot(r=>r.ishonch),'  yo\'q:',tot(r=>!r.ishonch));
console.log('  shartnoma       :',tot(r=>r.shart),'  yo\'q:',tot(r=>!r.shart));
console.log('  kvitansiya      :',tot(r=>r.receipt!=='YO\'Q'),' (TD:',tot(r=>r.receipt==='TD'),' Кимга:',tot(r=>r.receipt==='Кимга'),')  yo\'q:',tot(r=>r.receipt==='YO\'Q'));
console.log('  oferta          :',tot(r=>r.placed>0),'  0 ta:',tot(r=>r.placed===0),' (kam tushgan:',tot(r=>r.placed<r.expected),')');
console.log('\n── Oferta amal turi ──');
console.log('  INJECT:',tot(r=>r.amal==='INJECT'),' REPLACE:',tot(r=>r.amal==='REPLACE'),' KEEP:',tot(r=>r.amal==='KEEP'));
console.log('\n── Firma bo\'yicha oferta (aktiv, 284 mijoz ichida) ──');
for(const c of ['12842','06292','55890']){const k=c==='12842'?'ofB':c==='06292'?'ofU':'ofC';
  console.log(`  ${c} ${(FN[c]).padEnd(10)}: ${String(sum(r=>(r as any)[k])).padStart(4)} oferta / ${String(tot(r=>(r as any)[k]>0)).padStart(3)} mijozда`);}
console.log('  ─ jami aktiv kutilgan:',sum(r=>r.expected),' | papkaga joylandi:',sum(r=>r.placed),' (KEEP ortiqcha yopiq:',sum(r=>r.placed)-sum(r=>r.expected),')');
console.log('\n── KAMOMAD ('+kamomad.length+' mijoz) ──');
kamomad.forEach(r=>console.log('  •',r.client,'—',r.holat.replace('KAMOMAD: ','')));
console.log('\n── KEEP — eski oferta ko\'p (ko\'rib chiqing) ──');
rows.filter(r=>r.amal==='KEEP').forEach(r=>console.log('  •',r.client,`joylandi ${r.placed} vs aktiv ${r.expected}`));

// ── Excel ──
(async()=>{
  const wb=new Excel.Workbook();
  const s1=wb.addWorksheet('Xulosa'); s1.columns=[{header:'Ko\'rsatkich',key:'k',width:46},{header:'Qiymat',key:'v',width:60}];
  s1.addRows([
    {k:'Mijoz papka',v:rows.length},{k:'TO\'LIQ (hech kamomadsiz)',v:toliq},{k:'Biror kamomadli',v:kamomad.length},
    {k:'— Hujjat to\'liqligi (284 dan) —',v:''},
    {k:'da\'vo (ism.pdf) bor',v:tot(r=>r.davo)},{k:'ariza bor',v:tot(r=>r.ariza)},
    {k:'guvoxnoma bor',v:tot(r=>r.guvox)},{k:'ishonchnoma bor',v:tot(r=>r.ishonch)},{k:'shartnoma bor',v:tot(r=>r.shart)},
    {k:'kvitansiya bor (TD+Кимга)',v:tot(r=>r.receipt!=='YO\'Q')},{k:'oferta bor',v:tot(r=>r.placed>0)},
    {k:'— Oferta amal —',v:''},{k:'INJECT',v:tot(r=>r.amal==='INJECT')},{k:'REPLACE',v:tot(r=>r.amal==='REPLACE')},{k:'KEEP',v:tot(r=>r.amal==='KEEP')},
    {k:'— Firma oferta —',v:''},
    {k:'BRIGHT (12842)',v:`${sum(r=>r.ofB)} oferta / ${tot(r=>r.ofB>0)} mijoz`},
    {k:'URBAN (06292)',v:`${sum(r=>r.ofU)} oferta / ${tot(r=>r.ofU>0)} mijoz`},
    {k:'COMMUNITY (55890)',v:`${sum(r=>r.ofC)} oferta / ${tot(r=>r.ofC>0)} mijoz`},
    {k:'Jami aktiv oferta joylandi',v:sum(r=>r.placed)},
    {k:'— KAMOMAD —',v:''},
    {k:'da\'vo yo\'q',v:rows.filter(r=>!r.davo).map(r=>r.client).join(', ')||'—'},
    {k:'kvitansiya yo\'q',v:rows.filter(r=>r.receipt==='YO\'Q').map(r=>r.client).join(', ')||'—'},
  ]); s1.getRow(1).font={bold:true};

  const s2=wb.addWorksheet('Har mijoz');
  s2.columns=[{header:'PINFL',key:'pinfl',width:17},{header:'Mijoz',key:'client',width:40},{header:'Firmalar',key:'firms',width:20},
    {header:'da\'vo',key:'davo',width:7},{header:'ariza',key:'ariza',width:7},{header:'guvox',key:'guvox',width:7},
    {header:'ishonch',key:'ishonch',width:8},{header:'shart',key:'shart',width:7},{header:'kvitansiya',key:'receipt',width:10},
    {header:'of.BRIGHT',key:'ofB',width:9},{header:'of.URBAN',key:'ofU',width:9},{header:'of.COMM',key:'ofC',width:8},
    {header:'joylandi',key:'placed',width:8},{header:'amal',key:'amal',width:9},{header:'HOLAT',key:'holat',width:40}];
  const b=(x:boolean)=>x?'✓':'YO\'Q';
  rows.forEach(r=>{const row=s2.addRow({...r,davo:b(r.davo),ariza:b(r.ariza),guvox:b(r.guvox),ishonch:b(r.ishonch),shart:b(r.shart)});
    if(r.holat!=='TO\'LIQ')row.getCell('holat').font={color:{argb:'FFC00000'},bold:true};});
  s2.getRow(1).font={bold:true};

  const s3=wb.addWorksheet('Kamomad'); s3.columns=[{header:'Mijoz',key:'client',width:40},{header:'PINFL',key:'pinfl',width:17},{header:'Nima yetishmaydi',key:'holat',width:50}];
  kamomad.forEach(r=>s3.addRow({client:r.client,pinfl:r.pinfl,holat:r.holat.replace('KAMOMAD: ','')})); s3.getRow(1).font={bold:true};

  const s4=wb.addWorksheet('KEEP tekshiruv'); s4.columns=[{header:'Mijoz',key:'client',width:40},{header:'Joylandi(eski)',key:'placed',width:14},{header:'Aktiv(generatsiya)',key:'expected',width:16},{header:'Izoh',key:'izoh',width:44}];
  rows.filter(r=>r.amal==='KEEP').forEach(r=>s4.addRow({client:r.client,placed:r.placed,expected:r.expected,izoh:'eski qo\'lda to\'plam saqlandi (yopiq shartnoma ofertasi ham bor)'})); s4.getRow(1).font={bold:true};

  await wb.xlsx.writeFile(OUT); console.log('\nExcel hisobot:',OUT);
})();
