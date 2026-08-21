// MIB (mib.uz) captcha solver — Uzbek worded / numeric math expressions (0..30), solved locally by
// tesseract.js OCR across multiple PSM modes. Ported from tests/src/captcha_solver.js; disk audit
// logging dropped (a long-running worker keeps one shared tesseract worker in memory).
import path from 'node:path';
import os from 'node:os';
import { createWorker, type Worker } from 'tesseract.js';

// Load the OCR language model from a BUNDLED file (tessdata/eng.traineddata), NOT the CDN — the prod
// server can reach mib.uz but its egress may block jsdelivr/unpkg, which would hang createWorker
// forever. gzip:false because the shipped file is uncompressed; cachePath must be writable.
const LANG_PATH = process.env.MIB_TESSDATA_PATH || path.join(process.cwd(), 'tessdata');

interface Ones { val: number; regex: RegExp }
const ONES: Ones[] = [
  { val: 9, regex: /(?:т[ўоo]?[қкk]+|to.?qqiz|tokkiz|toqqiz|tyk|tykk|tykkm|tykkm3)/i },
  { val: 8, regex: /(?:сак|sakkiz|cak|cakk|cakkm|cakkus|cakkms)/i },
  { val: 7, regex: /(?:[еэ]тти|[еэ]ти|ettu|etti|yetti|ett|eTt|eTT|eTTu|eTTH|eTTm)/i },
  { val: 6, regex: /(?:олти|олты|o[jln1]+i?t[a-z0-9]*|olti|ont[a-z0-9]*|oat[a-z0-9]*|ojit[a-z0-9]*|oitu|ontu|onTn|onTM)/i },
  { val: 5, regex: /(?:беш|бэш|6e[lwus]+|be[lwus]+|besh|gew[s]*|6ew|6elu)/i },
  { val: 4, regex: /(?:т[ўоo]рт|t[yuoó]+[rp]+|to.?rt|tort|typt|topt|typT)/i },
  { val: 3, regex: /(?:уч|y4|uy|uch|yч|yu|y4y)/i },
  { val: 2, regex: /(?:икки|ики|ukk|ikk|mkk|vkkm|vkk|mkkn|ukkn)/i },
  { val: 1, regex: /(?:бир|6up|6mp|bir)/i },
];

export class CaptchaSolver {
  private worker: Worker | null = null;
  private ready = false;

  async init(): Promise<void> {
    if (this.ready && this.worker) return;
    // Offline: langPath → bundled tessdata dir, gzip:false (uncompressed file), cachePath → writable tmp.
    this.worker = await createWorker('eng', 1, { langPath: LANG_PATH, gzip: false, cachePath: os.tmpdir() } as never);
    this.ready = true;
  }

  parseSingleNumber(token: string | null): number | null {
    if (!token) return null;
    token = token.trim();
    if (/^\d+$/.test(token)) return parseInt(token, 10);
    if (/(?:нол|нул|nol|zero)/i.test(token)) return 0;
    if (/(?:ўттиз|оттиз|ottiz|o.?ttiz|ytt)/i.test(token)) return 30;
    for (const one of ONES) {
      if (one.regex.test(token)) {
        if (/(?:йигирма|йигир|yigirma|yugurma|yigir|yug)/i.test(token)) return 20 + one.val;
        if (/^(?:ўн|он|on|yn|yh|yн|vh)\s+/i.test(token)) return 10 + one.val;
        return one.val;
      }
    }
    if (/(?:йигирма|йигир|yigirma|yugurma|yigir|yug)/i.test(token)) return 20;
    if (/(?:ўн|он|on|yn|yh|yн|vh)/i.test(token)) return 10;
    const d = token.match(/\d+/);
    if (d) return parseInt(d[0], 10);
    return null;
  }

  evaluateExpression(text: string): string | null {
    if (!text) return null;
    let clean = text.replace(/[€€]/g, 'e').replace(/£/g, 'e').replace(/@/g, 'a').toLowerCase()
      .replace(/[|="?]/g, '').trim();
    let op = '+';
    if (clean.includes('-') || clean.includes('минус') || clean.includes('айириш')) op = '-';
    else if (clean.includes('*') || clean.includes('купайтириш')) op = '*';
    if (!clean.includes('+') && !clean.includes('-') && !clean.includes('*')) {
      clean = clean.replace(/([a-z0-9])t([a-z0-9])/i, '$1+$2');
    }
    const parts = clean.split(/[+\-*/]/);
    if (parts.length >= 2) {
      const n1 = this.parseSingleNumber(parts[0]);
      const n2 = this.parseSingleNumber(parts[1]);
      if (n1 !== null && n2 !== null) {
        if (op === '+') return String(n1 + n2);
        if (op === '-') return String(n1 - n2);
        if (op === '*') return String(n1 * n2);
      }
    }
    const mathMatch = clean.match(/(\d+)\s*([+\-*/])\s*(\d+)/);
    if (mathMatch) {
      const num1 = parseInt(mathMatch[1]!, 10);
      const o = mathMatch[2];
      const num2 = parseInt(mathMatch[3]!, 10);
      if (o === '+') return String(num1 + num2);
      if (o === '-') return String(num1 - num2);
      if (o === '*') return String(num1 * num2);
    }
    return null;
  }

  async solve(imageBuffer: Buffer): Promise<string | null> {
    if (!this.ready) await this.init();
    if (!this.worker) return null;
    let calculated: string | null = null;
    for (const psm of ['8', '7', '3', '11', '6']) {
      await this.worker.setParameters({ tessedit_pageseg_mode: psm as never });
      const ret = await this.worker.recognize(imageBuffer);
      const txt = ret.data.text.trim();
      const ans = this.evaluateExpression(txt);
      if (ans !== null) { calculated = ans; break; }
    }
    return calculated;
  }

  async terminate(): Promise<void> {
    if (this.worker) { await this.worker.terminate(); this.worker = null; this.ready = false; }
  }
}
