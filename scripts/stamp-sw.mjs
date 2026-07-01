// Stamp the built service worker with (1) a unique per-build id so every deploy gets a new cache
// name (the SW's `activate` handler deletes any cache whose name isn't the current one), and
// (2) the list of this build's hashed JS/CSS bundles so the SW can precache them — making a cold
// launch render fully offline instead of just the HTML shell.
//
// Runs after `vite build` (see package.json "build"). The id is the commit SHA in CI
// (GITHUB_SHA), else the local git short SHA, else a timestamp. Resilient: if the built sw.js
// or its placeholders aren't found, it warns and exits 0 rather than failing the build.

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

const PLACEHOLDER = "__BUILD_ID__";
const PRECACHE_TOKEN = "/* __PRECACHE__ */";
const ROOT = "dist";

// The hashed JS/CSS bundles emitted by Vite. Precaching these (not just the HTML shell) is what
// lets a cold launch render fully offline. Resilient: if dist/assets is missing, returns [].
function assetUrls() {
  try {
    return readdirSync(join(ROOT, "assets"))
      .filter((f) => /\.(js|css)$/.test(f))
      .map((f) => `/assets/${f}`);
  } catch {
    return [];
  }
}

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
const assets = assetUrls();
const precacheLiteral = assets.map((u) => JSON.stringify(u)).join(",");
let patched = 0;
for (const file of findSw(ROOT)) {
  let src = readFileSync(file, "utf8");
  let changed = false;
  if (src.includes(PLACEHOLDER)) { src = src.replaceAll(PLACEHOLDER, id); changed = true; }
  if (src.includes(PRECACHE_TOKEN)) { src = src.replace(PRECACHE_TOKEN, precacheLiteral); changed = true; }
  if (changed) {
    writeFileSync(file, src);
    patched++;
    console.log(`stamp-sw: ${file} -> ${id} (+${assets.length} precache asset${assets.length === 1 ? "" : "s"})`);
  }
}
if (!patched) console.warn(`stamp-sw: no sw.js with ${PLACEHOLDER} found under ${ROOT}/ (skipped)`);
