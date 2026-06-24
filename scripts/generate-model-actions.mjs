import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createModelActionExtraction,
  parseLive2DModelSettingsCatalog
} from "../packages/content/dist/index.js";

const packDir = process.argv[2];

if (!packDir) {
  throw new Error("usage: node scripts/generate-model-actions.mjs <content-pack-dir>");
}

const contentPack = JSON.parse(await readFile(path.join(packDir, "content-pack.json"), "utf8"));
const modelSettings = JSON.parse(await readFile(path.join(packDir, contentPack.entry), "utf8"));
const catalog = parseLive2DModelSettingsCatalog(modelSettings);
const expressionParameters = {};

for (const expression of catalog.expressions) {
  const expressionJson = JSON.parse(await readFile(path.join(packDir, expression.file), "utf8"));
  expressionParameters[expression.name] = (expressionJson.Parameters ?? []).map((parameter) => ({
    id: parameter.Id,
    value: parameter.Value,
    blend: parameter.Blend
  }));
}

const extraction = createModelActionExtraction(catalog, expressionParameters);
const outputDir = path.join(packDir, "generated", "actions");
await mkdir(outputDir, { recursive: true });

const index = {
  packId: contentPack.id,
  generatedAt: new Date().toISOString(),
  actions: extraction.actions.map((action) => ({
    id: action.id,
    file: `${action.id}.json`
  })),
  resetActions: extraction.resetActions.map((action) => ({
    id: action.id,
    file: `${action.id}.json`
  }))
};

const allActions = [...extraction.actions, ...extraction.resetActions];
const written = new Set();
for (const action of allActions) {
  if (written.has(action.id)) {
    continue;
  }

  written.add(action.id);
  await writeFile(path.join(outputDir, `${action.id}.json`), `${JSON.stringify(action, null, 2)}\n`, "utf8");
}

await writeFile(path.join(outputDir, "index.json"), `${JSON.stringify(index, null, 2)}\n`, "utf8");
console.log(`generated ${written.size} action files in ${outputDir}`);
