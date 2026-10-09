// Writes the Guardian's classifier (nsfwjs MobileNetV2, 224 px) into
// public/models/nsfw/ as a plain TF.js layers model: model.json + one binary
// weight shard. nsfwjs ships its models base64-encoded inside JS bundles;
// serving the raw binary from our own origin is ~25% smaller, cacheable, and
// keeps the CSP at 'self'. Re-run after upgrading nsfwjs:
//
//   node scripts/extract-nsfw-model.mjs
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const src = join(process.cwd(), "node_modules/nsfwjs/dist/models/mobilenet_v2");
const out = join(process.cwd(), "public", "models", "nsfw");

const model = require(join(src, "model.min.js"));
const shards = model.weightsManifest.flatMap((group) => group.paths);

mkdirSync(out, { recursive: true });
for (const name of shards) {
  const base64 = require(join(src, `${name}.min.js`));
  writeFileSync(join(out, `${name}.bin`), Buffer.from(base64, "base64"));
}
const manifest = model.weightsManifest.map((group) => ({
  ...group,
  paths: group.paths.map((p) => `${p}.bin`),
}));
writeFileSync(
  join(out, "model.json"),
  JSON.stringify({ ...model, weightsManifest: manifest }),
);
console.log(`wrote ${shards.length} shard(s) and model.json to ${out}`);
