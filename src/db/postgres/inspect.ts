/**
 * PostgreSQL database structure inspection utilities
 * Provides functions to query table structure, columns, and relationships
 */

import { sql } from "bun";

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
}

export interface ModelRelations {
  [relationName: string]: {
    references: string;
    column: string;
  };
}

export interface ModelDefinition {
  table: string;
  columns: Record<string, ColumnDefinition>;
  relations: ModelRelations;
}

/**
 * Get all tables in a PostgreSQL database
 */
export async function getTables(): Promise<string[]> {
  const result = await sql`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public'
    ORDER BY table_name
  `;

  return result.map((row: any) => row.table_name);
}

/**
 * Get all columns for a specific table in a PostgreSQL database
 */
export async function getTableColumns(
  tableName: string
): Promise<TableColumn[]> {
  const result = await sql`
    SELECT 
      c.table_schema,
      c.table_name,
      c.column_name,
      c.data_type,
      c.column_default,
      c.is_nullable,
      CASE WHEN pk.constraint_name IS NOT NULL THEN true ELSE false END as is_primary_key
    FROM 
      information_schema.columns c
    LEFT JOIN (
      SELECT 
        tc.constraint_name, tc.table_schema, tc.table_name, kcu.column_name
      FROM 
        information_schema.table_constraints tc
      JOIN 
        information_schema.key_column_usage kcu 
        ON kcu.constraint_name = tc.constraint_name
      WHERE 
        tc.constraint_type = 'PRIMARY KEY'
    ) pk 
      ON c.table_schema = pk.table_schema 
      AND c.table_name = pk.table_name 
      AND c.column_name = pk.column_name
    WHERE 
      c.table_schema = 'public'
      AND c.table_name = ${tableName}
    ORDER BY 
      c.ordinal_position
  `;

  return result as TableColumn[];
}

/**
 * Get all columns for all tables in a PostgreSQL database
 */
export async function getAllColumns(): Promise<Record<string, TableColumn[]>> {
  const result = await sql`
    SELECT 
      c.table_schema,
      c.table_name,
      c.column_name,
      c.data_type,
      c.column_default,
      c.is_nullable,
      CASE WHEN pk.constraint_name IS NOT NULL THEN true ELSE false END as is_primary_key
    FROM 
      information_schema.columns c
    LEFT JOIN (
      SELECT 
        tc.constraint_name, tc.table_schema, tc.table_name, kcu.column_name
      FROM 
        information_schema.table_constraints tc
      JOIN 
        information_schema.key_column_usage kcu 
        ON kcu.constraint_name = tc.constraint_name
      WHERE 
        tc.constraint_type = 'PRIMARY KEY'
    ) pk 
      ON c.table_schema = pk.table_schema 
      AND c.table_name = pk.table_name 
      AND c.column_name = pk.column_name
    WHERE 
      c.table_schema = 'public'
    ORDER BY 
      c.table_name, c.ordinal_position
  `;

  // Use reduce to build the object in a TypeScript-friendly way
  const columnsByTable = (result as TableColumn[]).reduce<
    Record<string, TableColumn[]>
  >((acc, col) => {
    const tableName = col.table_name;
    if (!acc[tableName]) {
      acc[tableName] = [];
    }
    acc[tableName].push(col);
    return acc;
  }, {});

  return columnsByTable;
}

/**
 * Get all relationships between tables in a PostgreSQL database
 */
export async function getTableRelationships(): Promise<TableRelationship[]> {
  const result = await sql`
    SELECT
      con.conname AS constraint_name,
      source_schema.nspname AS source_schema,
      source_table.relname AS source_table,
      source_attr.attname AS source_column,
      target_schema.nspname AS target_schema,
      target_table.relname AS target_table,
      target_attr.attname AS target_column
    FROM
      pg_constraint con
      JOIN pg_class source_table ON source_table.oid = con.conrelid
      JOIN pg_namespace source_schema ON source_schema.oid = source_table.relnamespace
      JOIN pg_class target_table ON target_table.oid = con.confrelid
      JOIN pg_namespace target_schema ON target_schema.oid = target_table.relnamespace
      JOIN pg_attribute source_attr ON 
        source_attr.attrelid = con.conrelid AND
        source_attr.attnum = ANY(con.conkey)
      JOIN pg_attribute target_attr ON 
        target_attr.attrelid = con.confrelid AND
        target_attr.attnum = ANY(con.confkey)
    WHERE
      con.contype = 'f'
      AND array_position(con.conkey, source_attr.attnum) = array_position(con.confkey, target_attr.attnum)
      AND source_schema.nspname = 'public'
    ORDER BY
      source_table.relname, source_attr.attname
  `;

  return result as TableRelationship[];
}

/**
 * Get the full database structure including tables, columns and relationships
 */
export async function getDatabaseStructure(): Promise<DatabaseStructure> {
  const tables = await getTables();
  const columns = await getAllColumns();
  const relationships = await getTableRelationships();

  return {
    tables,
    columns,
    relationships,
  };
}

/**
 * Maps PostgreSQL data types to simplified types for model definitions
 * @param pgType PostgreSQL data type
 * @returns Simplified type (text, number, boolean, datetime, etc.)
 */
function mapDataType(pgType: string): string {
  // Convert PostgreSQL types to simplified types
  const typeMap: Record<string, string> = {
    "character varying": "text",
    varchar: "text",
    text: "text",
    char: "text",
    integer: "number",
    int: "number",
    smallint: "number",
    bigint: "number",
    decimal: "number",
    numeric: "number",
    real: "number",
    "double precision": "number",
    float: "number",
    boolean: "boolean",
    date: "date",
    timestamp: "datetime",
    "timestamp with time zone": "datetime",
    "timestamp without time zone": "datetime",
    time: "time",
    json: "json",
    jsonb: "json",
  };

  return typeMap[pgType] || "text"; // Default to text for unknown types
}

/**
 * Generate model definition for a specific table
 * @param tableName Name of the table
 * @param columns Columns of the table
 * @param relationships Relationships for the table
 * @returns Model definition object
 */
export async function generateModelDefinition(
  tableName: string
): Promise<ModelDefinition> {
  // Get columns and relationships for the table
  const columns = await getTableColumns(tableName);
  const allRelationships = await getTableRelationships();

  // Filter relationships that are relevant to this table (as source)
  const tableRelationships = allRelationships.filter(
    (rel) => rel.source_table.toLowerCase() === tableName.toLowerCase()
  );

  // Build columns object
  const columnsDef: Record<string, ColumnDefinition> = {};
  columns.forEach((col) => {
    columnsDef[col.column_name] = {
      type: mapDataType(col.data_type),
    };
  });

  // Build relations object
  const relationsDef: ModelRelations = {};
  tableRelationships.forEach((rel) => {
    const relationName = `${rel.target_table}_${rel.target_column}`;
    relationsDef[relationName] = {
      references: rel.target_table,
      column: rel.source_column,
    };
  });

  return {
    table: tableName,
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
    }`
  )
  .join(",\n")}
  },
  relations: {${
    Object.keys(modelDef.relations).length > 0
      ? "\n" +
        Object.entries(modelDef.relations)
          .map(
            ([relName, relDef]) => `    ${relName}: {
      references: "${relDef.references}",
      column: "${relDef.column}",
    }`
          )
          .join(",\n") +
        "\n  "
      : ""
  }},
} as const satisfies ModelDefinition;`;
}

/**
 * Inspect a table and generate a formatted model definition
 * @param tableName Name of the table to inspect
 * @returns Formatted model definition as a string
 */
export async function inspectTable(tableName: string): Promise<string> {
  const modelDef = await generateModelDefinition(tableName);
  return formatModelDefinition(modelDef);
}

/**
 * Inspect all tables in the database and generate formatted model definitions
 * @returns Record of table names to their formatted model definitions
 */
export async function inspectAll(): Promise<Record<string, string>> {
  const tables = await getTables();
  const results: Record<string, string> = {};

  // Process each table to generate its model definition
  for (const tableName of tables) {
    results[tableName] = await inspectTable(tableName);
  }

  return results;
}

/**
 * Inspect all tables in the database and generate formatted model definitions with progress tracking
 * @param progressCallback Optional callback function to track progress
 * @returns Record of table names to their formatted model definitions
 */
export async function inspectAllWithProgress(
  progressCallback?: (tableName: string, index: number, total: number) => void
): Promise<Record<string, string>> {
  const tables = await getTables();
  const results: Record<string, string> = {};
  const total = tables.length;

  // Process each table to generate its model definition with progress tracking
  for (let i = 0; i < tables.length; i++) {
    const tableName = tables[i];
    if (tableName) {
      if (progressCallback) {
        progressCallback(tableName, i, total);
      }
      results[tableName] = await inspectTable(tableName);
    }
  }

  return results;
}
