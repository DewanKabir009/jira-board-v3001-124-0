/**
 * Ensures Legacy hq-worker.js has Asana KDS open-tasks + complete routes.
 * Usage: node scripts/ensure-asana-kds-routes.cjs [path-to-hq-worker.js]
 */
const fs = require("fs");
const path = require("path");

const target = path.resolve(
  process.argv[2] || path.join(__dirname, "..", "workers", "hq-worker.js")
);
const donor = process.env.KDS_DONOR
  ? path.resolve(process.env.KDS_DONOR)
  : path.join(process.env.TEMP || "/tmp", "hq-worker-with-kds.js");

let src = fs.readFileSync(target, "utf8");
if (src.includes('pathname === "/api/asana/open-tasks"') && src.includes("async function handleAsanaComplete")) {
  console.log("KDS routes already present:", target);
  process.exit(0);
}

const donorSrc = fs.readFileSync(donor, "utf8");

function extract(re, label) {
  const match = donorSrc.match(re);
  if (!match) throw new Error(`Donor missing ${label}`);
  return match[1];
}

if (!src.includes('"GET /api/asana/open-tasks"')) {
  if (!src.includes('"POST /api/asana/intake"')) {
    throw new Error("Target missing Asana intake route marker");
  }
  src = src.replace(
    '"POST /api/asana/intake",',
    '"POST /api/asana/intake",\n  "GET /api/asana/open-tasks",\n  "POST /api/asana/complete",'
  );
}

if (!src.includes('pathname === "/api/asana/open-tasks"')) {
  const handlers = extract(
    /(if \(url\.pathname === "\/api\/asana\/open-tasks"\) \{[\s\S]*?return handleAsanaComplete\(request, env, url\);\s*\}\s*\n)/,
    "route handlers"
  );
  src = src.replace(
    /(if \(url\.pathname === "\/api\/asana\/intake"\) \{[\s\S]*?return handleAsanaIntake\(request, env, url\);\s*\}\s*\n)/,
    `$1\n    ${handlers}`
  );
}

if (!src.includes("async function handleAsanaOpenTasks")) {
  const fns = extract(
    /(async function handleAsanaOpenTasks[\s\S]*?async function completeAsanaTask[\s\S]*?\n\}\n\n)(?=function getAsanaConfig)/,
    "KDS functions"
  );
  if (!src.includes("function getAsanaConfig")) {
    throw new Error("Target missing getAsanaConfig insertion point");
  }
  src = src.replace(/function getAsanaConfig/, `${fns}function getAsanaConfig`);
}

fs.writeFileSync(target, src);
console.log("Patched KDS routes into", target);
