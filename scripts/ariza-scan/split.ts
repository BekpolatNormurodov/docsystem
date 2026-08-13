import fs from 'node:fs'; import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
async function main(){
  const src=process.argv[2], outDir=process.argv[3], per=Number(process.argv[4]||15);
  const bytes=fs.readFileSync(src);
  const doc=await PDFDocument.load(bytes,{updateMetadata:false});
  const total=doc.getPageCount();
  console.log('total pages:',total,'| per chunk:',per);
  let ci=0;
  for(let start=0;start<total;start+=per){
    ci++;
    const out=await PDFDocument.create();
    const idx=Array.from({length:Math.min(per,total-start)},(_,i)=>start+i);
    const pages=await out.copyPages(doc,idx);
    pages.forEach(p=>out.addPage(p));
    const buf=await out.save();
    const name=`chunk_${String(ci).padStart(3,'0')}_p${start+1}-${start+idx.length}.pdf`;
    fs.writeFileSync(path.join(outDir,name),buf);
    console.log('  wrote',name,`(${Math.round(buf.length/1024/1024*10)/10}MB)`);
  }
}
main().catch(e=>{console.error(e.message);process.exit(1);});
