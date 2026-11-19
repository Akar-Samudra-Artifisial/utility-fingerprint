import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Static export: `pnpm build` writes a self-contained site to out/ (HTML/JS + public/data JSON).
  // The dashboard keeps all state in the URL on the client, so no server features are needed.
  // (cacheComponents / partialPrefetching were dropped: PPR cannot run in export mode, and the single
  // client-rendered route used neither `use cache` nor <Link> prefetching.)
  output: "export",
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
