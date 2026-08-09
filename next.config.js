/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // `iconsax-react` is a huge barrel: a named import of ~28 icons otherwise drags the WHOLE package
    // (thousands of modules) into every route's dev compile — the main cause of 15–20s "Compiling…".
    // This rewrites the barrel import into direct per-icon deep imports, so only the used icons compile.
    optimizePackageImports: ['iconsax-react'],
  },
};
module.exports = nextConfig;
