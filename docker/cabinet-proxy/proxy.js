// Minimal HTTP CONNECT forward proxy. Runs with network_mode:host so its egress
// takes the HOST's network path (which reaches *.sud.uz reliably), unlike the
// docsystem_default bridge network (web/worker containers), which reaches
// cabinetapi.sud.uz only intermittently — same public IP, but the bridge's NAT
// path is refused/timed out by the remote far more often than the host's own path.
// Only forwards HTTP CONNECT (HTTPS tunneling); plain HTTP is not needed here.
const net = require('node:net');
const http = require('node:http');

const PORT = Number(process.env.PORT || 3128);
// Only these hosts may be tunneled through — this proxy exists SOLELY for cabinet.sud.uz
// traffic; refusing everything else keeps its blast radius to that one purpose.
const ALLOW = /(^|\.)sud\.uz$/i;

const server = http.createServer((req, res) => {
  res.writeHead(405, { 'Content-Type': 'text/plain' });
  res.end('Only CONNECT is supported by this proxy.\n');
});

server.on('connect', (req, clientSocket, head) => {
  const [host, portStr] = (req.url || '').split(':');
  const port = Number(portStr) || 443;
  if (!host || !ALLOW.test(host)) {
    clientSocket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    clientSocket.destroy();
    return;
  }
  const upstream = net.connect(port, host, () => {
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    upstream.write(head);
    upstream.pipe(clientSocket);
    clientSocket.pipe(upstream);
  });
  upstream.on('error', () => clientSocket.destroy());
  clientSocket.on('error', () => upstream.destroy());
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[cabinet-proxy] CONNECT proxy listening on :${PORT} (allow: *.sud.uz)`);
});
