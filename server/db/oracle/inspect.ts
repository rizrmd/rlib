/**
 * Oracle database structure inspection utilities
 * Provides functions to query table structure, columns, and relationships
 */

import oracledb from "oracledb";
import type { RelationDefinition } from "../types-gen";

export interface TableColumn {
  table_schema: string;
  table_name: string;
  column_name: string;
  data_type: string;
  column_default: string | null;
  is_nullable: string;
  is_primary_key: boolean;
}

export interface TableRelationship {
  constraint_name: string;
  source_schema: string;
  source_table: string;
  source_column: string;
  target_schema: string;
  target_table: string;
  target_column: string;
  relationship_type?: "has_many" | "belongs_to" | "has_one";
}

export interface DatabaseStructure {
  tables: string[];
  columns: Record<string, TableColumn[]>;
  relationships: TableRelationship[];
}

/**
 * Model definition interfaces for formatted output
 */
export interface ColumnDefinition {
  type: string;
  is_primary_key: boolean;
}

export interface ModelRelations {
  [relationName: string]: RelationDefinition;
}

export interface ModelDefinition {
  table: string;
  columns: Record<string, ColumnDefinition>;
  relations: ModelRelations;
}

/**
 * Get all tables in an Oracle database
 */
export async function getTables(
  pool: oracledb.Pool,
  schema?: string
): Promise<string[]> {
  const ownerClause = schema
    ? `AND OWNER = '${schema.toUpperCase()}'`
    : `AND OWNER = USER`;

  let connection;
  try {
    connection = await pool.getConnection();
    const result = await connection.execute(`
      SELECT TABLE_NAME 
      FROM ALL_TABLES 
      WHERE TABLE_NAME NOT LIKE 'BIN$%' ${ownerClause}
      ORDER BY TABLE_NAME
    `);

    if (result.rows) {
      return result.rows.map((row: any) => row.TABLE_NAME);
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
 * Get all columns for a specific table in an Oracle database
 */
export async function getTableColumns(
  pool: oracledb.Pool,
  tableName: string,
  schema?: string
): Promise<TableColumn[]> {
  const ownerClause = schema
    ? `AND c.OWNER = '${schema.toUpperCase()}'`
    : `AND c.OWNER = USER`;

  let connection;
  try {
    connection = await pool.getConnection();
    const result = await connection.execute(
      `
      SELECT
        c.OWNER as table_schema,
        c.TABLE_NAME as table_name,
        c.COLUMN_NAME as column_name,
        c.DATA_TYPE as data_type,
        c.DATA_DEFAULT as column_default,
        c.NULLABLE as is_nullable,
        CASE WHEN pk.COLUMN_NAME IS NOT NULL THEN 1 ELSE 0 END as is_primary_key
      FROM
        ALL_TAB_COLUMNS c
      LEFT JOIN (
        SELECT
          cons.OWNER,
          cons.TABLE_NAME,
          cols.COLUMN_NAME
        FROM
          ALL_CONSTRAINTS cons
        JOIN
          ALL_CONS_COLUMNS cols
          ON cols.CONSTRAINT_NAME = cons.CONSTRAINT_NAME
          AND cols.OWNER = cons.OWNER
        WHERE
          cons.CONSTRAINT_TYPE = 'P'
          ${schema
        ? `AND cons.OWNER = '${schema.toUpperCase()}'`
        : `AND cons.OWNER = USER`
      }
      ) pk
        ON c.OWNER = pk.OWNER
        AND c.TABLE_NAME = pk.TABLE_NAME
        AND c.COLUMN_NAME = pk.COLUMN_NAME
      WHERE
        c.TABLE_NAME = :tableName
        ${ownerClause}
      ORDER BY
        c.COLUMN_ID
    `,
      [tableName]
    );

    if (result.rows) {
      // Normalize property names to handle Oracle's uppercase return values
      return result.rows.map((row: any) => {
        const normalizedRow: TableColumn = {
          table_schema: row.TABLE_SCHEMA || row.table_schema || "",
          table_name: row.TABLE_NAME || row.table_name || "",
          column_name: row.COLUMN_NAME || row.column_name || "",
          data_type: row.DATA_TYPE || row.data_type || "",
          column_default: row.COLUMN_DEFAULT || row.column_default || null,
          is_nullable: row.IS_NULLABLE || row.is_nullable || "NO",
          is_primary_key: Boolean(row.IS_PRIMARY_KEY || row.is_primary_key),
        };
        return normalizedRow;
      });
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
 * Get all columns for all tables in an Oracle database
 */
export async function getAllColumns(
  pool: oracledb.Pool,
  schema?: string
): Promise<Record<string, TableColumn[]>> {
  const ownerClause = schema
    ? `AND c.OWNER = '${schema.toUpperCase()}'`
    : `AND c.OWNER = USER`;

  let connection;
  try {
    connection = await pool.getConnection();
    const result = await connection.execute(`
      SELECT
        c.OWNER as table_schema,
        c.TABLE_NAME as table_name,
        c.COLUMN_NAME as column_name,
        c.DATA_TYPE as data_type,
        c.DATA_DEFAULT as column_default,
        c.NULLABLE as is_nullable,
        CASE WHEN pk.COLUMN_NAME IS NOT NULL THEN 1 ELSE 0 END as is_primary_key
      FROM
        ALL_TAB_COLUMNS c
      LEFT JOIN (
        SELECT
          cons.OWNER,
          cons.TABLE_NAME,
          cols.COLUMN_NAME
        FROM
          ALL_CONSTRAINTS cons
        JOIN
          ALL_CONS_COLUMNS cols
          ON cols.CONSTRAINT_NAME = cons.CONSTRAINT_NAME
          AND cols.OWNER = cons.OWNER
        WHERE
          cons.CONSTRAINT_TYPE = 'P'
          ${schema
        ? `AND cons.OWNER = '${schema.toUpperCase()}'`
        : `AND cons.OWNER = USER`
      }
      ) pk
        ON c.OWNER = pk.OWNER
        AND c.TABLE_NAME = pk.TABLE_NAME
        AND c.COLUMN_NAME = pk.COLUMN_NAME
      WHERE
        c.TABLE_NAME NOT LIKE 'BIN$%'
        ${ownerClause}
      ORDER BY
        c.TABLE_NAME, c.COLUMN_ID
    `);

    if (!result.rows) {
      return {};
    }

    // Use reduce to build the object in a TypeScript-friendly way
    const columnsByTable = (result.rows as any[]).reduce<
      Record<string, TableColumn[]>
    >((acc, row) => {
      // Normalize the table name for consistent lookup
      const tableName = row.TABLE_NAME || row.table_name;
      if (!acc[tableName]) {
        acc[tableName] = [];
      }

      // Create normalized column object
      const normalizedColumn: TableColumn = {
        table_schema: row.TABLE_SCHEMA || row.table_schema || "",
        table_name: tableName || "",
        column_name: row.COLUMN_NAME || row.column_name || "",
        data_type: row.DATA_TYPE || row.data_type || "",
        column_default: row.COLUMN_DEFAULT || row.column_default || null,
        is_nullable: row.IS_NULLABLE || row.is_nullable || "NO",
        is_primary_key: Boolean(row.IS_PRIMARY_KEY || row.is_primary_key),
      };

      acc[tableName].push(normalizedColumn);
      return acc;
    }, {});

    return columnsByTable;
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
 * Get all relationships between tables in an Oracle database
 */
export async function getTableRelationships(
  pool: oracledb.Pool,
  schema?: string
): Promise<TableRelationship[]> {
  const ownerClause = schema
    ? `AND c.OWNER = '${schema.toUpperCase()}'`
    : `AND c.OWNER = USER`;

  let connection;
  try {
    connection = await pool.getConnection();
    const result = await connection.execute(`
      SELECT
        c.CONSTRAINT_NAME as constraint_name,
        c.OWNER as source_schema,
        c.TABLE_NAME as source_table,
        cc.COLUMN_NAME as source_column,
        r.OWNER as target_schema,
        r.TABLE_NAME as target_table,
        rc.COLUMN_NAME as target_column
      FROM
        ALL_CONSTRAINTS c
      JOIN
        ALL_CONSTRAINTS r ON c.R_CONSTRAINT_NAME = r.CONSTRAINT_NAME
        AND c.R_OWNER = r.OWNER
      JOIN
        ALL_CONS_COLUMNS cc ON c.CONSTRAINT_NAME = cc.CONSTRAINT_NAME
        AND c.OWNER = cc.OWNER
      JOIN
        ALL_CONS_COLUMNS rc ON r.CONSTRAINT_NAME = rc.CONSTRAINT_NAME
        AND r.OWNER = rc.OWNER
      WHERE
        c.CONSTRAINT_TYPE = 'R'
        ${ownerClause}
      ORDER BY
        c.TABLE_NAME, cc.COLUMN_NAME
    `);

    if (result.rows) {
      // Map the result rows to ensure consistent property casing
      return result.rows.map((row: any) => {
        // Convert all keys to lowercase for consistency
        const normalizedRow: TableRelationship = {
          constraint_name: row.CONSTRAINT_NAME || row.constraint_name || "",
          source_schema: row.SOURCE_SCHEMA || row.source_schema || "",
          source_table: row.SOURCE_TABLE || row.source_table || "",
          source_column: row.SOURCE_COLUMN || row.source_column || "",
          target_schema: row.TARGET_SCHEMA || row.target_schema || "",
          target_table: row.TARGET_TABLE || row.target_table || "",
          target_column: row.TARGET_COLUMN || row.target_column || "",
        };
        return normalizedRow;
      });
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
 * Get the full database structure including tables, columns and relationships
 */
export async function getDatabaseStructure(
  pool: oracledb.Pool,
  schema?: string
): Promise<DatabaseStructure> {
  const tables = await getTables(pool, schema);
  const columns = await getAllColumns(pool, schema);
  const relationships = await getTableRelationships(pool, schema);

  return {
    tables,
    columns,
    relationships,
  };
}

/**
 * Maps Oracle data types to simplified types for model definitions
 * @param oracleType Oracle data type
 * @returns Simplified type (text, number, boolean, datetime, etc.)
 */
function mapDataType(oracleType: string): string {
  // Convert Oracle types to simplified types
  const typeMap: Record<string, string> = {
    // String types
    VARCHAR2: "text",
    NVARCHAR2: "text",
    CHAR: "text",
    NCHAR: "text",
    CLOB: "text",
    NCLOB: "text",
    // Numeric types
    NUMBER: "number",
    FLOAT: "number",
    BINARY_FLOAT: "number",
    BINARY_DOUBLE: "number",
    // Date/Time types
    DATE: "date",
    TIMESTAMP: "datetime",
    "TIMESTAMP WITH TIME ZONE": "datetime",
    "TIMESTAMP WITH LOCAL TIME ZONE": "datetime",
    // Boolean types (Oracle uses NUMBER(1) typically)
    // Binary data types
    BLOB: "binary",
    RAW: "binary",
    "LONG RAW": "binary",
    // JSON
    JSON: "json",
  };

  return typeMap[oracleType] || "text"; // Default to text for unknown types
}

/**
 * Simplify relation name by applying naming conventions
 * @param modelName The model name for the relation
 * @param relationType The type of relationship (has_many, belongs_to, etc.)
 * @returns A simplified relation name
 */
function simplifyRelationName(modelName: string, relationType: string): string {
  // Remove single character prefix if it exists (e.g., T_SALES_DOWNLOAD -> sales_download)
  let simplifiedName = modelName;
  if (modelName.length > 2 && modelName[1] === "_") {
    simplifiedName = modelName.substring(2);
  }

  // No longer convert to lowercase - preserve original case
  // simplifiedName = simplifiedName.toLowerCase();

  // If it's a has_many relationship, pluralize by adding 's'
  if (relationType === "has_many") {
    return simplifiedName + "s";
  }

  // For other relationship types, just use the simplified name as is
  return simplifiedName;
}

/**
 * Generate model definition for a specific table
 * @param pool Oracle connection pool
 * @param tableName Name of the table
 * @param schema Optional schema name
 * @returns Model definition object
 */
export async function generateModelDefinition(
  pool: oracledb.Pool,
  tableName: string,
  schema?: string
): Promise<ModelDefinition> {
  // Get columns and relationships for the table
  const columns = await getTableColumns(pool, tableName, schema);
  const allRelationships = await getTableRelationships(pool, schema);

  // Filter relationships that are relevant to this table
  // 1. Source relationships (belongs_to)
  const sourceRelationships = allRelationships.filter(
    (rel) => rel.source_table.toUpperCase() === tableName.toUpperCase()
  );

  // 2. Target relationships (has_many/has_one)
  const targetRelationships = allRelationships.filter(
    (rel) => rel.target_table.toUpperCase() === tableName.toUpperCase()
  );

  // Build columns object - keep original case
  const columnsDef: Record<string, ColumnDefinition> = {};
  columns.forEach((col) => {
  columnsDef[col.column_name] = {
      type: mapDataType(col.data_type),
      is_primary_key: col.is_primary_key,
    };
  });

  // Build relations object
  const relationsDef: ModelRelations = {};

  // Add source relationships (belongs_to)
  sourceRelationships.forEach((rel) => {
    // Use simplified relation name instead of the raw column name
    const relationName = simplifyRelationName(rel.target_table, "belongs_to");
    relationsDef[relationName] = {
      type: "belongs_to",
      from: rel.source_column,
      to: {
        model: rel.target_table,
        column: rel.target_column,
      },
    };
  });

  // Add target relationships (has_many/has_one)
  targetRelationships.forEach((rel) => {
    // Check if this might be a has_one relationship based on uniqueness constraints
    // For now default to has_many, but this could be expanded to detect unique constraints
    const type = "has_many";

    // Use simplified relation name
    const relationName = simplifyRelationName(rel.source_table, type);
    relationsDef[relationName] = {
      type,
      from: rel.target_column,
      to: {
        model: rel.source_table,
        column: rel.source_column,
      },
    };
  });

  return {
    table: tableName, // Keep original case
    columns: columnsDef,
    relations: relationsDef,
  };
}

/**
 * Format a model definition to code string in the specified format
 * @param modelDef Model definition object
 * @returns Formatted string representation
 */
export function formatModelDefinition(modelDef: ModelDefinition): string {
  return `export default {
  table: "${modelDef.table}",
  columns: {
${Object.entries(modelDef.columns)
      .map(
        ([colName, colDef]) => `    ${colName}: {
      type: "${colDef.type}",
      is_primary_key: ${colDef.is_primary_key}
    }`
      )
      .join(",\n")}
  },
  relations: {${Object.keys(modelDef.relations).length > 0
      ? "\n" +
      Object.entries(modelDef.relations)
        .map(
          ([relName, relDef]) => `    ${relName}: {
      type: "${relDef.type}",
      from: "${relDef.from}",
      to: {
        model: "${relDef.to.model}",
        column: "${relDef.to.column}",
      },
    }`
        )
        .join(",\n") +
      "\n  "
      : ""
    }},
} as const satisfies ModelDefinition<"${modelDef.table}">;`;
}

/**
 * Inspect a table and generate a formatted model definition
 * @param pool Oracle connection pool
 * @param tableName Name of the table to inspect
 * @param schema Optional schema name
 * @returns Formatted model definition as a string
 */
export async function inspectTable(
  pool: oracledb.Pool,
  tableName: string,
  schema?: string
): Promise<string> {
  const modelDef = await generateModelDefinition(pool, tableName, schema);
  return formatModelDefinition(modelDef);
}

/**
 * Inspect all tables in the database and generate formatted model definitions
 * @param pool Oracle connection pool
 * @param schema Optional schema name
 * @returns Record of table names to their formatted model definitions
 */
export async function inspectAll(
  pool: oracledb.Pool,
  schema?: string
): Promise<Record<string, string>> {
  const tables = await getTables(pool, schema);
  const results: Record<string, string> = {};

  // Process each table to generate its model definition
  for (const tableName of tables) {
    results[tableName] = await inspectTable(pool, tableName, schema);
  }

  return results;
}

/**
 * Inspect all tables in the database and generate formatted model definitions with progress tracking
 * @param pool Oracle connection pool
 * @param schema Optional schema name
 * @param progressCallback Optional callback function to track progress
 * @param skipPatterns Optional array of wildcard patterns for tables to skip
 * @returns Record of table names to their formatted model definitions
 */
export async function inspectAllWithProgress(
  pool: oracledb.Pool,
  schema?: string,
  progressCallback?: (tableName: string, index: number, total: number) => void,
  skipPatterns?: string[]
): Promise<Record<string, string>> {
  const tables = await getTables(pool, schema);
  const results: Record<string, string> = {};
  const total = tables.length;

  // Process each table to generate its model definition with progress tracking
  for (let i = 0; i < tables.length; i++) {
    const tableName = tables[i];
    if (tableName) {
      // Skip tables that match any of the skip patterns
      if (skipPatterns && shouldSkipTable(tableName, skipPatterns)) {
        if (progressCallback) {
          // Still call the progress callback so the counter advances
          progressCallback(tableName, i, total);
        }
        continue;
      }

      if (progressCallback) {
        progressCallback(tableName, i, total);
      }
      results[tableName] = await inspectTable(pool, tableName, schema);
    }
  }

  return results;
}

/**
 * Inspect all tables in the database in parallel and generate formatted model definitions with progress tracking
 * @param pool Oracle connection pool
 * @param schema Optional schema name
 * @param concurrency Number of parallel operations to run (defaults to 4)
 * @param progressCallback Optional callback function to track progress
 * @param skipPatterns Optional array of wildcard patterns for tables to skip
 * @returns Record of table names to their formatted model definitions
 */
export async function inspectAllWithProgressParallel(
  pool: oracledb.Pool,
  schema?: string,
  concurrency: number = 4,
  progressCallback?: (tableName: string, index: number, total: number) => void,
  skipPatterns?: string[]
): Promise<Record<string, string>> {
  const tables = await getTables(pool, schema);
  const results: Record<string, string> = {};
  const total = tables.length;

  // Track completion for progress reporting
  let completed = 0;

  // Process tables in batches for parallel execution
  for (let i = 0; i < tables.length; i += concurrency) {
    const batch = tables.slice(i, i + concurrency);
    const batchPromises = batch.map(async (tableName, batchIndex) => {
      if (!tableName) return;

      // Skip tables that match any of the skip patterns
      if (skipPatterns && shouldSkipTable(tableName, skipPatterns)) {
        if (progressCallback) {
          // Still call the progress callback so the counter advances
          progressCallback(tableName, i + batchIndex, total);
        }
        return null; // Return null to indicate this was skipped
      }

      const tableResult = await inspectTable(pool, tableName, schema);

      // Update progress after each table is processed
      completed++;
      if (progressCallback) {
        progressCallback(tableName, i + batchIndex, total);
      }

      return { tableName, result: tableResult };
    });

    // Wait for the current batch to complete
    const batchResults = await Promise.all(batchPromises);

    // Add batch results to the final results object
    batchResults.forEach((item) => {
      if (item && item.tableName) {
        results[item.tableName] = item.result;
      }
    });
  }

  return results;
}

/**
 * Add inspection methods to an Oracle client
 * @param client Oracle client instance
 */
export function addInspectMethodsToClient(client: any) {
  const pool = client.getConnectionPool();

  client.inspect = {
    getTables: (schema?: string) => getTables(pool, schema),
    getTableColumns: (tableName: string, schema?: string) =>
      getTableColumns(pool, tableName, schema),
    getAllColumns: (schema?: string) => getAllColumns(pool, schema),
    getTableRelationships: (schema?: string) =>
      getTableRelationships(pool, schema),
    getDatabaseStructure: (schema?: string) =>
      getDatabaseStructure(pool, schema),
    inspectTable: (tableName: string, schema?: string) =>
      inspectTable(pool, tableName, schema),
    inspectAll: (schema?: string) => inspectAll(pool, schema),
    inspectAllWithProgress: (
      schema?: string,
      progressCallback?: (
        tableName: string,
        index: number,
        total: number
      ) => void,
      skipPatterns?: string[]
    ) => inspectAllWithProgress(pool, schema, progressCallback, skipPatterns),
    inspectAllWithProgressParallel: (
      schema?: string,
      concurrency: number = 4,
      progressCallback?: (
        tableName: string,
        index: number,
        total: number
      ) => void,
      skipPatterns?: string[]
    ) =>
      inspectAllWithProgressParallel(
        pool,
        schema,
        concurrency,
        progressCallback,
        skipPatterns
      ),
  };
}

/**
 * Check if a table should be skipped based on wildcard patterns
 * @param tableName Name of the table
 * @param skipPatterns Array of wildcard patterns
 * @returns True if the table matches any of the patterns, false otherwise
 */
function shouldSkipTable(tableName: string, skipPatterns: string[]): boolean {
  return skipPatterns.some((pattern) => {
    const regex = new RegExp(
      "^" +
      pattern
        .replace(/\*/g, ".*")
        .replace(/\?/g, ".") +
      "$"
    );
    return regex.test(tableName);
  });
}
