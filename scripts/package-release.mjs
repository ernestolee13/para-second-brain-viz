import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const manifest = JSON.parse(await readFile("manifest.json", "utf8"));
const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const versions = JSON.parse(await readFile("versions.json", "utf8"));
if (manifest.version !== packageJson.version) {
  throw new Error(`Version mismatch: manifest ${manifest.version}, package ${packageJson.version}.`);
}
if (versions[manifest.version] !== manifest.minAppVersion) {
  throw new Error(`versions.json must map ${manifest.version} to ${manifest.minAppVersion}.`);
}

const assets = ["manifest.json", "main.js", "styles.css"];
const target = join("release", `para-second-brain-viz-${manifest.version}`);
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });

const checksums = [];
for (const asset of assets) {
  const bytes = await readFile(asset);
  await copyFile(asset, join(target, asset));
  checksums.push(`${createHash("sha256").update(bytes).digest("hex")}  ${asset}`);
}
await writeFile(join(target, "SHA256SUMS"), `${checksums.join("\n")}\n`);
console.info(`Packaged ${assets.join(", ")} in ${target}`);
