const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const sourceDir = path.join(repoRoot, "modern");
const outputDir = path.join(repoRoot, ".cloudflare-hq-assets");
const repositoryName = process.env.BOARD_REPOSITORY_NAME || path.basename(repoRoot);
const githubAssetPrefix = process.env.GITHUB_ASSET_PREFIX || `/${repositoryName}/modern/_astro/`;
const cloudflareAssetPrefix = process.env.CLOUDFLARE_ASSET_PREFIX || "/_astro/";

if (!fs.existsSync(sourceDir)) {
  throw new Error(`Missing modern dashboard output at ${sourceDir}`);
}

fs.rmSync(outputDir, { recursive: true, force: true });
fs.cpSync(sourceDir, outputDir, { recursive: true });

const staticArtifactNames = ["dashboard-data.json", "boards.json"];

for (const artifactName of staticArtifactNames) {
  const artifactPath = path.join(repoRoot, artifactName);

  if (fs.existsSync(artifactPath)) {
    fs.copyFileSync(artifactPath, path.join(outputDir, artifactName));
  }
}

function rewriteHtmlAssets(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const filePath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      rewriteHtmlAssets(filePath);
      continue;
    }

    if (!entry.isFile() || !entry.name.endsWith(".html")) {
      continue;
    }

    const html = fs.readFileSync(filePath, "utf8");
    fs.writeFileSync(filePath, html.replaceAll(githubAssetPrefix, cloudflareAssetPrefix));
  }
}

rewriteHtmlAssets(outputDir);
console.log(`Prepared Cloudflare board and HQ assets at ${outputDir}`);
