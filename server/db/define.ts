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
  url: string
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
    db[modelName] = {
      findMany: pgFindMany(modelName, modelDef, models, sql),
      findFirst: pgFindFirst(modelName, modelDef, models, sql),
      create: pgCreate(modelName, modelDef, models, sql),
      update: pgUpdate(modelName, modelDef, models, sql),
    };
  }

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

/**
 * Define a database connection based on the provided URL or config
 * This function detects the database type and uses the appropriate driver
 * @param models The model definitions
 * @param connectionInfo Connection URL (PostgreSQL) or Oracle connection string (format: "User Id=x;Password=y;Data Source=z")
 * @returns A model operations object for interacting with the database
 */
export const defineDB = async <T extends { [K in string]: ModelDefinition<K> }>(
  models: T,
  connectionInfo: string
) => {
  // Check if the connectionInfo is an Oracle connection string
  if (connectionInfo.includes("User Id=") || connectionInfo.includes("user=")) {
    // Parse Oracle connection string
    const parseOracleConnectionString = (connStr: string) => {
      const config: { 
        user: string;
        password: string;
        connectString: string;
        [key: string]: any;
      } = {
        user: "",
        password: "",
        connectString: "",
      };
      
      // Split by semicolons and process each key-value pair
      const parts = connStr.split(";");
      for (const part of parts) {
        const [key, value] = part.split("=").map(s => s.trim());
        
        if (!key || !value) continue;
        
        // Map to proper configuration keys
        if (key.toLowerCase() === "user id" || key.toLowerCase() === "user") {
          config.user = value;
        } else if (key.toLowerCase() === "password") {
          config.password = value;
        } else if (key.toLowerCase() === "data source") {
          config.connectString = value;
        } else {
          // Add any other parameters as is
          config[key] = value;
        }
      }
      
      return config;
    };
    
    const oracleConfig = parseOracleConnectionString(connectionInfo);
    return defineOracleDB(models, oracleConfig);
  } else {
    // It's a PostgreSQL connection URL
    return definePostgresDB(models, connectionInfo);
  }
};
