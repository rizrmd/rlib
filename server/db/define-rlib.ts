import { SQL } from "bun";
import {
  createFindMany as pgFindMany,
  createFindFirst as pgFindFirst,
} from "./postgres/query-read";
import {
  createCreate as pgCreate,
  createUpdate as pgUpdate,
} from "./postgres/query-write";
import { createOracleClient } from "./oracle";
import type { ModelDefinition } from "./types-gen";
import type { ModelOperations } from "./types-lib";
import type { SiteConfig } from "../../client";

/**
 * Define a database connection to PostgreSQL using Bun's SQL driver
 * @param models The model definitions
 * @param url The database connection URL (PostgreSQL format)
 * @returns A model operations object for interacting with the database
 */
export const definePostgresDB = async <
  T extends { [K in string]: ModelDefinition<K> }
>(
  models: T,
  url: string,
  config: SiteConfig
) => {
  const db = {} as ModelOperations<T>;

  const sql = new SQL({ url });
  const timeout = setTimeout(() => {
    console.error(
      "Database connection timed out (> 5s). Please check your DATABASE_URL."
    );
    process.exit(1);
  }, 5000);
  await sql.connect();
  clearTimeout(timeout);

  // Create operations for each model
  for (const modelName of Object.keys(models) as Array<keyof T>) {
    const modelDef = models[modelName];

    // Set up model operations using sql directly
    (db as any)[modelName] = {
      findMany: pgFindMany(modelName, modelDef, models, sql),
      findFirst: pgFindFirst(modelName, modelDef, models, sql),
      create: pgCreate(modelName, modelDef, models, sql),
      update: pgUpdate(modelName, modelDef, models, sql),
    };
  }

  // Add raw query method to the database object
  (db as any)._rawQuery = async <T = any>(
    query: string,
    params?: any[]
  ): Promise<T[]> => {
    try {
      // For raw SQL queries, we use sql.unsafe()
      // This is safe when parameters are provided separately and not directly interpolated
      const result = await sql.unsafe(query, params || []);
      return result as unknown as T[];
    } catch (error) {
      console.error("Error executing raw SQL query:", error);
      throw error;
    }
  };

  return db;
};

/**
 * Define a database connection to Oracle using the node-oracledb driver
 * @param models The model definitions
 * @param config Oracle connection configuration
 * @returns A model operations object for interacting with the database
 */
export const defineOracleDB = async <
  T extends { [K in string]: ModelDefinition<K> }
>(
  models: T,
  config: {
    user: string;
    password: string;
    connectString: string;
    poolMax?: number;
    poolMin?: number;
    poolIncrement?: number;
    poolTimeout?: number;
  }
) => {
  // Create an Oracle client
  const oracleClient = createOracleClient(models, config);

  // Initialize the connection pool
  const timeout = setTimeout(() => {
    console.error(
      "Oracle database connection timed out (> 5s). Please check your connection settings."
    );
    process.exit(1);
  }, 5000);

  try {
    await oracleClient.initialize();
    clearTimeout(timeout);

    // Get model operations from the Oracle client
    return oracleClient.getModelOperations();
  } catch (error) {
    clearTimeout(timeout);
    console.error("Failed to connect to Oracle database:", error);
    throw error;
  }
};

