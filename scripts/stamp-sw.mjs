// Stamp the built service worker with a unique per-build id so every deploy gets a new cache
// name. The SW's `activate` handler deletes any cache whose name isn't the current one, so a
// fresh build => fresh cache => the previous deploy's cached shell/assets are purged.
//
// Runs after `vite build` (see package.json "build"). The id is the commit SHA in CI
// (GITHUB_SHA), else the local git short SHA, else a timestamp. Resilient: if the built sw.js
// or its placeholder isn't found, it warns and exits 0 rather than failing the build.

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

const PLACEHOLDER = "__BUILD_ID__";
const ROOT = "dist";

function buildId() {
  const sha = process.env.GITHUB_SHA || process.env.CF_PAGES_COMMIT_SHA;
  if (sha) return sha.slice(0, 8);
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return `t${Date.now()}`;
  }
}

function findSw(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) findSw(p, out);
    else if (name === "sw.js") out.push(p);
  }
  return out;
}

const id = buildId();
let patched = 0;
for (const file of findSw(ROOT)) {
  const src = readFileSync(file, "utf8");
  if (src.includes(PLACEHOLDER)) {
    writeFileSync(file, src.replaceAll(PLACEHOLDER, id));
    patched++;
    console.log(`stamp-sw: ${file} -> ${id}`);
  }
}
if (!patched) console.warn(`stamp-sw: no sw.js with ${PLACEHOLDER} found under ${ROOT}/ (skipped)`);
