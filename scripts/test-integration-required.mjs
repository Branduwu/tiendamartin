import { spawnSync } from "node:child_process";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (!process.env.SMARTRETAIL_PG_TEST_CONFIG) {
  console.error(
    "Integration acceptance requires SMARTRETAIL_PG_TEST_CONFIG for the disposable PostgreSQL database.",
  );
  process.exit(1);
}

if (!process.env.npm_execpath) {
  console.error(
    "Run this command through pnpm so the pinned package manager is used.",
  );
  process.exit(1);
}

const reportDirectory = mkdtempSync(join(tmpdir(), "smartretail-pg-required-"));
const reportPath = join(reportDirectory, "results.json");
const result = spawnSync(
  process.execPath,
  [
    process.env.npm_execpath,
    "--filter",
    "@smartretail/database",
    "run",
    "test:integration",
    "--reporter=default",
    "--reporter=json",
    `--outputFile.json=${reportPath}`,
  ],
  { stdio: "inherit", env: process.env },
);

let exitCode = 1;
try {
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error("PostgreSQL integration process failed");
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  const assertions = report.testResults?.flatMap(
    (file) => file.assertionResults,
  );
  if (
    !report.success ||
    !Number.isSafeInteger(report.numTotalTests) ||
    report.numTotalTests <= 0 ||
    report.numPassedTests !== report.numTotalTests ||
    report.numFailedTests !== 0 ||
    report.numPendingTests !== 0 ||
    (report.numTodoTests ?? 0) !== 0 ||
    !Array.isArray(assertions) ||
    assertions.length !== report.numTotalTests ||
    !assertions.every((test) => test.status === "passed")
  )
    throw new Error(
      "PostgreSQL required gate rejects missing, failed or skipped tests",
    );
  console.log(
    `PostgreSQL required gate PASS: ${report.numPassedTests} passed, zero skipped/todo.`,
  );
  exitCode = 0;
} catch (error) {
  console.error(error.message);
} finally {
  // Only remove the unique report file; never recursively delete directories.
  rmSync(reportPath, { force: true });
}
process.exit(exitCode);
