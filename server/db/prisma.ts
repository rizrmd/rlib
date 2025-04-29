import type { SiteConfig } from "../../client";
import { dir } from "../util/dir";
import { $ } from "bun";
import * as fs from "fs";
import * as path from "path";

export const prismaDBPull = async (config: SiteConfig) => {
  // Get the shared directory path
  const sharedDir = dir.path("shared:");
  
  // Ensure shared directory exists
  dir.ensure("shared:");
  
  // Check if models directory exists and remove it if it does
  const modelsDir = dir.path("shared:models");
  if (fs.existsSync(modelsDir)) {
    console.log("Removing existing models directory...");
    fs.rmSync(modelsDir, { recursive: true, force: true });
  }
  
  // Check if prisma is installed in the shared directory
  const packageJsonPath = path.join(sharedDir, "package.json");
  let needToInstallPrisma = true;
  
  if (fs.existsSync(packageJsonPath)) {
    try {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      if (packageJson.devDependencies?.prisma || packageJson.dependencies?.prisma) {
        needToInstallPrisma = false;
      }
    } catch (error) {
      console.error("Error reading package.json:", error);
    }
  } else {
    // Create package.json if it doesn't exist
    fs.writeFileSync(packageJsonPath, JSON.stringify({
      name: "shared",
      version: "1.0.0",
      type: "module"
    }, null, 2));
  }
  
  // Install prisma if needed
  if (needToInstallPrisma) {
    console.log("Installing prisma in shared directory...");
    try {
      // Change to shared directory, install prisma, then change back
      process.chdir(sharedDir);
      await $`bun add -d prisma`;
      process.chdir(dir.root);
    } catch (error) {
      console.error("Error installing prisma:", error);
      throw error;
    }
  }
  
  // Run prisma db pull
  console.log("Running prisma db pull...");
  try {
    process.chdir(sharedDir);
    await $`bunx prisma db pull`;
    process.chdir(dir.root);
    console.log("Database schema pulled successfully!");
  } catch (error) {
    console.error("Error pulling database schema:", error);
    throw error;
  }
};
