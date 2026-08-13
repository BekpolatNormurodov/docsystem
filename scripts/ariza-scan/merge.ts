import fs from 'node:fs';
const target = 'data/palata-scan.json';
const cur = JSON.parse(fs.readFileSync(target,'utf8'));
const seen = new Set(cur.map((x:any)=>x.pinfl));
let added=0;
for(const f of process.argv.slice(2)){
  for(const x of JSON.parse(fs.readFileSync(f,'utf8'))) if(!seen.has(x.pinfl)){ cur.push(x); seen.add(x.pinfl); added++; }
}
cur.sort((a:any,b:any)=>Number(a.reg)-Number(b.reg));
fs.writeFileSync(target, JSON.stringify(cur,null,1));
console.log('merged +'+added+' → dataset:', cur.length, 'ariza');
