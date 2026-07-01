import { copyFile, mkdir, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(workspaceRoot, "pets");
const destination = path.join(workspaceRoot, "apps", "model-lab", "public", "pets");

if (!destination.startsWith(`${workspaceRoot}${path.sep}`)) {
  throw new Error(`Refusing to sync outside the workspace: ${destination}`);
}

const result = await syncDirectory(source, destination);

console.log(
  `Synced model assets: ${path.relative(workspaceRoot, source)} -> ${path.relative(workspaceRoot, destination)} ` +
  `(${result.copied} copied, ${result.unchanged} unchanged, ${result.removed} stale removed)`
);

async function syncDirectory(sourceDir, destinationDir) {
  await mkdir(destinationDir, { recursive: true });

  let copied = 0;
  let unchanged = 0;
  const entries = await readdir(sourceDir, { withFileTypes: true });
  const sourceNames = new Set(entries.map((entry) => entry.name));
  const destinationEntries = await readdir(destinationDir, { withFileTypes: true });
  let removed = 0;
  for (const entry of destinationEntries) {
    if (sourceNames.has(entry.name)) continue;
    await rm(path.join(destinationDir, entry.name), { recursive: true, force: true });
    removed += 1;
  }
  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const destinationPath = path.join(destinationDir, entry.name);
    if (entry.isDirectory()) {
      const child = await syncDirectory(sourcePath, destinationPath);
      copied += child.copied;
      unchanged += child.unchanged;
      removed += child.removed;
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (await filesEqual(sourcePath, destinationPath)) {
      unchanged += 1;
      continue;
    }

    await copyFile(sourcePath, destinationPath);
    copied += 1;
  }

  return { copied, unchanged, removed };
}

async function filesEqual(leftPath, rightPath) {
  try {
    const [left, right] = await Promise.all([readFile(leftPath), readFile(rightPath)]);
    return left.equals(right);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}
