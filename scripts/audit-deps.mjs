import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const severities = ["info", "low", "moderate", "high", "critical"];

// TASK-015A: SECURITY approved this exact Expo tooling risk for the reviewed
// configuration: signing is inactive and forge is absent from runtime artifacts.
// Signing tooling can reach the vulnerable API if enabled. No patched official
// release exists. Owner: SmartRetail maintainers.
// Review/expiry: 2026-11-02 (manual review; no scheduled automation).
// Remove when a compatible official fix exists; any tree/config change requires
// new reachability evidence. See docs/PROJECT_STATE.md, TASK-015A.
const acceptedRisk = {
  ghsa: "GHSA-86w9-cpqp-85rv",
  npmId: 1240912,
  expires: "2026-11-02T00:00:00Z",
  paths: [
    "apps__mobile>expo>@expo/cli>@expo/code-signing-certificates>node-forge",
    "apps__mobile>expo>@expo/cli>node-forge",
  ],
  tree: {
    expo: "57.0.24",
    cli: "57.0.26",
    certificates: "0.0.6",
    cliForge: "1.4.0",
    certificatesForge: "1.4.0",
    lockHash:
      "6b6658a958e66c6e57042c1e784e46d367e19d3942569b1e9ec14b66c520b7dd",
    appConfigHash:
      "b9448506cc52aa6c96030eeda50d75aa55b3ee480fd9e2338d7405751df125f2",
    dynamicConfig: false,
  },
};

// TASK-UX01 checkpoint: SECURITY approved this exact tooling-only availability
// risk. braces has no patched official release; the web production graph does
// not contain this chain and mobile is not deployed. This is not remediation.
// Review/expiry: 2026-11-02. Any package, version, path or runtime-scope
// change must block until independently reviewed.
const acceptedBracesRisk = {
  ghsa: "GHSA-vfj7-8cjw-p6xm",
  cve: "CVE-2026-93687",
  npmId: 1240992,
  module: "braces",
  version: "3.0.3",
  expires: "2026-11-02T00:00:00Z",
  pathsCount: 54,
  pathsHash: "2c62ee30a0f7ba358dfb187f995e0b698755dff48a307dfce58664ed2ea721fb",
};

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function evaluateAudit(report, tree, now = new Date()) {
  const counts = Object.fromEntries(severities.map((level) => [level, 0]));
  const lines = [];
  let blocked = false;
  let accepted = 0;
  try {
    if (!object(report) || report.error || !object(report.advisories))
      throw new Error("Invalid audit response");
    for (const [key, advisory] of Object.entries(report.advisories)) {
      if (
        !object(advisory) ||
        String(advisory.id) !== key ||
        !severities.includes(advisory.severity) ||
        typeof advisory.module_name !== "string" ||
        !/^GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/.test(
          advisory.github_advisory_id ?? "",
        ) ||
        !Array.isArray(advisory.findings) ||
        !advisory.findings.length
      )
        throw new Error("Invalid advisory shape");
      for (const finding of advisory.findings) {
        if (
          !object(finding) ||
          typeof finding.version !== "string" ||
          !Array.isArray(finding.paths) ||
          !finding.paths.length ||
          !finding.paths.every((p) => typeof p === "string" && p.length > 0)
        )
          throw new Error("Invalid findings");
      }
      counts[advisory.severity]++;
      const ghsa = advisory.github_advisory_id;
      if (ghsa === acceptedRisk.ghsa) {
        const finding = advisory.findings[0];
        const paths = finding.paths;
        if (
          advisory.id !== acceptedRisk.npmId ||
          advisory.module_name !== "node-forge" ||
          advisory.severity !== "high" ||
          advisory.url !==
            `https://github.com/advisories/${acceptedRisk.ghsa}` ||
          advisory.patched_versions !== null ||
          advisory.findings.length !== 1 ||
          finding.version !== "1.4.0" ||
          finding.dev !== false ||
          finding.optional !== false ||
          finding.bundled !== false ||
          paths.length !== acceptedRisk.paths.length ||
          !acceptedRisk.paths.every((p) => paths.includes(p)) ||
          !object(tree) ||
          !Object.entries(acceptedRisk.tree).every(([k, v]) => tree[k] === v) ||
          !Number.isFinite(now.getTime()) ||
          now.getTime() >= Date.parse(acceptedRisk.expires)
        )
          throw new Error(
            "Accepted advisory changed or expired: review required",
          );
        accepted++;
        lines.push(
          `1 HIGH accepted risk: ${ghsa} (node-forge 1.4.0; expires 2026-11-02)`,
        );
      } else if (ghsa === acceptedBracesRisk.ghsa) {
        const findings = advisory.findings;
        if (
          advisory.id !== acceptedBracesRisk.npmId ||
          advisory.module_name !== acceptedBracesRisk.module ||
          advisory.severity !== "high" ||
          advisory.url !==
            `https://github.com/advisories/${acceptedBracesRisk.ghsa}` ||
          advisory.patched_versions !== null ||
          findings.length !== 1 ||
          !object(tree) ||
          !Object.entries(acceptedRisk.tree).every(([k, v]) => tree[k] === v) ||
          !findings.every(
            (finding) =>
              finding.version === acceptedBracesRisk.version &&
              finding.dev === false &&
              finding.optional === false &&
              finding.bundled === false &&
              finding.paths.length === acceptedBracesRisk.pathsCount &&
              new Set(finding.paths).size === finding.paths.length &&
              createHash("sha256")
                .update([...finding.paths].sort().join("\n"))
                .digest("hex") === acceptedBracesRisk.pathsHash,
          ) ||
          !Number.isFinite(now.getTime()) ||
          now.getTime() >= Date.parse(acceptedBracesRisk.expires)
        )
          throw new Error(
            "Accepted braces advisory changed or expired: review required",
          );
        accepted++;
        lines.push(
          `1 HIGH accepted risk: ${ghsa} / ${acceptedBracesRisk.cve} (${acceptedBracesRisk.module}@${acceptedBracesRisk.version}; tooling-only; expires 2026-11-02)`,
        );
      } else {
        lines.push(
          `${advisory.severity.toUpperCase()} ${advisory.module_name}: ${ghsa}`,
        );
        if (["high", "critical"].includes(advisory.severity)) blocked = true;
      }
    }
    const metadata = report.metadata?.vulnerabilities;
    if (
      !object(metadata) ||
      Object.keys(metadata).some((level) => !severities.includes(level)) ||
      !severities.every(
        (level) =>
          Number.isSafeInteger(metadata[level]) &&
          metadata[level] === counts[level],
      )
    )
      throw new Error("Invalid/inconsistent audit vulnerability counts");
    lines.unshift(
      severities
        .map((level) => `${counts[level]} ${level.toUpperCase()}`)
        .join(" | "),
    );
    lines.push(
      `Audit gate: ${blocked ? "FAIL" : "PASS"}; ${accepted} accepted HIGH risk(s), not removed from report.`,
    );
    return { exitCode: blocked ? 1 : 0, lines };
  } catch (error) {
    return {
      exitCode: 1,
      lines: [...lines, `Audit gate FAIL (closed): ${error.message}`],
    };
  }
}

export function readReviewedTree(workspace = root) {
  function pkg(requireFrom, name) {
    const filename = requireFrom.resolve(`${name}/package.json`);
    return { filename, data: JSON.parse(readFileSync(filename, "utf8")) };
  }
  const mobileRequire = createRequire(
    resolve(workspace, "apps/mobile/package.json"),
  );
  const expo = pkg(mobileRequire, "expo");
  const cli = pkg(createRequire(expo.filename), "@expo/cli");
  const cliRequire = createRequire(cli.filename);
  const certificates = pkg(cliRequire, "@expo/code-signing-certificates");
  return {
    expo: expo.data.version,
    cli: cli.data.version,
    certificates: certificates.data.version,
    cliForge: pkg(cliRequire, "node-forge").data.version,
    certificatesForge: pkg(createRequire(certificates.filename), "node-forge")
      .data.version,
    lockHash: createHash("sha256")
      .update(readFileSync(resolve(workspace, "pnpm-lock.yaml")))
      .digest("hex"),
    appConfigHash: createHash("sha256")
      .update(readFileSync(resolve(workspace, "apps/mobile/app.json")))
      .digest("hex"),
    dynamicConfig: ["js", "ts", "mjs", "cjs", "mts", "cts"].some((ext) =>
      existsSync(resolve(workspace, `apps/mobile/app.config.${ext}`)),
    ),
  };
}

function main() {
  // Use the same pinned pnpm executable that invoked this package script.
  if (!process.env.npm_execpath) throw new Error("Run through pnpm audit:deps");
  const audit = spawnSync(
    process.execPath,
    [process.env.npm_execpath, "audit", "--json"],
    {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      timeout: 120_000,
    },
  );
  if (audit.error || ![0, 1].includes(audit.status))
    throw new Error("pnpm audit failed");
  const report = JSON.parse(audit.stdout.replace(/^\uFEFF/, ""));
  const needsReview = Object.values(report.advisories ?? {}).some((advisory) =>
    [acceptedRisk.ghsa, acceptedBracesRisk.ghsa].includes(
      advisory?.github_advisory_id,
    ),
  );
  const result = evaluateAudit(
    report,
    needsReview ? readReviewedTree() : undefined,
  );
  for (const line of result.lines) console.log(line);
  process.exitCode = result.exitCode;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    main();
  } catch {
    console.error(
      "Audit gate FAIL (closed): audit, JSON or installed tree could not be validated",
    );
    process.exitCode = 1;
  }
}
