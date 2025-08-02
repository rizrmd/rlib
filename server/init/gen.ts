import { $ } from "bun";
import { join } from "path";
import { buildAPI } from "../api/watch";
import { buildPages } from "../page/watch";
import { initEnv } from "./env";
import { initBaseFile } from "./base-file";
import type { SiteConfig } from "../../client";

export const initGen = async (config?: SiteConfig) => {
  // Generate Prisma models if they don't exist
  if (!(await Bun.file(join(process.cwd(), "shared", "models", "index.js")).exists())) {
    console.log("Generating prisma typings...");
    await $`bun prisma generate`.cwd(join(process.cwd(), "shared")).quiet();
  }

  // Initialize environment configuration
  const { apiConfig, pageConfig } = initEnv(config);

  console.log("Generating files...");

  // Initialize base files
  await initBaseFile();

  // Build API types
  console.log("Building API types...");
  await buildAPI(apiConfig);

  // Build page routes
  console.log("Building page routes...");
  await buildPages(pageConfig);

  console.log("Generation completed!");
};