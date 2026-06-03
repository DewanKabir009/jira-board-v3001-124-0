import { defineConfig } from "astro/config";
import react from "@astrojs/react";

function normalizeBase(value) {
  if (!value || value === "/") {
    return "/";
  }

  return `/${value.replace(/^\/+|\/+$/g, "")}/`;
}

const repositoryName = process.env.BOARD_REPOSITORY_NAME
  || process.env.GITHUB_REPOSITORY?.split("/")[1]
  || "jira-board-template";

const ownerName = process.env.GITHUB_REPOSITORY_OWNER || "DewanKabir009";
const defaultSite = `https://${ownerName.toLowerCase()}.github.io/${repositoryName}/`;

export default defineConfig({
  output: "static",
  integrations: [react()],
  site: process.env.ASTRO_SITE || process.env.DASHBOARD_URL || defaultSite,
  base: normalizeBase(process.env.ASTRO_BASE || "/"),
  build: {
    format: "directory"
  }
});
