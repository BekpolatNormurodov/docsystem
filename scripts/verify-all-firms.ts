// Broad per-firm doc verification (fast, no PDF): for one real case per firm,
// build the ariza + invoice + talabnoma row and flag any anomaly.
import { prisma } from '@/lib/db';
import { getSettings } from '@/lib/settings';
import { buildArizaDocx } from '@/lib/ariza-docx';
import { loansToAriza, type ArizaFirm } from '@/core/ariza';
import { buildTalabnomaRows, type TalabnomaLoan } from '@/lib/hippo/talabnoma-excel';
import { buildInvoiceDocx } from '@/lib/invoice-docx';
import JSZip from 'jszip';

const BAD = /null|undefined|NaN|Invalid/;
async function docText(buf: Buffer){ const z=await JSZip.loadAsync(buf); const x=await z.file('word/document.xml')!.async('string'); return x.replace(/<[^>]+>/g,' '); }

async function main(){
  const snap = await prisma.snapshot.findFirst({ orderBy:{id:'desc'} });
  const settings = await getSettings();
  const firms = await prisma.arizaCase.groupBy({ by:['firmId'], where:{ snapshotId:snap!.id }, _count:{_all:true} });
  console.log(`firms in pipeline: ${firms.length}\n`);
  let okCount=0, problems=0;
  for(const f of firms){
    const firm = await prisma.firm.findUnique({ where:{ id:f.firmId } });
    const cases = await prisma.arizaCase.findMany({ where:{ firmId:f.firmId, snapshotId:snap!.id, pinfl:{not:null} }, take:6, select:{ id:true, pinfl:true, kod:true, clientName:true } });
    let chosen=null as any, loans:any[]=[];
    for(const c of cases){ const ls=await prisma.loan.findMany({ where:{ snapshotId:snap!.id, pinfl:c.pinfl!, ...(c.kod?{branchCode:c.kod}:{}) }, orderBy:{id:'asc'} }); if(ls.length){ chosen=c; loans=ls; break; } }
    if(!chosen){ console.log(`? ${firm?.shortName} — no case with loans`); continue; }
    const issues:string[]=[];
    // talabnoma row
    const rows = buildTalabnomaRows(loans as TalabnomaLoan[], snap!.reportDate ?? new Date());
    const r0 = rows[0];
    if(!r0) issues.push('no talabnoma row');
    else { if(r0.region===0) issues.push('region=0'); if(r0.area===0) issues.push('area=0'); if(r0.loan_amount<=0) issues.push('loan<=0'); if(r0.total_debt<=0) issues.push('debt<=0'); if(BAD.test(r0.receiver)) issues.push('bad receiver'); if(BAD.test(r0.address)) issues.push('bad address'); }
    // ariza
    const af: ArizaFirm = { shortName: firm?.shortName||chosen.kod||'X', legalName: firm?.legalName??null, address: firm?.address??null, bankAccount: firm?.bankAccount??null, mfo: firm?.mfo??null, stir: firm?.stir??null };
    const props = loansToAriza(loans, af, settings, snap!.reportDate ?? new Date());
    const at = await docText(await buildArizaDocx(props));
    const firmName = firm?.legalName || firm?.shortName || '';
    if(firmName && !at.includes(firm?.shortName?.split(' ')[0] || '###')) issues.push('firm name missing in ariza');
    if(BAD.test(props.interestRate)||BAD.test(props.debtTotal)) issues.push('bad ariza amount');
    // invoice
    const it = await docText(await buildInvoiceDocx({ clientName:chosen.clientName, kod:chosen.kod, receiptNumber:'262000000001', assignedAt: snap!.reportDate, firm }));
    if(firm && !it.includes(firm.shortName?.split(' ')[0] || '###')) issues.push('firm name missing in invoice');
    if(issues.length){ problems++; console.log(`✗ ${firm?.shortName} (#${f.firmId}): ${issues.join(', ')}`); }
    else { okCount++; console.log(`✓ ${firm?.shortName} (#${f.firmId}) — talabnoma/ariza/invoice clean (region=${r0.region} area=${r0.area})`); }
  }
  console.log(`\n${okCount} clean, ${problems} with issues`);
  await prisma.$disconnect();
}
main().catch(e=>{console.error(e);process.exit(1);});
