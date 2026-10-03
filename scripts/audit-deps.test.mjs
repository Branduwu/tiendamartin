import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { evaluateAudit, readReviewedTree } from "./audit-deps.mjs";

const reviewedAt = new Date("2026-10-02T12:00:00Z");
const tree = {
  expo: "57.0.24",
  cli: "57.0.26",
  certificates: "0.0.6",
  cliForge: "1.4.0",
  certificatesForge: "1.4.0",
  lockHash: "4f6e45ecc32bb547ca1f2171c2a39b6c21e63203d0aa2fe67dd194ddb1931261",
  appConfigHash:
    "b9448506cc52aa6c96030eeda50d75aa55b3ee480fd9e2338d7405751df125f2",
  dynamicConfig: false,
};
function fixture() {
  return {
    advisories: {
      1240912: {
        id: 1240912,
        github_advisory_id: "GHSA-86w9-cpqp-85rv",
        module_name: "node-forge",
        severity: "high",
        url: "https://github.com/advisories/GHSA-86w9-cpqp-85rv",
        patched_versions: null,
        findings: [
          {
            version: "1.4.0",
            dev: false,
            optional: false,
            bundled: false,
            paths: [
              "apps__mobile>expo>@expo/cli>@expo/code-signing-certificates>node-forge",
              "apps__mobile>expo>@expo/cli>node-forge",
            ],
          },
        ],
      },
      1119441: {
        id: 1119441,
        github_advisory_id: "GHSA-w5hq-g745-h8pq",
        module_name: "uuid",
        severity: "moderate",
        findings: [
          {
            version: "7.0.3",
            paths: [
              "apps__mobile>expo>@expo/cli>@expo/config-plugins>xcode>uuid",
            ],
          },
        ],
      },
    },
    metadata: {
      vulnerabilities: { info: 0, low: 0, moderate: 1, high: 1, critical: 0 },
    },
  };
}

test("approved exact risk passes and still reports HIGH and MODERATE, without changing report", () => {
  const report = fixture();
  const before = structuredClone(report);
  const result = evaluateAudit(report, tree, reviewedAt);
  assert.equal(result.exitCode, 0);
  assert.match(
    result.lines.join("\n"),
    /1 HIGH accepted risk: GHSA-86w9-cpqp-85rv/,
  );
  assert.match(result.lines.join("\n"), /MODERATE uuid: GHSA-w5hq-g745-h8pq/);
  assert.match(result.lines[0], /1 MODERATE \| 1 HIGH/);
  assert.deepEqual(report, before);
});

for (const severity of ["high", "critical"]) {
  test(`unapproved ${severity} produces a nonzero process exit`, () => {
    const report = fixture();
    report.advisories[9999999] = {
      id: 9999999,
      github_advisory_id: "GHSA-aaaa-bbbb-cccc",
      module_name: "fictional-package",
      severity,
      findings: [{ version: "1.0.0", paths: ["apps__web>fictional-package"] }],
    };
    report.metadata.vulnerabilities[severity]++;
    const code = `import {evaluateAudit} from ${JSON.stringify(new URL("./audit-deps.mjs", import.meta.url).href)};process.exit(evaluateAudit(${JSON.stringify(report)},${JSON.stringify(tree)},new Date(${JSON.stringify(reviewedAt.toISOString())})).exitCode);`;
    const child = spawnSync(process.execPath, [
      "--input-type=module",
      "--eval",
      code,
    ]);
    assert.equal(child.error, undefined);
    assert.equal(child.status, 1);
  });
}

test("same GHSA is never accepted as CRITICAL", () => {
  const report = fixture();
  report.advisories[1240912].severity = "critical";
  report.metadata.vulnerabilities.high = 0;
  report.metadata.vulnerabilities.critical = 1;
  assert.equal(evaluateAudit(report, tree, reviewedAt).exitCode, 1);
});

test("package, npm advisory identity, version, paths and available patch changes fail closed", () => {
  const edits = [
    (a) => {
      a.module_name = "different-package";
    },
    (a) => {
      a.findings[0].version = "1.4.1";
    },
    (a) => {
      a.findings[0].paths.push("apps__web>node-forge");
    },
    (a) => {
      a.findings[0].paths[0] = "apps__mobile>different-parent>node-forge";
    },
    (a) => {
      a.findings[0].paths.pop();
    },
    (a) => {
      a.id = 1;
    },
    (a) => {
      a.patched_versions = ">=1.4.1";
    },
    (a) => {
      a.findings.push(structuredClone(a.findings[0]));
    },
  ];
  for (const edit of edits) {
    const report = fixture();
    edit(report.advisories[1240912]);
    assert.equal(evaluateAudit(report, tree, reviewedAt).exitCode, 1);
  }
});

test("changed tree/configuration and absent context require a new review", () => {
  for (const key of Object.keys(tree)) {
    const changed = {
      ...tree,
      [key]: key === "dynamicConfig" ? true : "changed",
    };
    assert.equal(evaluateAudit(fixture(), changed, reviewedAt).exitCode, 1);
  }
  assert.equal(evaluateAudit(fixture(), undefined, reviewedAt).exitCode, 1);
});

test("exception expires on the documented review date", () => {
  assert.equal(
    evaluateAudit(fixture(), tree, new Date("2026-11-02T00:00:00Z")).exitCode,
    1,
  );
});

test("malformed responses, findings, severity, errors and inconsistent counts fail closed", () => {
  const reports = [
    null,
    {},
    { error: { message: "registry failed" } },
    fixture(),
    fixture(),
    fixture(),
    fixture(),
  ];
  reports[3].metadata.vulnerabilities.high = 0;
  reports[4].advisories[1240912].severity = "unknown";
  reports[5].advisories[1240912].findings[0].paths = [];
  delete reports[6].metadata;
  for (const report of reports)
    assert.equal(evaluateAudit(report, tree, reviewedAt).exitCode, 1);
});

test("no accepted advisory means no exception or reachability pin is applied", () => {
  const report = fixture();
  delete report.advisories[1240912];
  report.metadata.vulnerabilities.high = 0;
  const result = evaluateAudit(report, undefined, reviewedAt);
  assert.equal(result.exitCode, 0);
  assert.match(result.lines.join("\n"), /0 accepted HIGH risk/);
});

test("installed reviewed tree resolves both real node-forge dependencies", () => {
  assert.deepEqual(readReviewedTree(), tree);
});
