const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const targetPath = path.join(root, "workers", "hq-worker.js");
const donorPath = path.join(process.env.TEMP || "/tmp", "hq-worker-with-kds.js");

const donor = fs.readFileSync(donorPath, "utf8");
let src = fs.readFileSync(targetPath, "utf8");

const openIdx = donor.indexOf("async function handleAsanaOpenTasks");
const getIdx = donor.indexOf("function getAsanaConfig", openIdx);
if (openIdx < 0 || getIdx < 0) {
  throw new Error("Donor file is missing KDS function block");
}
const fns = donor.slice(openIdx, getIdx);

if (!src.includes('"GET /api/asana/open-tasks"')) {
  src = src.replace(
    '"POST /api/asana/intake",',
    '"POST /api/asana/intake",\n  "GET /api/asana/open-tasks",\n  "POST /api/asana/complete",'
  );
}

if (!src.includes('pathname === "/api/asana/open-tasks"')) {
  const insert = `
    if (url.pathname === "/api/asana/open-tasks") {
      if (request.method !== "GET") {
        return jsonResponse({ ok: false, message: "Use GET for open Asana tickets." }, 405);
      }

      return handleAsanaOpenTasks(request, env, url);
    }

    if (url.pathname === "/api/asana/complete") {
      if (request.method !== "POST") {
        return jsonResponse({ ok: false, message: "Use POST to complete an Asana ticket." }, 405);
      }

      return handleAsanaComplete(request, env, url);
    }

`;
  src = src.replace(
    /(return handleAsanaIntake\(request, env, url\);\r?\n\s*\}\r?\n)/,
    (match) => match + insert
  );
}

if (!src.includes("async function handleAsanaOpenTasks")) {
  if (!src.includes("function getAsanaConfig(env)")) {
    throw new Error("Target missing getAsanaConfig(env)");
  }
  src = src.replace("function getAsanaConfig(env)", `${fns}function getAsanaConfig(env)`);
}

fs.writeFileSync(targetPath, src);
console.log(
  JSON.stringify(
    {
      routes: src.includes('"GET /api/asana/open-tasks"'),
      handlers: src.includes('pathname === "/api/asana/open-tasks"'),
      openTasksFn: src.includes("async function handleAsanaOpenTasks"),
      completeFn: src.includes("async function handleAsanaComplete")
    },
    null,
    2
  )
);
