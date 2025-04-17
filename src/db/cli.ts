#!/usr/bin/env bun
/**
 * Database CLI tool for inspecting database structure and generating model files
 */

import { mkdir, writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { existsSync } from 'fs';
import { inspectAll, inspectAllWithProgress } from './postgres/inspect';

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
async function writeModelFile(basePath: string, tableName: string, modelContent: string) {
  const dirPath = join(basePath, tableName);
  await ensureDir(dirPath);
  
  const filePath = join(dirPath, 'model.ts');
  await writeFile(filePath, modelContent);
}

/**
 * Import statement to be added to the model files
 */
const modelImportStatement = `import type { ModelDefinition } from '../../../db/types-lib';\n\n`;

/**
 * Run the database inspection and generate model files
 * @param outputPath Path to store the generated models
 */
async function runInspect(outputPath: string) {
  console.log('Inspecting database tables...');
  
  try {
    const results = await inspectAllWithProgress((tableName, index, total) => {
      console.log(`Processing table ${index+1}/${total}: ${tableName}`);
    });
    
    console.log(`\nFound ${Object.keys(results).length} tables. Generating model files...`);
    
    for (const [tableName, modelDef] of Object.entries(results)) {
      await writeModelFile(outputPath, tableName, modelImportStatement + modelDef);
      console.log(`Generated model file for ${tableName}`);
    }
    
    console.log(`\nDone! Model files written to ${outputPath}`);
  } catch (error) {
    console.error('Error inspecting database:', error);
    process.exit(1);
  }
}

/**
 * Main CLI function
 * Parses command line arguments and runs the appropriate command
 */
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const cwd = process.cwd();
  
  switch (command) {
    case 'inspect':
      // Default output path is ${cwd}/shared/models
      const outputPath = join(cwd, 'shared', 'models');
      await runInspect(outputPath);
      break;
      
    default:
      console.log(`
Database CLI Tool

Available commands:
  inspect - Inspect database tables and generate model files

Usage:
  bun run db:cli inspect    Generate model files from database tables
`);
      break;
  }
}

// Run the CLI when this file is executed directly
if (import.meta.main) {
  main().catch(console.error);
}