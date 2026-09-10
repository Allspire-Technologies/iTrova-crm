// Copies the canonical email shell into every Edge Function that sends mail.
//
// Functions are deployed by pasting one whole file into the Supabase dashboard, so they cannot
// import shared code. Rather than trusting three hand-maintained copies to stay identical, this
// script regenerates them from supabase/functions/_shared/email-shell.ts.
//
//   node scripts/sync-email-shell.mjs           rewrite the copies
//   node scripts/sync-email-shell.mjs --check    fail if any copy is stale (for CI)
//
// After running it, re-paste every function it reports as changed.
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const SOURCE = path.join(ROOT, "supabase/functions/_shared/email-shell.ts");
const TARGETS = [
  "supabase/functions/send-referrer-welcome/index.ts",
  "supabase/functions/resend-activation-email/index.ts",
  "supabase/functions/send-customer-email/index.ts",
];

const START = "// <<< EMAIL SHELL — generated, do not edit here. Source: supabase/functions/_shared/email-shell.ts";
const END = "// >>> END EMAIL SHELL";

function block() {
  const src = fs.readFileSync(SOURCE, "utf8");
  // Drop the file's own header comment (everything before the first declaration) and the export
  // keyword, which has no meaning inside a single-file function.
  const body = src.slice(src.search(/^export /m)).replace(/^export /gm, "");
  return `${START}\n// Regenerate with: node scripts/sync-email-shell.mjs\n${body.trim()}\n${END}`;
}

const check = process.argv.includes("--check");
const generated = block();
let stale = 0;

for (const rel of TARGETS) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) { console.error(`missing: ${rel}`); process.exitCode = 1; continue; }
  const src = fs.readFileSync(file, "utf8");
  const eol = src.includes("\r\n") ? "\r\n" : "\n";
  const want = generated.replace(/\n/g, eol);
  const s = src.indexOf(START);
  const e = src.indexOf(END);
  if (s === -1 || e === -1) { console.error(`no shell markers in ${rel}`); process.exitCode = 1; continue; }
  const current = src.slice(s, e + END.length);
  if (current === want) { console.log(`up to date  ${rel}`); continue; }
  stale++;
  if (check) { console.error(`STALE       ${rel}`); continue; }
  fs.writeFileSync(file, src.slice(0, s) + want + src.slice(e + END.length));
  console.log(`updated     ${rel}  <- re-paste this function`);
}

if (check && stale) {
  console.error(`\n${stale} function(s) have a stale email shell. Run: node scripts/sync-email-shell.mjs`);
  process.exitCode = 1;
}
