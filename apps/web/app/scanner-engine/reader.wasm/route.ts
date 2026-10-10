import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
export const runtime = "nodejs";
export async function GET() {
  const packageRequire = createRequire(import.meta.url);
  // Keep Node's resolver: Turbopack's static require.resolve emits virtual external paths.
  // The fixed asset is explicitly included in outputFileTracingIncludes.
  const resolvePackage = packageRequire.resolve.bind(packageRequire);
  const bytes = await readFile(
    join(
      dirname(resolvePackage("zxing-wasm/reader")),
      "../../reader/zxing_reader.wasm",
    ),
  );
  return new Response(bytes, {
    headers: {
      "Content-Type": "application/wasm",
      "Cache-Control": "public, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
