const fs = require("node:fs");
const { execFileSync } = require("node:child_process");
const { spawn } = require("node:child_process");
const root = process.cwd();
const target = root + "/apps/web/app/layout.tsx";
if (
  execFileSync(
    "git",
    ["status", "--porcelain=v1", "--", "apps/web/app/layout.tsx"],
    { cwd: root, encoding: "utf8" },
  ).trim()
)
  throw Error("Layout must be clean before synthetic fault build");
const original = fs.readFileSync(target);
const source = original.toString("utf8");
const anchor = "  return (\n";
const normalized = source.replaceAll("\r\n", "\n");
if (!normalized.includes(anchor)) throw Error("Unknown layout fixture anchor");
const changed = normalized.replace(
  anchor,
  '  if (process.env.CSP_SYNTHETIC_ROOT_FAILURE === "1") throw new Error("Synthetic CSP root failure");\n' +
    anchor,
);
fs.writeFileSync(target, changed);
const child = spawn(
  process.execPath,
  [
    root + "/apps/web/node_modules/next/dist/bin/next",
    "build",
    root + "/apps/web",
  ],
  {
    cwd: root,
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
    stdio: "inherit",
  },
);
let restored = false;
function restore() {
  if (!restored) {
    if (fs.readFileSync(target, "utf8") !== changed)
      throw Error("Concurrent layout edit: refusing to overwrite it");
    fs.writeFileSync(target, original);
    restored = true;
  }
}
process.on("exit", restore);
child.on("error", () => {
  restore();
  process.exitCode = 1;
});
child.on("exit", (code) => {
  restore();
  process.exitCode = code ?? 1;
  console.log(
    JSON.stringify({ syntheticBuild: code === 0, sourceRestored: true }),
  );
});
