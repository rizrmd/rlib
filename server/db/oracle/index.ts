// filepath: /Users/riz/Developer/rlib/server/db/oracle/index.ts
import oracledb from "oracledb";
import type { ModelDefinition } from "../types-gen";
import type { ModelOperations } from "../types-lib";
import { createFindMany, createFindFirst } from "./query-read";
import { createCreate, createUpdate } from "./query-write";
import {
  addInspectMethodsToClient,
  inspectAll,
  inspectAllWithProgress,
  inspectAllWithProgressParallel,
  inspectTable,
} from "./inspect";

/**
 * Utility type that removes the first argument from a function signature
 */
type RemoveFirstArg<F> = F extends (arg1: any, ...args: infer R) => infer T
  ? (...args: R) => T
  : never;

/**
 * Oracle database client implementation.
 * Creates and manages connections to Oracle database and provides
 * methods to interact with database models.
 */
export class OracleClient<M extends Record<string, ModelDefinition<string>>> {
  private connectionPool: oracledb.Pool | null = null;
  private models: M;

  /**
   * Add inspect methods to client
   */
  inspect: {
    getTables: (schema?: string) => Promise<string[]>;
    getTableColumns: (tableName: string, schema?: string) => Promise<any[]>;
    getAllColumns: (schema?: string) => Promise<Record<string, any[]>>;
    getTableRelationships: (schema?: string) => Promise<any[]>;
    getDatabaseStructure: (schema?: string) => Promise<any>;
    inspectTable: RemoveFirstArg<typeof inspectTable>;
    inspectAll: RemoveFirstArg<typeof inspectAll>;
    inspectAllWithProgress: RemoveFirstArg<typeof inspectAllWithProgress>;
    inspectAllWithProgressParallel: RemoveFirstArg<
      typeof inspectAllWithProgressParallel
    >;
  } = {} as any;

  /**
   * Constructor for the Oracle database client
   * @param models Model definitions for the database
   * @param config Oracle connection configuration
   */
  constructor(
    models: M,
    private config: {
      user: string;
      password: string;
      connectString: string;
      poolMax?: number;
      poolMin?: number;
      poolIncrement?: number;
      poolTimeout?: number;
    }
  ) {
    this.models = models;

    // Configure oracledb to return objects instead of arrays by default
    oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;

    // Enable support for returning auto-increment values (RETURNING INTO)
    oracledb.autoCommit = false;
  }

  /**
   * Initialize the Oracle connection pool
   */
  async initialize(): Promise<void> {
    try {
      // Default pool settings
      const defaultPoolConfig = {
        poolMax: 10,
        poolMin: 2,
        poolIncrement: 1,
        poolTimeout: 60,
      };

      // Merge with user config
      const poolConfig = {
        ...defaultPoolConfig,
        ...this.config,
      };

      this.connectionPool = await oracledb.createPool({
        user: this.config.user,
        password: this.config.password,
        connectString: this.config.connectString,
        poolMax: poolConfig.poolMax,
        poolMin: poolConfig.poolMin,
        poolIncrement: poolConfig.poolIncrement,
        poolTimeout: poolConfig.poolTimeout,
      });

      // Initialize inspect methods
      addInspectMethodsToClient(this);
    } catch (error) {
      console.error("Failed to initialize Oracle connection pool:", error);
      throw error;
    }
  }

  /**
   * Close the Oracle connection pool
   */
  async close(): Promise<void> {
    if (this.connectionPool) {
      try {
        await this.connectionPool.close(0); // Force close all connections
        this.connectionPool = null;
        console.log("Oracle connection pool closed");
      } catch (error) {
        console.error("Error closing Oracle connection pool:", error);
        throw error;
      }
    }
  }

  /**
   * Get the Oracle connection pool
   * @returns The Oracle connection pool
   * @throws Error if the connection pool is not initialized
   */
  getConnectionPool(): oracledb.Pool {
    if (!this.connectionPool) {
      throw new Error(
        "Oracle connection pool not initialized. Call initialize() first."
      );
    }
    return this.connectionPool;
  }

  /**
   * Get a model operation for a specific model.
   * @param modelName The name of the model to get operations for
   * @returns The model operations
   */
  model<N extends keyof M>(modelName: N) {
    if (!this.connectionPool) {
      throw new Error(
        "Oracle connection pool not initialized. Call initialize() first."
      );
    }

    const modelDef = this.models[modelName];

    // Create operations for the model
    return {
      findMany: createFindMany(
        modelName,
        modelDef,
        this.models,
        this.connectionPool
      ),
      findFirst: createFindFirst(
        modelName,
        modelDef,
        this.models,
        this.connectionPool
      ),
      create: createCreate(
        modelName,
        modelDef,
        this.models,
        this.connectionPool
      ),
      update: createUpdate(
        modelName,
        modelDef,
        this.models,
        this.connectionPool
      ),
    };
  }

  /**
   * Get operations for all models.
   * @returns Operations for all models
   */
  getModelOperations(): ModelOperations<M> {
    if (!this.connectionPool) {
      throw new Error(
        "Oracle connection pool not initialized. Call initialize() first."
      );
    }

    const operations: Partial<ModelOperations<M>> = {};

    // Create operations for all models
    for (const modelName in this.models) {
      if (Object.prototype.hasOwnProperty.call(this.models, modelName)) {
        const modelDef = this.models[modelName];
        (operations as any)[modelName as keyof M] = {
          findMany: createFindMany(
            modelName as keyof M,
            modelDef,
            this.models,
            this.connectionPool
          ),
          findFirst: createFindFirst(
            modelName as keyof M,
            modelDef,
            this.models,
            this.connectionPool
          ),
          create: createCreate(
            modelName as keyof M,
            modelDef,
            this.models,
            this.connectionPool
          ),
          update: createUpdate(
            modelName as keyof M,
            modelDef,
            this.models,
            this.connectionPool
          ),
        };
      }
    }

    // Add raw query method to the operations object
    (operations as any)._rawQuery = this.raw.bind(this);

    return operations as ModelOperations<M>;
  }

  /**
   * Execute a raw SQL query on the Oracle database.
   * @param sql The SQL query to execute
   * @param params Parameters for the SQL query
   * @returns The query result
   */
  async raw<T = any>(sql: string, params?: any[]): Promise<T[]> {
    if (!this.connectionPool) {
      throw new Error(
        "Oracle connection pool not initialized. Call initialize() first."
      );
    }

    let connection;
    try {
      connection = await this.connectionPool.getConnection();
      const result = await connection.execute(sql, params || []);

      // Return the rows as an array of objects
      if (result && result.rows) {
        return result.rows as T[];
      }

      return [];
    } finally {
      if (connection) {
        try {
          await connection.close();
        } catch (err) {
          console.error("Error closing Oracle connection:", err);
        }
      }
    }
  }

  /**
   * Execute a raw SQL query in a transaction.
   * @param callback Function that will receive a transaction object
   * @returns The result of the callback function
   */
  async transaction<T>(
    callback: (trx: {
      execute: <R = any>(sql: string, params?: any[]) => Promise<R[]>;
      commit: () => Promise<void>;
      rollback: () => Promise<void>;
    }) => Promise<T>
  ): Promise<T> {
    if (!this.connectionPool) {
      throw new Error(
        "Oracle connection pool not initialized. Call initialize() first."
      );
    }

    let connection;
    try {
      connection = await this.connectionPool.getConnection();

      // Start transaction
      await connection.execute("BEGIN");

      // Create transaction object
      const trx = {
        execute: async <R = any>(sql: string, params?: any[]): Promise<R[]> => {
          const result = await connection!.execute(sql, params || []);
          if (result && result.rows) {
            return result.rows as R[];
          }
          return [];
        },
        commit: async () => {
          await connection!.execute("COMMIT");
        },
        rollback: async () => {
          await connection!.execute("ROLLBACK");
        },
      };

      // Execute the callback with the transaction object
      const result = await callback(trx);

      // Commit if no errors were thrown
      await trx.commit();

      return result;
    } catch (error) {
      // Rollback on error
      if (connection) {
        try {
          await connection.execute("ROLLBACK");
        } catch (rollbackError) {
          console.error("Error during transaction rollback:", rollbackError);
        }
      }
      throw error;
    } finally {
      if (connection) {
        try {
          await connection.close();
        } catch (err) {
          console.error("Error closing Oracle connection:", err);
        }
      }
    }
  }
}

/**
 * Create a new Oracle database client instance.
 * @param models Model definitions for the database
 * @param config Oracle connection configuration
 * @returns A new Oracle database client instance
 */
export function createOracleClient<
  M extends Record<string, ModelDefinition<string>>
>(
  models: M,
  config: {
    user: string;
    password: string;
    connectString: string;
    poolMax?: number;
    poolMin?: number;
    poolIncrement?: number;
    poolTimeout?: number;
  }
): OracleClient<M> {
  return new OracleClient(models, config);
}
