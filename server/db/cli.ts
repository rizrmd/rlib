#!/usr/bin/env bun
/**
 * Database CLI tool for inspecting database structure and generating model files
 */

import { existsSync } from "fs";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import {
  inspectAllWithProgress,
  inspectAllWithProgressParallel,
} from "./postgres/inspect";
import { SQL } from "bun";

/**
 * Ensure directory exists, creating it if needed
 * @param dir Directory path to ensure exists
 */
async function ensureDir(dir: string) {
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
}

/**
 * Write model file for a table
 * @param basePath Base path for output
 * @param tableName Table name
 * @param modelContent Model content to write
 */
async function writeModelFile(
  basePath: string,
  tableName: string,
  modelContent: string
) {
  const dirPath = join(basePath, tableName);
  await ensureDir(dirPath);

  const filePath = join(dirPath, "model.ts");
  await writeFile(filePath, modelContent);
}

/**
 * Import statement to be added to the model files
 */
const modelImportStatement = `import type { ModelDefinition } from "rlib/server";\n\n`;

/**
 * Generate index.ts file that exports all models
 * @param outputPath Base path for output
 * @param tableNames Array of table names
 */
async function generateIndexFile(outputPath: string, tableNames: string[]) {
  const indexPath = join(outputPath, "index.ts");

  const exportStatements = tableNames
    .map(
      (tableName) =>
        `export { default as ${tableName} } from './${tableName}/model';`
    )
    .join("\n");

  const indexContent = `/**
 * Auto-generated model exports
 * Generated on ${new Date().toISOString()}
 */

${exportStatements}
`;

  await writeFile(indexPath, indexContent);
}

/**
 * Run the database inspection and generate model files
 * @param outputPath Path to store the generated models
 * @param options Configuration options
 */
async function runInspect(
  outputPath: string,
  options: { parallel: boolean; concurrency: number }
) {
  console.log("Inspecting database tables...");

  try {
    const sql = new SQL({ url: process.env.DATABASE_URL });

    if (!options.parallel)
      console.log("Using sequential processing (--sequential)");

    const startTime = Date.now();

    // Track progress with a counter instead of individual table names
    let processedCount = 0;
    const progressCallback = (
      _tableName: string,
      _index: number,
      total: number
    ) => {
      processedCount++;
      // Update progress on the same line to reduce verbosity
      process.stdout.write(
        `\rProcessing tables: ${processedCount}/${total} [${Math.round(
          (processedCount / total) * 100
        )}%]`
      );
    };

    // Use either parallel or sequential inspection based on options
    const results = options.parallel
      ? await inspectAllWithProgressParallel(
          sql,
          options.concurrency,
          progressCallback
        )
      : await inspectAllWithProgress(sql, progressCallback);

    const endTime = Date.now();
    const duration = (endTime - startTime) / 1000;

    const tableNames = Object.keys(results);
    // Clear the progress line and move to next line
    process.stdout.write("\r\n");
    console.log(
      `Processed ${tableNames.length} tables. Generated in ${duration.toFixed(
        2
      )} seconds.`
    );

    // Write model files without logging each one
    for (const [tableName, modelDef] of Object.entries(results)) {
      await writeModelFile(
        outputPath,
        tableName,
        modelImportStatement + modelDef
      );
    }

    // Generate the index.ts file
    await generateIndexFile(outputPath, tableNames);

    
    console.log(
      `${tableNames.length} model(s) written in ${outputPath}`
    );
  } catch (error) {
    console.error("Error inspecting database:", error);
    process.exit(1);
  }
}

/**
 * Parse command line arguments
 * @param args Command line arguments
 * @returns Parsed options
 */
function parseArgs(args: string[]): {
  command: string;
  parallel: boolean;
  concurrency: number;
  outputPath?: string;
} {
  const options = {
    command: args[0] || "",
    parallel: true, // Default to parallel execution
    concurrency: 4,
    outputPath: undefined as string | undefined,
  };

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--sequential") {
      // Changed from --parallel to --sequential
      options.parallel = false;
    } else if (arg) {
      if (arg.startsWith("--concurrency=")) {
        const value = parseInt(arg.split("=")[1] + "", 10);
        if (!isNaN(value) && value > 0) {
          options.concurrency = value;
        }
      } else if (arg.startsWith("--output=")) {
        options.outputPath = arg.split("=")[1];
      }
    }
  }

  return options;
}

/**
 * Main CLI function
 * Parses command line arguments and runs the appropriate command
 */
async function main() {
  const args = process.argv.slice(2);
  const options = parseArgs(args);
  const cwd = process.cwd();

  switch (options.command) {
    case "inspect":
    case "pull":
      // Default output path is ${cwd}/shared/models unless specified
      const outputPath = options.outputPath || join(cwd, "shared", "models");
      await runInspect(outputPath, {
        parallel: options.parallel,
        concurrency: options.concurrency,
      });
      break;

    default:
      console.log(`
Database CLI Tool

Available commands:
  inspect - Inspect database tables and generate model files

Usage:
  bun db inspect|pull [options]    Generate model files from database tables

Options:
  --sequential           Use sequential processing instead of parallel
  --concurrency=N        Number of parallel operations (default: 4)
  --output=PATH          Custom output directory for model files
`);
      break;
  }
}

// Run the CLI when this file is executed directly
if (import.meta.main) {
  main().catch(console.error);
}
