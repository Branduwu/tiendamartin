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
  lockHash: "1d5780c7948af063b677825a9b81900835964a10b6c572701fa02030be2319f7",
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
      1240992: {
        id: 1240992,
        github_advisory_id: "GHSA-vfj7-8cjw-p6xm",
        module_name: "braces",
        severity: "high",
        url: "https://github.com/advisories/GHSA-vfj7-8cjw-p6xm",
        patched_versions: null,
        findings: [
          {
            version: "3.0.3",
            dev: false,
            optional: false,
            bundled: false,
            paths: [
              "apps__mobile>expo>@expo/cli>@expo/log-box>@expo/dom-webview>react-native>@react-native/community-cli-plugin>metro>metro-file-map>micromatch>braces",
              "apps__mobile>expo>@expo/cli>@expo/log-box>@expo/dom-webview>react-native>@react-native/community-cli-plugin>metro-config>metro>metro-file-map>micromatch>braces",
              "apps__mobile>expo>@expo/cli>@expo/log-box>react-native>@react-native/community-cli-plugin>metro>metro-file-map>micromatch>braces",
              "apps__mobile>expo>@expo/cli>@expo/log-box>react-native>@react-native/community-cli-plugin>metro-config>metro>metro-file-map>micromatch>braces",
              "apps__mobile>expo>@expo/cli>@expo/metro>metro>metro-file-map>micromatch>braces",
              "apps__mobile>expo>@expo/cli>@expo/metro>metro-config>metro>metro-file-map>micromatch>braces",
              "apps__mobile>expo>@expo/cli>@expo/metro>metro-file-map>micromatch>braces",
              "apps__mobile>expo>@expo/cli>@expo/metro>metro-transform-worker>metro>metro-file-map>micromatch>braces",
              "apps__mobile>expo>@expo/cli>@expo/metro-config>@expo/metro>metro>metro-file-map>micromatch>braces",
              "apps__mobile>expo>@expo/cli>@expo/metro-config>@expo/metro>metro-config>metro>metro-file-map>micromatch>braces",
              "apps__mobile>expo>@expo/cli>@expo/metro-config>@expo/metro>metro-file-map>micromatch>braces",
              "apps__mobile>expo>@expo/cli>@expo/metro-config>@expo/metro>metro-transform-worker>metro>metro-file-map>micromatch>braces",
              "apps__mobile>expo>@expo/cli>@expo/metro-file-map>micromatch>braces",
              "apps__mobile>expo>@expo/cli>@expo/router-server>expo-constants>react-native>@react-native/community-cli-plugin>metro>metro-file-map>micromatch>braces",
              "apps__mobile>expo>@expo/cli>@expo/router-server>expo-constants>react-native>@react-native/community-cli-plugin>metro-config>metro>metro-file-map>micromatch>braces",
              "apps__mobile>expo>@expo/cli>@expo/router-server>expo-font>react-native>@react-native/community-cli-plugin>metro>metro-file-map>micromatch>braces",
              "apps__mobile>expo>@expo/cli>@expo/router-server>expo-font>react-native>@react-native/community-cli-plugin>metro-config>metro>metro-file-map>micromatch>braces",
              "apps__mobile>expo>@expo/cli>react-native>@react-native/community-cli-plugin>metro>metro-file-map>micromatch>braces",
              "apps__mobile>expo>@expo/cli>react-native>@react-native/community-cli-plugin>metro-config>metro>metro-file-map>micromatch>braces",
              "apps__mobile>expo>@expo/devtools>react-native>@react-native/community-cli-plugin>metro>metro-file-map>micromatch>braces",
              "apps__mobile>expo>@expo/devtools>react-native>@react-native/community-cli-plugin>metro-config>metro>metro-file-map>micromatch>braces",
              "apps__mobile>expo>@expo/log-box>@expo/dom-webview>react-native>@react-native/community-cli-plugin>metro>metro-file-map>micromatch>braces",
              "apps__mobile>expo>@expo/log-box>@expo/dom-webview>react-native>@react-native/community-cli-plugin>metro-config>metro>metro-file-map>micromatch>braces",
              "apps__mobile>expo>@expo/log-box>react-native>@react-native/community-cli-plugin>metro>metro-file-map>micromatch>braces",
              "apps__mobile>expo>@expo/log-box>react-native>@react-native/community-cli-plugin>metro-config>metro>metro-file-map>micromatch>braces",
              "apps__mobile>expo>@expo/metro>metro>metro-file-map>micromatch>braces",
              "apps__mobile>expo>@expo/metro>metro-config>metro>metro-file-map>micromatch>braces",
              "apps__mobile>expo>@expo/metro>metro-file-map>micromatch>braces",
              "apps__mobile>expo>@expo/metro>metro-transform-worker>metro>metro-file-map>micromatch>braces",
              "apps__mobile>expo>@expo/metro-config>@expo/metro>metro>metro-file-map>micromatch>braces",
              "apps__mobile>expo>@expo/metro-config>@expo/metro>metro-config>metro>metro-file-map>micromatch>braces",
              "apps__mobile>expo>@expo/metro-config>@expo/metro>metro-file-map>micromatch>braces",
              "apps__mobile>expo>@expo/metro-config>@expo/metro>metro-transform-worker>metro>metro-file-map>micromatch>braces",
              "apps__mobile>expo>expo-asset>expo-constants>react-native>@react-native/community-cli-plugin>metro>metro-file-map>micromatch>braces",
              "apps__mobile>expo>expo-asset>expo-constants>react-native>@react-native/community-cli-plugin>metro-config>metro>metro-file-map>micromatch>braces",
              "apps__mobile>expo>expo-asset>react-native>@react-native/community-cli-plugin>metro>metro-file-map>micromatch>braces",
              "apps__mobile>expo>expo-asset>react-native>@react-native/community-cli-plugin>metro-config>metro>metro-file-map>micromatch>braces",
              "apps__mobile>expo>expo-constants>react-native>@react-native/community-cli-plugin>metro>metro-file-map>micromatch>braces",
              "apps__mobile>expo>expo-constants>react-native>@react-native/community-cli-plugin>metro-config>metro>metro-file-map>micromatch>braces",
              "apps__mobile>expo>expo-file-system>react-native>@react-native/community-cli-plugin>metro>metro-file-map>micromatch>braces",
              "apps__mobile>expo>expo-file-system>react-native>@react-native/community-cli-plugin>metro-config>metro>metro-file-map>micromatch>braces",
              "apps__mobile>expo>expo-font>react-native>@react-native/community-cli-plugin>metro>metro-file-map>micromatch>braces",
              "apps__mobile>expo>expo-font>react-native>@react-native/community-cli-plugin>metro-config>metro>metro-file-map>micromatch>braces",
              "apps__mobile>expo>expo-modules-core>expo-modules-jsi>react-native>@react-native/community-cli-plugin>metro>metro-file-map>micromatch>braces",
              "apps__mobile>expo>expo-modules-core>expo-modules-jsi>react-native>@react-native/community-cli-plugin>metro-config>metro>metro-file-map>micromatch>braces",
              "apps__mobile>expo>expo-modules-core>react-native>@react-native/community-cli-plugin>metro>metro-file-map>micromatch>braces",
              "apps__mobile>expo>expo-modules-core>react-native>@react-native/community-cli-plugin>metro-config>metro>metro-file-map>micromatch>braces",
              "apps__mobile>expo>react-native>@react-native/community-cli-plugin>metro>metro-file-map>micromatch>braces",
              "apps__mobile>expo>react-native>@react-native/community-cli-plugin>metro-config>metro>metro-file-map>micromatch>braces",
              "apps__mobile>expo>@expo/dom-webview>react-native>@react-native/community-cli-plugin>metro>metro-file-map>micromatch>braces",
              "apps__mobile>expo>@expo/dom-webview>react-native>@react-native/community-cli-plugin>metro-config>metro>metro-file-map>micromatch>braces",
              "apps__mobile>react-native>@react-native/community-cli-plugin>metro>metro-file-map>micromatch>braces",
              "apps__mobile>react-native>@react-native/community-cli-plugin>metro-config>metro>metro-file-map>micromatch>braces",
              "apps__web>eslint-config-next>@next/eslint-plugin-next>fast-glob>micromatch>braces",
            ],
          },
        ],
      },
    },
    metadata: {
      vulnerabilities: { info: 0, low: 0, moderate: 1, high: 2, critical: 0 },
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
  assert.match(
    result.lines.join("\n"),
    /GHSA-vfj7-8cjw-p6xm \/ CVE-2026-93687/,
  );
  assert.match(result.lines.join("\n"), /MODERATE uuid: GHSA-w5hq-g745-h8pq/);
  assert.match(result.lines[0], /1 MODERATE \| 2 HIGH/);
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

test("braces exception rejects production or unexpected paths", () => {
  const report = fixture();
  report.advisories[1240992].findings[0].paths = [
    "apps__web>next>micromatch>braces",
  ];
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
  delete report.advisories[1240992];
  report.metadata.vulnerabilities.high = 0;
  const result = evaluateAudit(report, undefined, reviewedAt);
  assert.equal(result.exitCode, 0);
  assert.match(result.lines.join("\n"), /0 accepted HIGH risk/);
});

test("installed reviewed tree resolves both real node-forge dependencies", () => {
  assert.deepEqual(readReviewedTree(), tree);
});

test("braces alone requires exact identity, full chain set, context and expiry", () => {
  const edits = [
    (a) => (a.module_name = "other"),
    (a) => (a.id = 1),
    (a) => (a.findings[0].version = "3.0.4"),
    (a) => (a.severity = "critical"),
    (a) => (a.patched_versions = ">=3.0.4"),
    (a) => a.findings[0].paths.pop(),
    (a) =>
      (a.findings[0].paths[0] = "apps__mobile>unexpected>micromatch>braces"),
    (a) => a.findings.push(structuredClone(a.findings[0])),
  ];
  for (const edit of edits) {
    const report = fixture();
    edit(report.advisories[1240992]);
    assert.equal(evaluateAudit(report, tree, reviewedAt).exitCode, 1);
  }
  const report = fixture();
  delete report.advisories[1240912];
  report.metadata.vulnerabilities.high = 1;
  assert.equal(evaluateAudit(report, tree, reviewedAt).exitCode, 0);
  assert.equal(evaluateAudit(report, undefined, reviewedAt).exitCode, 1);
  assert.equal(
    evaluateAudit(report, { ...tree, lockHash: "changed" }, reviewedAt)
      .exitCode,
    1,
  );
  assert.equal(
    evaluateAudit(report, tree, new Date("2026-11-02T00:00:00Z")).exitCode,
    1,
  );
});
