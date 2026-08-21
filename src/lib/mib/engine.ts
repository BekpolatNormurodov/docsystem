// mib.uz automation engine — pure server-side HTTP (fetch) driving the site's Apache Wicket AJAX
// endpoints. Faithful port of tests/src/mib_engine.js (debug disk writes removed, TS types added).
// Flow: initSession → getDebtSearchPage → searchDebtsByPinfl (captcha) → [per case] prepareAndRequestSms
// (captcha) → submitSmsCode (OTP) → fetchExecutionDetails (Step 19).
import { CaptchaSolver } from './captcha';

const REDIRECTS = [301, 302, 303, 307, 308];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface Step10Case { workNumber: string; monitoringUrl: string | null }
export interface Step10Result {
  success: boolean;
  message?: string;
  pinfl?: string;
  fio?: string;
  totalDebt?: string;
  currentDebt?: string;
  cases?: Step10Case[];
  step10Url?: string;
}
export interface Step19Details {
  success: boolean;
  personFullName: string;
  creditor: string;
  executor: { name: string; phone: string; department: string };
  court: { organ: string; docType: string; docNumber: string; docDate: string; effectiveDate: string; subject: string };
  mibDates: { receivedDate: string; initiatedDate: string };
  financials: { totalAmount: string; mainDebt: string; executionFee: string; fine: string; remainingDebt: string };
  bankReceipt: { bankName: string; mfo: string; accountNumber: string };
  decisions: { article: string; date: string }[];
}

export class MibEngine {
  baseUrl: string;
  cookies = new Map<string, string>();
  jsessionid = '';
  captchaSolver: CaptchaSolver;
  private log: (m: string) => void;

  constructor(baseUrl = 'https://mib.uz', opts: { captcha?: CaptchaSolver; log?: (m: string) => void } = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.captchaSolver = opts.captcha ?? new CaptchaSolver();
    this.log = opts.log ?? (() => {});
  }

  private updateCookies(response: Response): void {
    const anyHeaders = response.headers as unknown as { getSetCookie?: () => string[] };
    const setCookieHeaders = anyHeaders.getSetCookie
      ? anyHeaders.getSetCookie()
      : [response.headers.get('set-cookie')].filter(Boolean) as string[];
    for (const header of setCookieHeaders) {
      const parts = header.split(';')[0]!.split('=');
      if (parts.length >= 2) {
        const key = parts[0]!.trim();
        const value = parts.slice(1).join('=').trim();
        this.cookies.set(key, value);
        if (key.toUpperCase() === 'JSESSIONID') this.jsessionid = value;
      }
    }
  }

  private getCookieHeader(): string {
    return Array.from(this.cookies.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
  }

  async request(url: string, options: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<Response> {
    let targetUrl: string;
    if (url.startsWith('http')) targetUrl = url;
    else if (url.startsWith('/')) targetUrl = `${this.baseUrl}${url}`;
    else targetUrl = `${this.baseUrl}/${url}`;

    const headers: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept-Language': 'uz,ru;q=0.9,en;q=0.8',
      'Cookie': this.getCookieHeader(),
      ...(options.headers || {}),
    };
    if (options.body && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
    }
    const response = await fetch(targetUrl, {
      method: options.method || 'GET',
      headers,
      body: options.body,
      redirect: 'manual',
    });
    this.updateCookies(response);
    return response;
  }

  async initSession(): Promise<{ jsessionid: string; homeHtml: string }> {
    const res = await this.request('');
    let homeUrl = '/home';
    if (REDIRECTS.includes(res.status)) {
      const loc = res.headers.get('location');
      if (loc) {
        homeUrl = loc;
        const m = loc.match(/jsessionid=([A-Za-z0-9]+)/i);
        if (m) { this.jsessionid = m[1]!; this.cookies.set('JSESSIONID', this.jsessionid); }
      }
    }
    const homeRes = await this.request(homeUrl);
    const homeHtml = await homeRes.text();
    return { jsessionid: this.jsessionid, homeHtml };
  }

  async getDebtSearchPage(homeHtml: string): Promise<string> {
    const menuLinkMatch = homeHtml.match(/href="([^"]*)"[^>]*>\s*Қарздорликни текшириш/i)
      || homeHtml.match(/href="(\.\.?\/[^"]+)"[^>]*>\s*Қарздорликни текшириш/i);
    const pageUrl = menuLinkMatch ? menuLinkMatch[1]! : 'home';
    let currentUrl = new URL(pageUrl, `${this.baseUrl}/home`).href;
    let pageRes = await this.request(currentUrl, { headers: { Referer: `${this.baseUrl}/home` } });
    let pageHtml = await pageRes.text();

    while (REDIRECTS.includes(pageRes.status)) {
      const loc = pageRes.headers.get('location');
      if (!loc) break;
      const prevUrl = currentUrl;
      currentUrl = new URL(loc, currentUrl).href;
      pageRes = await this.request(currentUrl, { headers: { Referer: prevUrl } });
      pageHtml = await pageRes.text();
    }

    const metaRefreshMatch = pageHtml.match(/<meta[^>]*http-equiv=["']refresh["'][^>]*content=["'][^"']*url=([^"']+)["']/i);
    if (metaRefreshMatch) {
      const prevUrl = currentUrl;
      currentUrl = new URL(metaRefreshMatch[1]!.trim(), currentUrl).href;
      pageRes = await this.request(currentUrl, { headers: { Referer: prevUrl } });
      pageHtml = await pageRes.text();
      while (REDIRECTS.includes(pageRes.status)) {
        const loc = pageRes.headers.get('location');
        if (!loc) break;
        const pUrl = currentUrl;
        currentUrl = new URL(loc, currentUrl).href;
        pageRes = await this.request(currentUrl, { headers: { Referer: pUrl } });
        pageHtml = await pageRes.text();
      }
    }
    return pageHtml;
  }

  async searchDebtsByPinfl(pinfl: string, debtPageHtml: string): Promise<Step10Result> {
    const baseMatch = debtPageHtml.match(/Wicket\.Ajax\.baseUrl="([^"]*)";/);
    const baseUrl = baseMatch ? baseMatch[1]! : '';
    const tabMatch = debtPageHtml.match(/id="tab_pinfl"[\s\S]*?<\/form>/i);
    const tabHtml = tabMatch ? tabMatch[0] : debtPageHtml;
    const formId = (tabHtml.match(/<form[^>]*id="([^"]+)"/i) || [])[1] || 'id7';
    const buttonId = (tabHtml.match(/<button[^>]*id="([^"]+)"/i) || [])[1] || 'id8';

    let ajaxUrl: string | null = null;
    const formHandlerMatch = debtPageHtml.match(new RegExp(`Wicket\\.Ajax\\.ajax\\(\\{"u":"([^"]+)".*?"f":"${formId}"`));
    if (formHandlerMatch) ajaxUrl = formHandlerMatch[1]!;
    else {
      const btnMatch = debtPageHtml.match(new RegExp(`Wicket\\.Ajax\\.ajax\\(\\{"u":"([^"]+)".*?"c":"${buttonId}"`));
      if (btnMatch) ajaxUrl = btnMatch[1]!;
    }
    if (!ajaxUrl) {
      const actionMatch = tabHtml.match(/<form[^>]*action="([^"]*)"/i);
      ajaxUrl = actionMatch ? actionMatch[1]! : null;
    }
    if (!ajaxUrl) throw new Error('Wicket PINFL AJAX yoki Form URL topilmadi.');
    const cleanAjaxUrl = new URL(ajaxUrl, `${this.baseUrl}/${baseUrl}`).href;

    let currentCaptchaImg: string | null = null;
    const captchaImgMatch = tabHtml.match(/<img[^>]*alt="Защитный код"[^>]*src="([^"]+)"/i) || tabHtml.match(/<img[^>]*src="([^"]+)"/i);
    if (captchaImgMatch) currentCaptchaImg = new URL(captchaImgMatch[1]!.replace(/&amp;/g, '&'), `${this.baseUrl}/${baseUrl}`).href;

    for (let attempt = 1; attempt <= 5; attempt++) {
      let secureCode: string | null = null;
      if (currentCaptchaImg) {
        try {
          const imgRes = await this.request(currentCaptchaImg);
          const imgBuffer = Buffer.from(await imgRes.arrayBuffer());
          secureCode = await this.captchaSolver.solve(imgBuffer);
        } catch (e) { this.log(`captcha load err: ${(e as Error).message}`); }
      }

      if (!secureCode) {
        this.log(`[captcha ${attempt}/5] unrecognized, refreshing`);
        const captchaLinkId = (debtPageHtml.match(/<a class="captcha[^"]*" id="([^"]+)"/i) || [])[1] || 'id6';
        const refreshMatch = debtPageHtml.match(new RegExp(`Wicket\\.Ajax\\.ajax\\(\\{"u":"([^"]+)".*?"c":"${captchaLinkId}"`))
          || debtPageHtml.match(/Wicket\.Ajax\.ajax\(\{"u":"([^"]+)".*?"c":"id6"/);
        if (refreshMatch) {
          try {
            const refUrl = new URL(refreshMatch[1]!, `${this.baseUrl}/${baseUrl}`).href;
            const refRes = await this.request(refUrl, { headers: { 'wicket-ajax': 'true', 'wicket-ajax-baseurl': baseUrl, 'x-requested-with': 'XMLHttpRequest', Referer: `${this.baseUrl}/${baseUrl}` } });
            const refXml = await refRes.text();
            const newImg = refXml.match(/src="([^"]*antiCache=[^"]*)"/i) || refXml.match(/<img[^>]*src="([^"]+)"/i);
            if (newImg) currentCaptchaImg = new URL(newImg[1]!.replace(/&amp;/g, '&'), `${this.baseUrl}/${baseUrl}`).href;
          } catch { /* ignore */ }
        }
        await sleep(1000);
        continue;
      }

      const postBody = new URLSearchParams({ [`${formId}_hf_0`]: '', pinfl: pinfl.trim(), secure_code: String(secureCode).trim(), submit_button: '1' }).toString();
      const postRes = await this.request(cleanAjaxUrl, {
        method: 'POST',
        headers: { 'wicket-ajax': 'true', 'wicket-ajax-baseurl': baseUrl, 'x-requested-with': 'XMLHttpRequest', Referer: `${this.baseUrl}/${baseUrl}` },
        body: postBody,
      });
      const ajaxXml = await postRes.text();
      const redirectMatch = ajaxXml.match(/<redirect><!\[CDATA\[([^\]]+)\]\]><\/redirect>/i) || postRes.headers.get('ajax-location');
      const resultPath = (typeof redirectMatch === 'string' ? redirectMatch : redirectMatch?.[1]) || '';
      if (resultPath) {
        const cleanResultPath = new URL(resultPath, `${this.baseUrl}/${baseUrl}`).href;
        const resultRes = await this.request(cleanResultPath);
        const resultHtml = await resultRes.text();
        return this.parseStep10Results(resultHtml, cleanResultPath, pinfl);
      }
      const newImgMatch = ajaxXml.match(/src="([^"]*antiCache=[^"]*)"/i) || ajaxXml.match(/<img[^>]*src="([^"]+)"/i);
      if (newImgMatch) currentCaptchaImg = new URL(newImgMatch[1]!.replace(/&amp;/g, '&'), `${this.baseUrl}/${baseUrl}`).href;
      await sleep(1000);
    }
    return { success: false, message: 'Captcha 5 marta urinishda ham yechilmadi yoki PINFL bo‘yicha qarz yo‘q' };
  }

  parseStep10Results(html: string, resultPath: string, pinfl: string): Step10Result {
    const totalDebt = (html.match(/Умумий қарздорлик:\s*<\/label>\s*<label[^>]*>([^<]+)<\/label>/i) || [])[1] || '0';
    const currentDebt = (html.match(/Жорий қарздорлик:\s*<\/label>\s*<label[^>]*>([^<]+)<\/label>/i) || [])[1] || '0';
    const fio = (html.match(/ФИО\s*<\/span>\s*<label[^>]*>([^<]+)<\/label>/i) || [])[1] || '';
    const workNumbers: string[] = [];
    const generalWnRegex = /<span>\s*Ижро иши рақами\s*<\/span>\s*<label[^>]*>(\d+)<\/label>/gi;
    let match: RegExpExecArray | null;
    while ((match = generalWnRegex.exec(html)) !== null) {
      if (!workNumbers.includes(match[1]!)) workNumbers.push(match[1]!);
    }
    const linkMatches = html.match(/<a\s+href="([^"]+)"\s+class="to-monitoring"/gi) || [];
    const monitoringLinks = linkMatches.map((l) => {
      const hrefMatch = l.match(/href="([^"]+)"/i);
      return hrefMatch ? hrefMatch[1]!.replace(/^\.\.\//, '') : '';
    });
    const cases: Step10Case[] = workNumbers.map((wn, i) => ({ workNumber: wn, monitoringUrl: monitoringLinks[i] || monitoringLinks[0] || null }));
    return { success: true, pinfl, fio: fio.trim(), totalDebt: totalDebt.trim(), currentDebt: currentDebt.trim(), cases, step10Url: resultPath };
  }

  async prepareAndRequestSms(monitoringUrl: string, pinfl: string, workNumber: string, phone: string): Promise<{ success: boolean; step16Url: string; verifyFormAction: string }> {
    let res = await this.request(monitoringUrl);
    let html = await res.text();
    while (REDIRECTS.includes(res.status)) {
      const loc = res.headers.get('location');
      if (!loc) break;
      const nextUrl = new URL(loc, res.url || `${this.baseUrl}/`).href;
      res = await this.request(nextUrl);
      html = await res.text();
    }
    const baseMatch = html.match(/Wicket\.Ajax\.baseUrl="([^"]*)";/);
    const baseUrl = baseMatch ? baseMatch[1]! : '';
    const digits = phone.replace(/\D/g, '');
    const cleanDigits = digits.startsWith('998') ? digits.substring(3) : digits;
    const formattedPhone = `(${cleanDigits.substring(0, 2)}) ${cleanDigits.substring(2, 5)} ${cleanDigits.substring(5, 7)} ${cleanDigits.substring(7, 9)}`;
    const formMatch = html.match(/<form[^>]*id="pinfl_form"[\s\S]*?<\/form>/i);
    const formHtml = formMatch ? formMatch[0] : html;
    const formActionMatch = formHtml.match(/<form[^>]*action="([^"]*)"/i);
    const rawAction = formActionMatch ? formActionMatch[1]! : '';
    const formActionUrl = new URL(rawAction, `${this.baseUrl}/${baseUrl}`).href;

    let currentCaptchaImg: string | null = null;
    const captchaMatch = formHtml.match(/<img[^>]*alt="Защитный код"[^>]*src="([^"]+)"/i) || formHtml.match(/<img[^>]*src="([^"]+)"/i);
    if (captchaMatch) currentCaptchaImg = new URL(captchaMatch[1]!.replace(/&amp;/g, '&'), `${this.baseUrl}/${baseUrl}`).href;

    for (let attempt = 1; attempt <= 5; attempt++) {
      let secureCode: string | null = null;
      if (currentCaptchaImg) {
        try {
          const imgRes = await this.request(currentCaptchaImg);
          const imgBuffer = Buffer.from(await imgRes.arrayBuffer());
          secureCode = await this.captchaSolver.solve(imgBuffer);
        } catch (e) { this.log(`monitoring captcha err: ${(e as Error).message}`); }
      }
      if (!secureCode) {
        const linkId = (formHtml.match(/<a class="captcha[^"]*" id="([^"]+)"/i) || [])[1] || 'id1d';
        const refreshMatch = html.match(new RegExp(`Wicket\\.Ajax\\.ajax\\(\\{"u":"([^"]+)".*?"c":"${linkId}"`));
        if (refreshMatch) {
          try {
            const refUrl = new URL(refreshMatch[1]!, `${this.baseUrl}/${baseUrl}`).href;
            const refRes = await this.request(refUrl, { headers: { 'wicket-ajax': 'true', 'wicket-ajax-baseurl': baseUrl, 'x-requested-with': 'XMLHttpRequest', Referer: `${this.baseUrl}/${baseUrl}` } });
            const refXml = await refRes.text();
            const newImg = refXml.match(/src="([^"]*antiCache=[^"]*)"/i) || refXml.match(/<img[^>]*src="([^"]+)"/i);
            if (newImg) currentCaptchaImg = new URL(newImg[1]!.replace(/&amp;/g, '&'), `${this.baseUrl}/${baseUrl}`).href;
          } catch { /* ignore */ }
        }
        await sleep(1000);
        continue;
      }
      const postBody = new URLSearchParams({ submit_button: 'x', pinfl: pinfl.trim(), work_number: workNumber.trim(), phone: formattedPhone, secure_code: String(secureCode).trim() }).toString();
      const postRes = await this.request(formActionUrl, {
        method: 'POST',
        headers: { Origin: this.baseUrl, 'Content-Type': 'application/x-www-form-urlencoded', Referer: `${this.baseUrl}/${baseUrl}` },
        body: postBody,
      });
      const location = postRes.headers.get('location');
      if (location || [301, 302, 303].includes(postRes.status)) {
        const step16Url = new URL(location || '', formActionUrl).href;
        const step16Res = await this.request(step16Url);
        const step16Html = await step16Res.text();
        const verifyFormMatch = step16Html.match(/<form[^>]*id="verify_form"[^>]*action="([^"]*)"/i)
          || step16Html.match(/<form[^>]*action="([^"]*)"[^>]*id="verify_form"/i);
        const rawVerifyAction = verifyFormMatch ? verifyFormMatch[1]! : '';
        const verifyFormAction = new URL(rawVerifyAction, step16Url).href;
        return { success: true, step16Url, verifyFormAction };
      }
      const errHtml = await postRes.text();
      const newImg = errHtml.match(/<form[^>]*id="pinfl_form"[\s\S]*?<img[^>]*src="([^"]+)"/i) || errHtml.match(/src="([^"]*antiCache=[^"]*)"/i);
      if (newImg) currentCaptchaImg = new URL(newImg[1]!.replace(/&amp;/g, '&'), formActionUrl).href;
      await sleep(1000);
    }
    throw new Error('Monitoring Captcha 5 marta urinishda ham yechilmadi.');
  }

  async submitSmsCode(verifyFormAction: string, verifyCode: string): Promise<string> {
    const postBody = new URLSearchParams({ submit_button: 'x', verify_code: String(verifyCode).trim() }).toString();
    const res = await this.request(verifyFormAction, {
      method: 'POST',
      headers: { Origin: this.baseUrl, 'Content-Type': 'application/x-www-form-urlencoded', Referer: verifyFormAction },
      body: postBody,
    });
    const location = res.headers.get('location');
    if (!location) throw new Error(`SMS kod noto'g'ri yoki tasdiqlanmadi. Status: ${res.status}`);
    return new URL(location, verifyFormAction).href;
  }

  async fetchExecutionDetails(step19Url: string): Promise<Step19Details> {
    let res = await this.request(step19Url);
    let html = await res.text();
    while (REDIRECTS.includes(res.status)) {
      const loc = res.headers.get('location');
      if (!loc) break;
      const nextUrl = new URL(loc, res.url || step19Url).href;
      res = await this.request(nextUrl);
      html = await res.text();
    }
    return this.parseStep19Details(html);
  }

  parseStep19Details(html: string): Step19Details {
    const extractField = (pattern: string): string | null => {
      const m1 = html.match(new RegExp(`<div class="exec-item[^"]*"[\\s\\S]*?<p>[\\s\\S]*?${pattern}[\\s\\S]*?<\\/p>\\s*<label[^>]*>([^<]+)<\\/label>`, 'i'));
      if (m1 && m1[1] && m1[1].trim()) return m1[1].replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
      const m2 = html.match(new RegExp(`(?:<p[^>]*>|<span>|<th>|<td>)[\\s\\S]*?${pattern}[\\s\\S]*?(?:<\\/p>|<\\/span>|<\\/th>|<\\/td>)\\s*<(?:label|td|strong|b|span)[^>]*>([^<]+)<\\/`, 'i'));
      if (m2 && m2[1] && m2[1].trim()) return m2[1].replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
      return null;
    };
    const extractSimpleList = (pattern: string): string | null => {
      const match = html.match(new RegExp(`<li>[\\s\\S]*?<span>[\\s\\S]*?${pattern}[\\s\\S]*?<\\/span>\\s*<strong>([^<]+)<\\/strong>`, 'i'));
      if (match && match[1]) return match[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      return null;
    };
    const unmaskedNameMatch = html.match(/Тўловчининг номи[^\n<]*<\/td>\s*<td[^>]*>([^<]+)<\/td>/i) || html.match(/Тўловчининг номи[^\n<]*\n\s*([^<\n]+)/i);
    let personFullName = unmaskedNameMatch ? unmaskedNameMatch[1]!.trim() : null;
    if (!personFullName || personFullName.includes('***')) {
      const debtorField = extractField('Қарздор');
      if (debtorField && !debtorField.includes('***')) personFullName = debtorField;
      else if (!personFullName) personFullName = debtorField;
    }
    const creditorName = extractField('Ундирувчи');
    const formatPhone = (raw: string | null): string => {
      if (!raw) return 'Nomaʼlum';
      let digits = raw.replace(/\D/g, '');
      if (!digits) return raw.trim();
      while (digits.startsWith('998998')) digits = digits.substring(3);
      if (digits.startsWith('998') && digits.length === 12) digits = digits.substring(3);
      if (digits.length === 9) return `+998 (${digits.substring(0, 2)}) ${digits.substring(2, 5)}-${digits.substring(5, 7)}-${digits.substring(7, 9)}`;
      if (digits.length > 9) { const l = digits.slice(-9); return `+998 (${l.substring(0, 2)}) ${l.substring(2, 5)}-${l.substring(5, 7)}-${l.substring(7, 9)}`; }
      return raw.trim();
    };
    const executorName = extractField('Давлат ижрочиси');
    const executorPhone = formatPhone(extractField('Ижрочи телефони'));
    const department = extractField('Бўлим') || (html.match(/ПАТТА\/КВИТАНЦИЯ[\s\S]*?<td colspan="7">([^<]+)<\/td>/i) || [])[1] || null;
    const courtOrgan = extractField('Ким томондан ижрога юборилган') || extractField('Суд');
    const courtDocType = extractField('Ижро варақа тури') || 'Ijro varaqasi';
    const courtDocNumber = extractField('И[\\/ҳ\\s]*рақами');
    const courtDocDate = extractField('И[\\/ҳ\\s]*санаси');
    const courtEffectiveDate = extractField('Қонуний кучга кирган сана');
    const caseSubject = extractField('И[\\/ҳ\\s]*мазмуни') || (html.match(/Тўлов мақсади[^\n<]*<\/td>\s*<td[^>]*>([^<]+)<\/td>/i) || [])[1] || 'Qarzdorlik';
    const mibReceivedDate = extractField('МИБ га келиб тушган сана') || extractField('келиб тушган сана');
    const mibInitiatedDate = extractField('қўзғатиш санаси') || extractField('Ижро иши юритувни қўзғатиш санаси');
    const totalAmount = (html.match(/И\/Ҳ кўрсатилган сумма<\/p>\s*<label>([^<]+)<\/label>/i) || [])[1] || extractSimpleList('Асосий қарздорлик') || '0.00';
    const mainDebt = extractSimpleList('Асосий қарздорлик') || totalAmount || '0.00';
    const executionFee = extractSimpleList('Ижро йиғими') || '0.00';
    const fine = extractSimpleList('Жарима') || '0.00';
    const remainingDebt = (html.match(/Қарздорлик қолдиғи<\/p>\s*<label>([^<]+)<\/label>/i) || [])[1] || mainDebt || '0.00';
    const bankName = (html.match(/Банк номи[^\n<]*<\/td>\s*<td[^>]*>([^<]+)<\/td>/i) || [])[1] || (html.match(/Банк номи[^\n<]*\n\s*([^<\n]+)/i) || [])[1] || null;
    const mfo = (html.match(/БММ рақами \/ МФО[\s\S]*?(\d{5})/i) || [])[1] || (html.match(/МФО\s*(\d{5})/i) || [])[1] || null;
    const accountNumber = (html.match(/ҳ\/р[^\n<]*\n\s*(\d{20})/i) || [])[1] || (html.match(/(\d{20})/i) || [])[1] || null;
    const decisions: { article: string; date: string }[] = [];
    const decRegex = /(\d+-Модда[^\n<]+)\s*<\/td>\s*<td>\s*([\d.]+)/gi;
    let dMatch: RegExpExecArray | null;
    while ((dMatch = decRegex.exec(html)) !== null) decisions.push({ article: dMatch[1]!.trim(), date: dMatch[2]!.trim() });
    if (decisions.length === 0) {
      const decRegex2 = /(\d+-Модда[^\n<]+)\s*<br\s*\/?>\s*([\d.]+)/gi;
      while ((dMatch = decRegex2.exec(html)) !== null) decisions.push({ article: dMatch[1]!.trim(), date: dMatch[2]!.trim() });
    }
    return {
      success: true,
      personFullName: personFullName || 'Nomaʼlum',
      creditor: creditorName ? creditorName.replace(/&quot;/g, '"').trim() : 'Nomaʼlum',
      executor: { name: executorName || 'Nomaʼlum', phone: executorPhone || 'Nomaʼlum', department: department || 'Nomaʼlum' },
      court: { organ: courtOrgan || 'Nomaʼlum', docType: courtDocType || 'Ijro varaqasi', docNumber: courtDocNumber || 'Nomaʼlum', docDate: courtDocDate || 'Nomaʼlum', effectiveDate: courtEffectiveDate || 'Nomaʼlum', subject: caseSubject || 'Qarzdorlik' },
      mibDates: { receivedDate: mibReceivedDate || 'Nomaʼlum', initiatedDate: mibInitiatedDate || 'Nomaʼlum' },
      financials: {
        totalAmount: totalAmount ? totalAmount.replace(/\s+/g, ' ').trim() : '0.00',
        mainDebt: mainDebt ? mainDebt.replace(/\s+/g, ' ').trim() : '0.00',
        executionFee: executionFee ? executionFee.replace(/\s+/g, ' ').trim() : '0.00',
        fine: fine ? fine.replace(/\s+/g, ' ').trim() : '0.00',
        remainingDebt: remainingDebt ? remainingDebt.replace(/\s+/g, ' ').trim() : '0.00',
      },
      bankReceipt: { bankName: bankName ? bankName.replace(/&quot;/g, '"').trim() : 'Nomaʼlum', mfo: mfo || 'Nomaʼlum', accountNumber: accountNumber || 'Nomaʼlum' },
      decisions,
    };
  }
}
