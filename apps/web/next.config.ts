import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["zxing-wasm"],
  outputFileTracingIncludes: {
    "/scanner-engine/reader.wasm": [
      "./node_modules/zxing-wasm/package.json",
      "./node_modules/zxing-wasm/dist/cjs/reader/index.js",
      "./node_modules/zxing-wasm/dist/reader/zxing_reader.wasm",
    ],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
    ];
  },
};

export default nextConfig;
