/*
 * Browser CAPIWS client for CLIENT-MODE E-IMZO signing.
 *
 * Loaded (via a <script> injected by KeyPicker) only when the server runs with
 * EIMZO_MODE=client. Talks to the USER's OWN local E-IMZO desktop app
 * (wss://127.0.0.1:64443/service/cryptapi) straight from the browser, so the private
 * key + PIN never leave the user's machine and the server only ever sees the finished
 * PKCS7. Mirrors the Node CAPIWS client in src/lib/hippo/eimzo.ts.
 *
 * Protocol quirks replicated:
 *   - ONE socket per call: open -> send one JSON payload on open -> wait for ONE message
 *     -> close. CAPIWS closes the socket after every response.
 *   - SERIALIZE every call through a promise-chain mutex: overlapping sockets deadlock
 *     CAPIWS.
 *   - The browser sets Origin automatically (do NOT set it); rejectUnauthorized does not
 *     apply to a browser WebSocket.
 *   - create_pkcs7 data MUST be base64-of-UTF8: btoa(unescape(encodeURIComponent(data))).
 *   - error convention: success === false (or 'false') -> throw with reason + reason_code.
 *
 * Exposes window.EimzoBrowser = { listKeys(), sign(picked, data, detached), parseAlias() }.
 */
(function () {
  'use strict';

  var WS_URL = 'wss://127.0.0.1:64443/service/cryptapi';

  // Timeouts mirror the Node client. create_pkcs7 waits on the user typing their PIN, so
  // it gets the widest ceiling.
  var T_LIST_DISKS = 12000;
  var T_LIST_CERTS = 18000;
  var T_LOAD_KEY = 18000;
  var T_APIKEY = 20000;
  var T_SIGN = 120000;

  // Serialize EVERY CAPIWS call — at most one socket in flight, ever.
  var chain = Promise.resolve();
  function rpc(payload, timeoutMs) {
    var run = chain.then(function () { return rawRpc(payload, timeoutMs); });
    chain = run.then(function () {}, function () {}); // keep the queue alive past a failed call
    return run;
  }

  function rawRpc(payload, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var settled = false;
      var ws;
      var op = (payload && payload.name) || 'call';
      try {
        ws = new WebSocket(WS_URL); // browser sets Origin itself
      } catch (e) {
        return reject(new Error('E-IMZO ochib boʻlmadi: ' + (e && e.message ? e.message : e)));
      }
      var timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        try { ws.close(); } catch (e) { /* noop */ }
        reject(new Error('E-IMZO ' + op + ' vaqti tugadi (' + Math.round((timeoutMs || 120000) / 1000) + 's)'));
      }, timeoutMs || 120000);
      ws.onopen = function () {
        try { ws.send(JSON.stringify(payload)); }
        catch (e) { if (!settled) { settled = true; clearTimeout(timer); reject(new Error('E-IMZO ga yuborib boʻlmadi: ' + e.message)); } }
      };
      ws.onmessage = function (ev) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        var msg;
        try { msg = JSON.parse(ev.data); }
        catch (e) { try { ws.close(); } catch (e2) { /* noop */ } return reject(new Error('E-IMZO javobi buzuq: ' + ev.data)); }
        try { ws.close(); } catch (e) { /* noop */ }
        if (msg.success === false || msg.success === 'false') {
          reject(new Error('E-IMZO: ' + (msg.reason || 'nomaʼlum xato') + (msg.reason_code != null ? ' (code ' + msg.reason_code + ')' : '')));
        } else {
          resolve(msg);
        }
      };
      ws.onerror = function () {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error('E-IMZO ishga tushmagan (' + WS_URL + ') — dasturni oching va kalitni ulang.'));
      };
    });
  }

  // alias -> parsed cert info (mirrors parseAlias in src/lib/hippo/eimzo.ts).
  function parseAlias(alias) {
    var raw = {};
    String(alias || '').split(',').forEach(function (part) {
      var i = part.indexOf('=');
      if (i > 0) raw[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).trim();
    });
    return {
      raw: raw,
      cn: raw.cn,
      org: raw.o,
      tin: raw['1.2.860.3.16.1.1'],
      pinfl: raw['1.2.860.3.16.1.2'],
      validFrom: raw.validfrom,
      validTo: raw.validto,
    };
  }

  // Domain API-KEY install (optional). A browser on a REAL domain needs a NIC-issued
  // apikey ("domain,hash,domain,hash,..."); on localhost/dev the built-in allowlist covers
  // it, so an empty value is skipped. The page sets window.__EIMZO_API_KEY__ from the
  // build-time NEXT_PUBLIC_EIMZO_API_KEY. Best-effort: a failed install still lets dev
  // localhost work, so we swallow the error.
  var apiKeyDone = false;
  function installApiKey() {
    if (apiKeyDone) return Promise.resolve();
    var val = (typeof window !== 'undefined' && window.__EIMZO_API_KEY__) || '';
    var args = String(val).split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    if (!args.length) { apiKeyDone = true; return Promise.resolve(); }
    return rpc({ plugin: 'apikey', name: 'install_api_keys', arguments: args }, T_APIKEY)
      .then(function () { apiKeyDone = true; })
      .catch(function () { apiKeyDone = true; /* dev/localhost allowlist covers it */ });
  }

  // Enumerate every key visible to the USER's E-IMZO (scans each disk's DSKEYS). A single
  // stuck/empty disk is skipped, not fatal — mirrors listAllKeys in the Node client.
  function listKeys() {
    return installApiKey()
      .then(function () { return rpc({ plugin: 'pfx', name: 'list_disks' }, T_LIST_DISKS); })
      .then(function (dr) {
        var disks = (dr && dr.disks) || [];
        var out = [];
        return disks.reduce(function (p, disk) {
          return p.then(function () {
            return rpc({ plugin: 'pfx', name: 'list_certificates', arguments: [disk] }, T_LIST_CERTS)
              .then(function (cr) {
                var certs = (cr && cr.certificates) || [];
                certs.forEach(function (c) {
                  var info = parseAlias(c.alias);
                  out.push({
                    disk: c.disk, path: c.path, name: c.name, alias: c.alias,
                    cn: info.cn || null, org: info.org || null, tin: info.tin || null, pinfl: info.pinfl || null,
                    validFrom: info.validFrom || null, validTo: info.validTo || null,
                  });
                });
              })
              .catch(function () { /* skip this disk, continue enumerating */ });
          });
        }, Promise.resolve()).then(function () { return out; });
      });
  }

  function toB64Utf8(data) {
    return btoa(unescape(encodeURIComponent(String(data == null ? '' : data))));
  }

  // Load the chosen key, then create the PKCS7 (this triggers E-IMZO's native PIN dialog
  // on the USER's machine). `detached` = 'yes' for hippo (signature only), 'no' for
  // cabinet (challenge). Returns pkcs7_64.
  function sign(picked, data, detached) {
    if (!picked || !picked.disk || !picked.path || !picked.name) {
      return Promise.reject(new Error('Kalit tanlanmagan'));
    }
    var det = detached === 'no' ? 'no' : 'yes';
    return installApiKey()
      .then(function () {
        return rpc({ plugin: 'pfx', name: 'load_key', arguments: [picked.disk, picked.path, picked.name, picked.alias] }, T_LOAD_KEY);
      })
      .then(function (lk) {
        var keyId = lk && lk.keyId;
        if (!keyId) throw new Error('load_key: keyId qaytmadi');
        return rpc({ plugin: 'pkcs7', name: 'create_pkcs7', arguments: [toB64Utf8(data), keyId, det] }, T_SIGN);
      })
      .then(function (r) {
        var pkcs7 = r && r.pkcs7_64;
        if (!pkcs7) throw new Error('create_pkcs7: pkcs7_64 qaytmadi');
        return pkcs7;
      });
  }

  window.EimzoBrowser = { listKeys: listKeys, sign: sign, parseAlias: parseAlias };
})();
