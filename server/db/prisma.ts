import type { SiteConfig } from "../../client";
import { dir } from "../util/dir";
import { $ } from "bun";
import * as fs from "fs";
import * as path from "path";

export const prismaDBPull = async (config: SiteConfig, outputPath?: string) => {
  // Get the shared directory path
  const sharedDir = outputPath ? path.resolve(outputPath, "..") : dir.path("shared:");

  // Ensure shared directory exists
  if (outputPath) {
    if (!fs.existsSync(path.dirname(outputPath))) {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    }
  } else {
    dir.ensure("shared:");
  }

  // Check if models directory exists and remove it if it does
  const modelsDir = outputPath || dir.path("shared:models");
  if (fs.existsSync(modelsDir)) {
    console.log("Removing existing models directory...");
    fs.rmSync(modelsDir, { recursive: true, force: true });
  }

  // Create models directory
  fs.mkdirSync(modelsDir, { recursive: true });

  // Check if prisma is installed in the shared directory
  const packageJsonPath = path.join(sharedDir, "package.json");
  let needToInstallPrisma = true;

  if (fs.existsSync(packageJsonPath)) {
    try {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
      if (
        packageJson.devDependencies?.prisma ||
        packageJson.dependencies?.prisma
      ) {
        needToInstallPrisma = false;
      }
    } catch (error) {
      console.error("Error reading package.json:", error);
    }
  } else {
    // Create package.json if it doesn't exist
    fs.writeFileSync(
      packageJsonPath,
      JSON.stringify(
        {
          name: "shared",
          version: "1.0.0",
          type: "module",
        },
        null,
        2
      )
    );
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

  // Create prisma directory and schema.prisma file if they don't exist
  const prismaDir = path.join(sharedDir, "prisma");
  if (!fs.existsSync(prismaDir)) {
    console.log("Creating prisma directory...");
    fs.mkdirSync(prismaDir, { recursive: true });
  }

  // Create a basic schema.prisma file
  const schemaPath = path.join(prismaDir, "schema.prisma");
  if (!fs.existsSync(schemaPath)) {
    console.log("Creating schema.prisma file...");
    // Get the database URL from environment
    const dbUrl = process.env.DATABASE_URL || "";

    // Determine database provider from URL or config
    let provider = "postgresql";
    if (dbUrl.includes("mysql")) {
      provider = "mysql";
    } else if (dbUrl.includes("sqlite")) {
      provider = "sqlite";
    } else if (dbUrl.includes("mongodb")) {
      provider = "mongodb";
    } else if (dbUrl.includes("sqlserver")) {
      provider = "sqlserver";
    }

    // Create initial schema content
    const schemaContent = `// This is your Prisma schema file,
// learn more about it in the docs: https://pris.ly/d/prisma-schema

generator client {
  provider = "prisma-client-js"
  output   = "../node_modules/@prisma/client"
}

datasource db {
  provider = "${provider}"
  url      = env("DATABASE_URL")
}
`;

    fs.writeFileSync(schemaPath, schemaContent);
  }

  // Run prisma db pull
  console.log("Running prisma db pull...");
  try {
    // Save original directory to ensure we can return to it
    const originalDir = process.cwd();

    // Change to the shared directory
    process.chdir(sharedDir);

    // Create .env file with DATABASE_URL if it doesn't exist
    const envPath = path.join(sharedDir, ".env");
    if (!fs.existsSync(envPath)) {
      console.log("Creating .env file with DATABASE_URL...");
      fs.writeFileSync(envPath, `DATABASE_URL="${process.env.DATABASE_URL}"\n`);
    }

    // Use explicit schema path to ensure the command finds it
    const schemaPath = path.join("prisma", "schema.prisma");
    await $`bunx prisma db pull --schema=${schemaPath}`;

    // Return to the original directory
    process.chdir(originalDir);
    console.log("Database schema pulled successfully!");

    // Generate prisma client if it doesn't exist yet
    console.log("Generating Prisma client...");
    process.chdir(sharedDir);
    await $`bunx prisma generate --schema=${schemaPath}`;
    process.chdir(originalDir);

    // Create models directory if needed
    const modelDir = outputPath || path.join(sharedDir, "models");
    if (!fs.existsSync(modelDir)) {
      fs.mkdirSync(modelDir, { recursive: true });
    }

    console.log("Prisma setup completed successfully.");
  } catch (error) {
    console.error("Error pulling database schema:", error);
    // Make sure we return to root directory even if there's an error
    if (dir.root) {
      process.chdir(dir.root);
    }
    throw error;
  }
};
