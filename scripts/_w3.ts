import { formatSumDecimal } from '@/core/document';
import { computeTotalDebt } from '@/core/portfolio';
import { cleanTail, mapRegion } from '@/core/address';
// formatSumDecimal
console.log('100.5   ->', formatSumDecimal('100.5'), '(exp 100,50)');
console.log('100.05  ->', formatSumDecimal('100.05'), '(exp 100,05)');
console.log('whole   ->', formatSumDecimal('1000000'), '(exp 1 000 000)');
// portfolio locale num
console.log('debt "12 345,67"+"1 000" ->', computeTotalDebt({summ_ost_ze:'12 345,67',summ_ostpr_ze:'1 000',sumproc_eqv:0,sumnachpr_eqv:0}), '(exp 13345.67)');
// cabinet PAID regex logic (inline replicate)
const paidCheck = (st:string)=> (/(^|[^A-Z])(PAID|PAYED|TOLANGAN|OPLAT)/.test(st.toUpperCase()) && !/NOT[_ ]?PAID|UNPAID|TOLANMAGAN/.test(st.toUpperCase()));
for(const s of ['PAID','NOT_PAID','UNPAID','TOLANGAN','TOLANMAGAN','OPLACHENO']) console.log(`  paid("${s}") = ${paidCheck(s)}`);
// address SH
console.log('SH street ->', cleanTail('Toshkent obl, Bekobod rayon, SH. RUSTAVELI KUCHASI'));
console.log('NAVOI SH  ->', cleanTail('Navoiy obl, Navbahor rayon, NAVOI SH.'));
console.log('Qashqa 1N ->', mapRegion('КАШКАДАРЬИНСКАЯ ОБЛАСТЬ'));
