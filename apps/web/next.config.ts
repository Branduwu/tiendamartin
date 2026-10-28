import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: [
    "zxing-wasm",
    "pdfjs-dist",
    "tesseract.js",
    "tesseract.js-core",
    "@tesseract.js-data/spa",
  ],
  outputFileTracingIncludes: {
    "/api/v1/purchases/*": [
      "./node_modules/pdfjs-dist/package.json",
      "./node_modules/pdfjs-dist/legacy/build/*",
    ],
    "/document-engine/*": [
      "./node_modules/pdfjs-dist/package.json",
      "./node_modules/pdfjs-dist/build/pdf.worker.min.mjs",
      "./node_modules/tesseract.js/package.json",
      "./node_modules/tesseract.js/dist/worker.min.js",
      "./node_modules/tesseract.js/dist/tesseract.min.js",
      "./node_modules/tesseract.js-core/*",
      "./node_modules/@tesseract.js-data/spa/package.json",
      "./node_modules/@tesseract.js-data/spa/4.0.0_best_int/spa.traineddata.gz",
    ],
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
          // Static fallbacks use native HTML navigation. Functional documents
          // receive the existing nonce policy from proxy.ts instead.
          {
            key: "Content-Security-Policy",
            value:
              "script-src 'none'; script-src-attr 'none'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
      {
        source: "/document-engine/:asset*",
        headers: [
          {
            key: "Content-Security-Policy",
            value:
              "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
