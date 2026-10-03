import {
  mkdir,
  readFile,
  readdir,
  open,
  lstat,
  realpath,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, relative, join, sep, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
// Stage byte-identical canonical migrations outside Git. This command never
// connects to a database; link, review dry-run and push remain separate steps.
const root = fileURLToPath(new URL("../", import.meta.url));
async function snapshot(path, bytes) {
  let handle;
  try {
    handle = await open(path, "wx");
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)
      throw new Error("Staging files must be regular files without links");
    if (!(await readFile(path)).equals(bytes))
      throw new Error("Staging differs from source; use a fresh directory");
    return; // Never overwrite an existing destination, even after checking it.
  }
  try {
    await handle.writeFile(bytes);
  } finally {
    await handle.close();
  }
}
const outside = (base, path) => {
  const result = relative(base, path);
  return isAbsolute(result) || result === ".." || result.startsWith(`..${sep}`);
};
const destination = resolve(process.argv[2] ?? "");
if (!process.argv[2] || !outside(root, destination))
  throw new Error("Provide a staging directory outside the repository");
await mkdir(destination, { recursive: true });
const actual = await realpath(destination);
if (!outside(await realpath(root), actual))
  throw new Error("Staging must resolve outside the repository");
const supabaseFolder = join(actual, "supabase");
await mkdir(supabaseFolder, { recursive: true });
if (
  (await lstat(supabaseFolder)).isSymbolicLink() ||
  !outside(await realpath(root), await realpath(supabaseFolder))
)
  throw new Error(
    "Supabase staging directory must be external and without links",
  );
const folder = join(supabaseFolder, "migrations");
await mkdir(folder, { recursive: true });
if (
  (await lstat(folder)).isSymbolicLink() ||
  !outside(await realpath(root), await realpath(folder))
)
  throw new Error("Migrations staging resolves inside the repository");
const sources = (await readdir(join(root, "packages/database/migrations")))
  .filter((name) => /^\d{3}_[a-z_]+\.sql$/.test(name))
  .sort();
const mappings = sources.map((name) => ({
  source: name,
  target: `20261001${name.slice(0, 3)}000_${name.slice(4)}`,
}));
// Do not silently mix staged histories or overwrite unknown migration files.
const existing = await readdir(folder);
if (
  existing.some((name) => !mappings.some((mapping) => mapping.target === name))
)
  throw new Error("Staging has an unexpected migration; use a fresh directory");
await snapshot(
  join(actual, "supabase", "config.toml"),
  await readFile(join(root, "supabase/config.toml")),
);
for (const mapping of mappings) {
  const bytes = await readFile(
    join(root, "packages/database/migrations", mapping.source),
  );
  await snapshot(join(folder, mapping.target), bytes);
  const copied = await readFile(join(folder, mapping.target));
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (hash !== createHash("sha256").update(copied).digest("hex"))
    throw new Error("Migration copy verification failed");
  console.log(`${mapping.source} -> ${mapping.target} SHA256 ${hash}`);
}
