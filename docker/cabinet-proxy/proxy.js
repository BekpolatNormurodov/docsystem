// Minimal HTTP CONNECT forward proxy. Runs with network_mode:host so its egress
// takes the HOST's network path (which reaches *.sud.uz reliably), unlike the
// docsystem_default bridge network (web/worker containers), which reaches
// cabinetapi.sud.uz only intermittently — same public IP, but the bridge's NAT
// path is refused/timed out by the remote far more often than the host's own path.
// Only forwards HTTP CONNECT (HTTPS tunneling); plain HTTP is not needed here.
//
// UPSTREAM_PROXY (optional, "host:port"): when the HOST's OWN public IP is blocked
// by *.sud.uz (2026-09: the whole prod IP stopped routing to cabinetapi/billing),
// chain each CONNECT through another CONNECT proxy that CAN reach *.sud.uz — e.g. a
// reverse-SSH tunnel to a laptop/VPS with a good IP. Unset → dial directly (original
// behavior). This keeps ALL routing decisions here; callers (CABINET_PROXY_URL) are
// unchanged whether egress is direct or relocated.
const net = require('node:net');
const http = require('node:http');

const PORT = Number(process.env.PORT || 3128);
// Only these hosts may be tunneled through — this proxy exists SOLELY for cabinet.sud.uz
// traffic; refusing everything else keeps its blast radius to that one purpose.
const ALLOW = /(^|\.)sud\.uz$/i;
// Optional upstream CONNECT proxy ("host:port"): relocate egress through a good-IP path.
const UPSTREAM = (process.env.UPSTREAM_PROXY || '').trim();

const server = http.createServer((req, res) => {
  res.writeHead(405, { 'Content-Type': 'text/plain' });
  res.end('Only CONNECT is supported by this proxy.\n');
});

// Dial the destination directly from this host's own network path.
function connectDirect(host, port, clientSocket, head) {
  const upstream = net.connect(port, host, () => {
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    upstream.write(head);
    upstream.pipe(clientSocket);
    clientSocket.pipe(upstream);
  });
  upstream.on('error', () => clientSocket.destroy());
  clientSocket.on('error', () => upstream.destroy());
}

// Chain the CONNECT through another CONNECT proxy (UPSTREAM) that can reach the target.
function connectViaUpstream(host, port, clientSocket, head) {
  const [uh, upStr] = UPSTREAM.split(':');
  const uHost = uh || '127.0.0.1';
  const uPort = Number(upStr) || 3128;
  const up = net.connect(uPort, uHost, () => {
    up.write(`CONNECT ${host}:${port} HTTP/1.1\r\nHost: ${host}:${port}\r\n\r\n`);
  });
  let established = false;
  let buf = Buffer.alloc(0);
  up.on('data', (chunk) => {
    if (established) return;
    buf = Buffer.concat([buf, chunk]);
    const idx = buf.indexOf('\r\n\r\n');
    if (idx === -1) return; // wait for the full CONNECT response header
    const header = buf.slice(0, idx).toString('utf8');
    if (!/^HTTP\/1\.[01] 200/.test(header)) { clientSocket.destroy(); up.destroy(); return; }
    established = true;
    const rest = buf.slice(idx + 4); // any bytes after the header belong to the tunnel
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head && head.length) up.write(head);
    if (rest.length) clientSocket.write(rest);
    up.pipe(clientSocket);
    clientSocket.pipe(up);
  });
  up.on('error', () => clientSocket.destroy());
  clientSocket.on('error', () => up.destroy());
}

server.on('connect', (req, clientSocket, head) => {
  const [host, portStr] = (req.url || '').split(':');
  const port = Number(portStr) || 443;
  if (!host || !ALLOW.test(host)) {
    clientSocket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    clientSocket.destroy();
    return;
  }
  if (UPSTREAM) connectViaUpstream(host, port, clientSocket, head);
  else connectDirect(host, port, clientSocket, head);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[cabinet-proxy] CONNECT proxy listening on :${PORT} (allow: *.sud.uz)${UPSTREAM ? ` via upstream ${UPSTREAM}` : ''}`);
});
