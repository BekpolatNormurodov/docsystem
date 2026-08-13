/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // `iconsax-react` is a huge barrel: a named import of ~28 icons otherwise drags the WHOLE package
    // (thousands of modules) into every route's dev compile — the main cause of 15–20s "Compiling…".
    // This rewrites the barrel import into direct per-icon deep imports, so only the used icons compile.
    optimizePackageImports: ['iconsax-react'],
    // `ws` (the E-IMZO CAPIWS client) must NOT be webpack-bundled into the server routes: the bundled
    // copy hangs on the wss://127.0.0.1 self-signed handshake, so listing keys / signing timed out even
    // though a plain `node` process finishes the SAME call in ~330ms. Loading it as an external (native
    // require) makes the route use the real, working `ws`. (Next 14.2 key; requires a dev-server restart.)
    //
    // `playwright` is external too: it is only ever reached through the dynamic `import('playwright')`
    // in the job libs (worker path), never executed on the web process (JOB_MODE=worker). Keeping it
    // external means the lean, internet-facing web build never bundles chromium's driver code.
    serverComponentsExternalPackages: ['ws', 'playwright'],
  },
};
module.exports = nextConfig;
