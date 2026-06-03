const fs = require("fs");

function appendEnv(name, value) {
  if (!process.env.GITHUB_ENV) {
    return;
  }

  const delimiter = `EOF_${name}_${Date.now()}`;
  fs.appendFileSync(process.env.GITHUB_ENV, `${name}<<${delimiter}\n${value}\n${delimiter}\n`);
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  let payload = null;

  try {
    payload = text ? JSON.parse(text) : null;
  } catch (error) {
    throw new Error(`Expected JSON from ${url}, got: ${text.slice(0, 500)}`);
  }

  if (!response.ok) {
    throw new Error(payload?.message || payload?.error || `HTTP ${response.status} from ${url}`);
  }

  return payload;
}

async function main() {
  const endpoint = process.env.SECRET_PROVIDER_ENDPOINT || "";
  if (!endpoint) {
    console.log("No managed secret provider configured.");
    return;
  }

  const audience = process.env.SECRET_PROVIDER_AUDIENCE || "jira-board-provisioner";
  const requestUrl = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const requestToken = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;

  if (!requestUrl || !requestToken) {
    throw new Error("GitHub OIDC token request variables are missing. Add `id-token: write` to this workflow.");
  }

  const separator = requestUrl.includes("?") ? "&" : "?";
  const oidc = await fetchJson(`${requestUrl}${separator}audience=${encodeURIComponent(audience)}`, {
    headers: {
      Authorization: `bearer ${requestToken}`,
      Accept: "application/json",
    },
  });

  if (!oidc?.value) {
    throw new Error("GitHub did not return an OIDC token.");
  }

  const managed = await fetchJson(endpoint, {
    headers: {
      Authorization: `Bearer ${oidc.value}`,
      Accept: "application/json",
    },
  });

  const secrets = managed?.secrets || {};
  const names = Object.keys(secrets).filter((name) => secrets[name] !== undefined && secrets[name] !== null && secrets[name] !== "");

  for (const name of names) {
    const value = String(secrets[name]);
    console.log(`::add-mask::${value}`);
    appendEnv(name, value);
  }

  console.log(`Loaded ${names.length} managed secret${names.length === 1 ? "" : "s"} from Cloudflare.`);
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
