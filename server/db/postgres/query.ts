import type { ModelDefinition } from "../types-gen";
import type {
  ComparisonOperator,
  ModelQueryList,
  ModelResultType,
  OrderByClause,
  SelectFields,
  WhereFields,
} from "../types-lib";
import { sql } from "bun";

/**
 * Creates a query function that implements the ModelQueryList interface
 * to query a PostgreSQL database based on model definitions
 */
export function createQuery<
  M extends Record<string, ModelDefinition<string>>,
  N extends keyof M
>(
  modelName: N,
  modelDef: M[N],
  models: M,
  sqlClient: any,
  postProcess?: (res: any) => any
): ModelQueryList<M, N> {
  return async <
    S extends SelectFields<M, N>[] | undefined = undefined,
    Debug extends boolean = false
  >(
    options: {
      select?: S;
      where?: WhereFields<M, N>;
      orderBy?: OrderByClause<M, N>;
      limit?: number;
      skip?: number;
      debug?: Debug;
    } = {}
  ): Promise<
    Debug extends true
      ? { data: ModelResultType<M, N, S>; sql: string }
      : ModelResultType<M, N, S>
  > => {
    // Extract query options
    const { select, where, orderBy, limit, skip, debug } = options;

    // Build SQL parts
    const tableName = modelDef.table;
    const selectClauseStr = buildSelectClause(modelName, select || [], models);
    
    // For WHERE and ORDER BY, we'll use a different approach
    // Both will be constructed as raw SQL strings instead of SQL template fragments
    const whereClauseStr = where
      ? buildWhereClauseStr(modelName, where, models)
      : null;
    const orderByClauseStr = orderBy
      ? buildOrderByClauseStr(modelName, orderBy)
      : null;

    // Construct the complete SQL query as a single raw string
    let query = `
      SELECT ${selectClauseStr}
      FROM ${tableName} AS ${String(modelName)}
      ${whereClauseStr ? `WHERE ${whereClauseStr}` : ''}
      ${orderByClauseStr ? `ORDER BY ${orderByClauseStr}` : ''}
      ${limit ? `LIMIT ${limit}` : ''}
      ${skip ? `OFFSET ${skip}` : ''}
    `;

    // Use sql.unsafe to execute the raw SQL query
    const result = await sqlClient.unsafe(query);

    const queryText = query;

    // Process results to match selected fields structure
    let final = processResults(result, modelName, select || [], models);

    if (postProcess) {
      final = postProcess(final);
    }

    // Make sure we have a boolean value for debug
    const showDebug = options.debug === true;
    
    // Return different result formats based on debug flag
    if (showDebug) {
      return {
        data: final,
        sql: queryText
      } as any;
    } else {
      return final as any;
    }
  };
}

/**
 * Creates a query function that returns only the first result matching the query criteria
 * or null if no results are found
 */
export function createFindFirst<
  M extends Record<string, ModelDefinition<string>>,
  N extends keyof M
>(
  modelName: N,
  modelDef: M[N],
  models: M,
  sqlClient: any,
  postProcess?: (res: any) => any
): <
  S extends SelectFields<M, N>[] | undefined = undefined,
  Debug extends boolean = false
>(
  options?: {
    select?: S;
    where?: WhereFields<M, N>;
    orderBy?: OrderByClause<M, N>;
    debug?: Debug;
  }
) => Promise<
  Debug extends true
    ? { data: ModelResultType<M, N, S>[0] | null; sql: string }
    : ModelResultType<M, N, S>[0] | null
> {
  return async <
    S extends SelectFields<M, N>[] | undefined = undefined,
    Debug extends boolean = false
  >(
    options: {
      select?: S;
      where?: WhereFields<M, N>;
      orderBy?: OrderByClause<M, N>;
      debug?: Debug;
    } = {}
  ) => {
    // Extract query options
    const { select, where, orderBy, debug } = options;

    // Build SQL parts
    const tableName = modelDef.table;
    const selectClauseStr = buildSelectClause(modelName, select || [], models);

    const whereClause = where
      ? buildWhereClause(modelName, where, models)
      : null;
    const orderByClause = orderBy
      ? buildOrderByClause(modelName, orderBy)
      : null;

    // Always use LIMIT 1 for findFirst
    const limitClause = 1;

    // Execute query using SQL template literals - passing selectClause as a raw string
    // This avoids the "improper qualified name" error
    const result = await sqlClient`
      SELECT ${selectClauseStr}
      FROM ${tableName} AS ${String(modelName)}
      ${whereClause ? sql`WHERE ${whereClause}` : sql``}
      ${orderByClause ? sql`ORDER BY ${orderByClause}` : sql``}
      LIMIT ${limitClause}
    `;

    const queryText = String(result.query || '');

    // Process results to match selected fields structure
    let final = processResults(result, modelName, select || [], models);

    if (postProcess) {
      final = postProcess(final);
    }

    // Get the first result or null
    const firstResult = final.length > 0 ? final[0] : null;

    // Make sure we have a boolean value for debug
    const showDebug = options.debug === true;
    
    // Return different result formats based on debug flag
    if (showDebug) {
      return {
        data: firstResult,
        sql: queryText
      } as any;
    } else {
      return firstResult as any;
    }
  };
}

/**
 * Safely access relations from a model definition
 */
function getRelation<
  M extends Record<string, ModelDefinition<string>>,
  N extends keyof M
>(models: M, modelName: N, relationName: string) {
  const modelDef = models[modelName];
  if (!modelDef || !modelDef.relations) return undefined;

  // Type-safe way to access relations
  return modelDef.relations[relationName as keyof typeof modelDef.relations];
}

/**
 * Builds SELECT clause from selection fields
 */
function buildSelectClause<
  M extends Record<string, ModelDefinition<string>>,
  N extends keyof M
>(modelName: N, selectFields: SelectFields<M, N>[], models: M): string {
  const tableName = String(modelName);
  const columns: string[] = [];

  // If no fields are selected, default to selecting all columns from the model
  if (selectFields.length === 0) {
    const modelDef = models[modelName];
    if (modelDef && modelDef.columns) {
      // Add all columns from the model
      Object.keys(modelDef.columns).forEach((column) => {
        // Format column references for proper handling with SQL tagged templates
        // Using unquoted column identifiers: table.column AS alias
        columns.push(`${tableName}.${column} AS ${tableName}_${column}`);
      });
    }

    // If still empty (no columns found), select at least the primary key or '*'
    if (columns.length === 0) {
      return `${tableName}.*`;
    }
  } else {
    // Process the specified select fields
    for (const field of selectFields) {
      if (typeof field === "string") {
        // Basic column selection - unquoted identifiers for SQL tagged templates
        columns.push(`${tableName}.${field} AS ${tableName}_${field}`);
      } else {
        // Relation selection
        for (const [relationName, relationFields] of Object.entries(field)) {
          // Skip if relation fields are not defined
          if (!relationFields || !relationFields.length) continue;

          // Get relation definition in a type-safe way
          const relationDef = getRelation(models, modelName, relationName);
          if (!relationDef) continue;

          const targetModelName = String(relationDef.to.model);
          const targetModelKey = relationDef.to.model as keyof M;
          const targetModelDef = models[targetModelKey];
          if (!targetModelDef) continue;

          // Add join for this relation - don't use double quotes for SQL tagged templates
          columns.push(`(
            SELECT json_agg(json_build_object(
              ${relationFields
                .map((rf: any) => {
                  if (typeof rf === "string") {
                    return `'${rf}', ${String(targetModelName)}.${rf}`;
                  }
                  // Handle nested relations if needed
                  return "";
                })
                .filter(Boolean)
                .join(", ")}
            ))
            FROM ${targetModelDef.table} AS ${String(targetModelName)}
            WHERE ${String(targetModelName)}.${relationDef.to.column} = ${tableName}.${relationDef.from}
          ) AS ${relationName}`);
        }
      }
    }
  }

  return columns.length > 0 ? columns.join(", ") : `${tableName}.*`;
}

/**
 * Builds WHERE clause from conditions
 */
function buildWhereClause<
  M extends Record<string, ModelDefinition<string>>,
  N extends keyof M
>(modelName: N, whereFields: WhereFields<M, N>, models: M): any {
  const conditions = [];
  const tableName = String(modelName);
  const modelDef = models[modelName];

  if (!modelDef) return sql`1=1`;

  for (const [field, condition] of Object.entries(whereFields)) {
    // Check if it's a field or a relation
    if (modelDef.columns && modelDef.columns[field]) {
      // It's a column field
      for (const [op, value] of Object.entries(condition as any)) {
        const conditionSql = buildConditionStr(
          tableName,
          field,
          op as ComparisonOperator,
          value
        );
        if (conditionSql) {
          conditions.push(conditionSql);
        }
      }
    } else {
      // It's a relation - handle with subquery
      const relationDef = getRelation(models, modelName, field);
      if (!relationDef) continue;

      const targetModelName = String(relationDef.to.model);
      const targetModelKey = relationDef.to.model as keyof M;
      const targetModelDef = models[targetModelKey];
      if (!targetModelDef) continue;

      // Add exists subquery for relation using sql tagged templates
      conditions.push(sql`EXISTS (
        SELECT 1 
        FROM ${sql(targetModelDef.table)} AS ${sql(targetModelName)}
        WHERE ${sql(`${targetModelName}.${relationDef.to.column}`)} = ${sql(`${tableName}.${relationDef.from}`)}
      )`);
    }
  }

  // Combine all conditions with AND
  if (conditions.length === 0) {
    return sql`1=1`;
  }
  
  // Join conditions with AND
  let result = conditions[0];
  for (let i = 1; i < conditions.length; i++) {
    result = sql`${result} AND ${conditions[i]}`;
  }
  
  return result;
}

/**
 * Builds WHERE clause as a raw SQL string
 */
function buildWhereClauseStr<
  M extends Record<string, ModelDefinition<string>>,
  N extends keyof M
>(modelName: N, whereFields: WhereFields<M, N>, models: M): string {
  const conditions: string[] = [];
  const tableName = String(modelName);
  const modelDef = models[modelName];

  if (!modelDef) return "1=1";

  for (const [field, condition] of Object.entries(whereFields)) {
    // Check if it's a field or a relation
    if (modelDef.columns && modelDef.columns[field]) {
      // It's a column field
      for (const [op, value] of Object.entries(condition as any)) {
        const conditionStr = buildConditionStr(
          tableName,
          field,
          op as ComparisonOperator,
          value
        );
        if (conditionStr) {
          conditions.push(conditionStr);
        }
      }
    } else {
      // It's a relation - handle with subquery
      const relationDef = getRelation(models, modelName, field);
      if (!relationDef) continue;

      const targetModelName = String(relationDef.to.model);
      const targetModelKey = relationDef.to.model as keyof M;
      const targetModelDef = models[targetModelKey];
      if (!targetModelDef) continue;

      // Add exists subquery for relation
      conditions.push(`EXISTS (
        SELECT 1 
        FROM ${targetModelDef.table} AS ${targetModelName}
        WHERE ${targetModelName}.${relationDef.to.column} = ${tableName}.${relationDef.from}
      )`);
    }
  }

  // Combine all conditions with AND
  if (conditions.length === 0) {
    return "1=1";
  }
  
  return conditions.join(" AND ");
}

/**
 * Builds condition for a specific field and operator as a raw SQL string
 */
function buildConditionStr(
  tableName: string,
  field: string,
  operator: ComparisonOperator,
  value: any
): string {
  // Create column reference
  const columnRef = `${tableName}.${field}`;

  switch (operator) {
    case "eq":
      return `${columnRef} = ${formatValue(value)}`;
    case "neq":
      return `${columnRef} != ${formatValue(value)}`;
    case "gt":
      return `${columnRef} > ${formatValue(value)}`;
    case "gte":
      return `${columnRef} >= ${formatValue(value)}`;
    case "lt":
      return `${columnRef} < ${formatValue(value)}`;
    case "lte":
      return `${columnRef} <= ${formatValue(value)}`;
    case "like":
      return `${columnRef} LIKE ${formatValue(value)}`;
    case "ilike":
      return `${columnRef} ILIKE ${formatValue(value)}`;
    case "in":
      if (Array.isArray(value) && value.length > 0) {
        return `${columnRef} IN (${value.map(formatValue).join(", ")})`;
      }
      return "1=0"; // Empty IN clause is always false
    case "nin":
      if (Array.isArray(value) && value.length > 0) {
        return `${columnRef} NOT IN (${value.map(formatValue).join(", ")})`;
      }
      return "1=1"; // Empty NOT IN clause is always true
    default:
      return "1=1";
  }
}

/**
 * Format a value for SQL insertion with proper escaping
 */
function formatValue(value: any): string {
  if (value === null) return "NULL";
  if (typeof value === "string") return `'${value.replace(/'/g, "''")}'`; // Basic SQL escaping
  if (typeof value === "number") return value.toString();
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (value instanceof Date) return `'${value.toISOString()}'`;
  return `'${String(value).replace(/'/g, "''")}'`;
}

/**
 * Builds ORDER BY clause from orderBy options
 */
function buildOrderByClause<
  M extends Record<string, ModelDefinition<string>>,
  N extends keyof M
>(modelName: N, orderBy: OrderByClause<M, N>): any {
  const tableName = String(modelName);
  const orderClauses = [];

  for (const [field, direction] of Object.entries(orderBy)) {
    if (direction === "asc" || direction === "desc") {
      orderClauses.push(sql`${sql(`${tableName}.${field}`)} ${sql(direction.toUpperCase())}`);
    }
  }

  if (orderClauses.length === 0) {
    return null;
  }
  
  // Join order clauses with commas
  let result = orderClauses[0];
  for (let i = 1; i < orderClauses.length; i++) {
    result = sql`${result}, ${orderClauses[i]}`;
  }
  
  return result;
}

/**
 * Builds ORDER BY clause as a raw SQL string
 */
function buildOrderByClauseStr<
  M extends Record<string, ModelDefinition<string>>,
  N extends keyof M
>(modelName: N, orderBy: OrderByClause<M, N>): string {
  const tableName = String(modelName);
  const orderClauses: string[] = [];

  for (const [field, direction] of Object.entries(orderBy)) {
    if (direction === "asc" || direction === "desc") {
      orderClauses.push(`${tableName}.${field} ${direction.toUpperCase()}`);
    }
  }

  if (orderClauses.length === 0) {
    return "";
  }
  
  return orderClauses.join(", ");
}

/**
 * Process raw SQL results to match the selected fields structure
 */
function processResults<
  M extends Record<string, ModelDefinition<string>>,
  N extends keyof M
>(
  results: any[],
  modelName: N,
  selectFields: SelectFields<M, N>[],
  models: M
): any[] {
  // Process each row
  return results.map((row) => {
    const processedRow: any = {};
    const tableName = String(modelName);

    // If no fields were explicitly selected, include all returned columns
    if (selectFields.length === 0) {
      // Get all columns from the row that belong to this table
      const prefix = `${tableName}_`;
      for (const key of Object.keys(row)) {
        if (key.startsWith(prefix)) {
          const fieldName = key.substring(prefix.length);
          processedRow[fieldName] = row[key];
        } else if (!key.includes("_")) {
          // Handle direct column access (when using tableName.*)
          processedRow[key] = row[key];
        }
      }
    } else {
      // Process specifically selected columns
      for (const field of selectFields) {
        if (typeof field === "string") {
          // Basic column
          const columnKey = `${tableName}_${field}`;
          processedRow[field] = row[columnKey];
        } else {
          // Relations
          for (const relationName of Object.keys(field)) {
            processedRow[relationName] = row[relationName] || [];
          }
        }
      }
    }

    return processedRow;
  });
}
