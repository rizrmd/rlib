import { rimraf } from "rimraf";
import { dir } from "../util/dir";

export const initBaseFile = async () => {
  if (dir.exists("frontend:src/lib/gen")) {
    await rimraf(dir.path("frontend:src/lib/gen"));
  }
  dir.ensure("frontend:src/lib/gen");

  const base_url = Bun.file(dir.path("frontend:src/lib/gen/base-url.ts"));
  await base_url.write(`\
import { defineBaseUrl, type SiteConfig } from "rlib/client";
import raw_config from "../../../../config.json";

const config = raw_config satisfies SiteConfig;
export const baseUrl = defineBaseUrl(config);
`);

  const server_base = Bun.file(dir.path("backend:src/gen/base-url.ts"));

  if (!(await server_base.exists())) {
    await server_base.write(`\
  import { defineBaseUrl, type SiteConfig } from "rlib/server";
  import raw_config from "../../../config.json";
  
  const config = raw_config satisfies SiteConfig;
  export const baseUrl = defineBaseUrl(config);
  `);
  }

  await ensureGitIgnore([
    "frontend/src/lib/gen",
    "frontend/src/lib/gen/*",
    "backend/src/gen",
    "backend/src/gen/*",
  ]);
};

export async function ensureGitIgnore(patterns: string[]): Promise<void> {
  const gitignorePath = dir.path("root:.gitignore");
  let content = "";

  try {
    content = await Bun.file(gitignorePath).text();
  } catch (error) {
    // File may not exist yet, continue with empty content
  }

  const lines = content.split("\n");
  const newPatterns = patterns.filter((pattern) => !lines.includes(pattern));

  if (newPatterns.length > 0) {
    // Add a blank line if the file doesn't end with one and has content
    const appendContent =
      content.length > 0 && !content.endsWith("\n\n")
        ? "\n\n" + newPatterns.join("\n") + "\n"
        : newPatterns.join("\n") + "\n";

    await Bun.file(gitignorePath).write(content + appendContent);
  }
}
