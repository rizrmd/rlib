import type { ModelDefinition } from "../types-gen";
import type {
  ComparisonOperator,
  ModelQueryList,
  OrderByClause,
  SelectFields,
  WhereFields,
} from "../types-lib";

/**
 * Creates a query function that implements the ModelQueryList interface
 * to query a PostgreSQL database based on model definitions
 */
export function createFindMany<
  M extends Record<string, ModelDefinition<string>>,
  N extends keyof M
>(
  modelName: N,
  modelDef: M[N],
  models: M,
  sql: Bun.SQL,
  postProcess?: (res: any) => any
): ModelQueryList<M, N> {
  return async function queryFn<
    S extends SelectFields<M, N> | undefined = undefined,
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
  ) {
    // Extract query options
    const { select, where, orderBy, limit, skip, debug } = options;

    // Build SQL parts
    const tableName = modelDef.table;

    // Build SQL query as a string
    let queryString = `
SELECT ${buildSelectClause(modelName, select, models)}
FROM "${tableName}" AS "${String(modelName)}"`;

    if (where) {
      queryString += ` WHERE ${buildWhereClauseStr(modelName, where, models)}`;
    }

    if (orderBy) {
      queryString += ` ORDER BY ${buildOrderByClauseStr(modelName, orderBy)}`;
    }

    if (limit) {
      queryString += ` LIMIT ${limit}`;
    }

    if (skip) {
      queryString += `
      OFFSET ${skip}`;
    }

    const showDebug = options.debug === true;
    let result;
    let error;

    try {
      // Execute the query using sql.unsafe
      result = await sql.unsafe(queryString);

      // Process results to match selected fields structure
      let final = processResults(result, modelName, select, models);

      if (postProcess) {
        final = postProcess(final);
      }

      // Return different result formats based on debug flag
      if (showDebug) {
        return {
          data: final,
          sql: queryString,
        };
      } else {
        return final;
      }
    } catch (err) {
      error = err;

      // If debug is enabled, return the error and SQL query
      if (showDebug) {
        return {
          data: null,
          sql: queryString,
          error: err instanceof Error ? err.message : String(err),
        };
      }

      // Otherwise rethrow the error
      throw err;
    }
  } as ModelQueryList<M, N>;
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
  sql: Bun.SQL,
  postProcess?: (res: any) => any
) {
  return async function findFirstFn<
    S extends SelectFields<M, N> | undefined = undefined,
    Debug extends boolean = false
  >(
    options: {
      select?: S;
      where?: WhereFields<M, N>;
      orderBy?: OrderByClause<M, N>;
      debug?: Debug;
    } = {}
  ) {
    // Extract query options
    const { select, where, orderBy, debug } = options;

    // Build SQL parts
    const tableName = modelDef.table;

    // Always use LIMIT 1 for findFirst
    const limitClause = 1;

    // Build SQL query as a string
    let queryString = `\
SELECT ${buildSelectClause(modelName, select, models)}
FROM "${tableName}" AS "${String(modelName)}"`;

    if (where) {
      queryString += ` WHERE ${buildWhereClauseStr(modelName, where, models)}`;
    }

    if (orderBy) {
      queryString += ` ORDER BY ${buildOrderByClauseStr(modelName, orderBy)}`;
    }

    queryString += ` LIMIT ${limitClause}`;

    const showDebug = options.debug === true;

    try {
      // Execute the query using sql.unsafe
      const result = await sql.unsafe(queryString);

      // Process results to match selected fields structure
      let final = processResults(result, modelName, select, models);

      if (postProcess) {
        final = postProcess(final);
      }

      // Get the first result or null
      const firstResult = final.length > 0 ? final[0] : null;

      // Return different result formats based on debug flag
      if (showDebug) {
        return {
          data: firstResult,
          sql: queryString,
        };
      } else {
        return firstResult;
      }
    } catch (err) {
      // If debug is enabled, return the error and SQL query
      if (showDebug) {
        return {
          data: null,
          sql: queryString,
          error: err instanceof Error ? err.message : String(err),
        };
      }

      // Otherwise rethrow the error
      throw err;
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
>(
  modelName: N,
  selectFields: SelectFields<M, N> | undefined,
  models: M
): string {
  const tableName = String(modelName);
  const columns: string[] = [];

  // If no fields are selected, default to selecting all columns from the model
  if (!selectFields) {
    const modelDef = models[modelName];
    if (modelDef && modelDef.columns) {
      // Add all columns from the model
      Object.keys(modelDef.columns).forEach((column) => {
        columns.push(`"${tableName}"."${column}" AS ${tableName}_${column}`);
      });
    }

    // If still empty (no columns found), select at least the primary key or '*'
    if (columns.length === 0) {
      return `${tableName}.*`;
    }
  } else {
    // Process the specified select fields
    const modelDef = models[modelName];
    if (modelDef && modelDef.columns) {
      // Process model fields (where value is true)
      Object.entries(selectFields).forEach(([field, value]) => {
        if (value === true && modelDef.columns[field]) {
          // Basic column selection
          columns.push(`"${tableName}"."${field}" AS ${tableName}_${field}`);
        } else if (typeof value === "object" && value !== null) {
          // It's a relation
          const relationDef = getRelation(models, modelName, field);
          if (!relationDef) return;

          const targetModelName = String(relationDef.to.model);
          const targetModelKey = relationDef.to.model as keyof M;
          const targetModelDef = models[targetModelKey];
          if (!targetModelDef) return;

          // Build nested selection for the relation
          const targetSelectFields = value as SelectFields<M, any>;

          // Get fields to select from relation
          const relationFields = Object.entries(targetSelectFields)
            .filter(([_, v]) => v === true)
            .map(([f]) => f);

          if (relationFields.length > 0) {
            // Add join for this relation using string concatenation instead of SQL tagged templates
            columns.push(`(
              SELECT json_agg(json_build_object(
                ${relationFields
                  .map((rf) => `'${rf}', "${String(targetModelName)}"."${rf}"`)
                  .join(", ")}
              ))
              FROM "${targetModelDef.table}" AS ${String(targetModelName)}
              WHERE "${String(targetModelName)}"."${
              relationDef.to.column
            }" = "${tableName}"."${relationDef.from}"
            ) AS ${field}`);
          }
        }
      });
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
>(modelName: N, whereFields: WhereFields<M, N>, models: M): string {
  return buildWhereClauseStr(modelName, whereFields, models);
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
      
      // Handle direct value assignment as equality condition (id: "ABC" === id: { eq: "ABC" })
      if (condition !== null && 
          typeof condition !== 'undefined' && 
          (typeof condition !== 'object' || 
           condition instanceof Date || 
           Array.isArray(condition))) {
        // Direct value assignment - treat as equality
        const conditionStr = buildConditionStr(
          tableName,
          field,
          "eq" as ComparisonOperator,
          condition
        );
        if (conditionStr) {
          conditions.push(conditionStr);
        }
      } else if (condition !== null && typeof condition === 'object') {
        // Regular object with operators
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
      }
    } else {
      // It's a relation - handle with subquery
      const relationDef = getRelation(models, modelName, field);
      if (!relationDef) continue;

      const targetModelName = String(relationDef.to.model);
      const targetModelKey = relationDef.to.model as keyof M;
      const targetModelDef = models[targetModelKey];
      if (!targetModelDef) continue;

      // Check if the relation has conditions specified
      const relationCondition = condition as Record<string, any>;
      
      if (typeof relationCondition === 'object' && Object.keys(relationCondition).length > 0) {
        // Build WHERE conditions for the related model fields
        const relationWhereClauses: string[] = [];
        
        for (const [relField, relCondition] of Object.entries(relationCondition)) {
          // Handle direct value assignment for relation fields too
          if (relCondition !== null && 
              typeof relCondition !== 'undefined' && 
              (typeof relCondition !== 'object' || 
               relCondition instanceof Date || 
               Array.isArray(relCondition))) {
            // Direct value assignment - treat as equality
            const relationCondStr = buildConditionStr(
              targetModelName,
              relField,
              "eq" as ComparisonOperator,
              relCondition
            );
            if (relationCondStr) {
              relationWhereClauses.push(relationCondStr);
            }
          } else if (relCondition !== null && typeof relCondition === 'object') {
            // Regular object with operators
            for (const [op, value] of Object.entries(relCondition as any)) {
              const relationCondStr = buildConditionStr(
                targetModelName,
                relField,
                op as ComparisonOperator,
                value
              );
              if (relationCondStr) {
                relationWhereClauses.push(relationCondStr);
              }
            }
          }
        }

        // Build EXISTS subquery with the relation conditions
        const relationWhereStr = relationWhereClauses.length > 0 
          ? ` AND ${relationWhereClauses.join(" AND ")}` 
          : "";
          
        conditions.push(`EXISTS (
          SELECT 1 
          FROM "${targetModelDef.table}" AS ${targetModelName}
          WHERE "${targetModelName}"."${relationDef.to.column}" = "${tableName}"."${relationDef.from}"${relationWhereStr}
        )`);
      } else {
        // Simple existence check if no conditions specified
        conditions.push(`EXISTS (
          SELECT 1 
          FROM "${targetModelDef.table}" AS ${targetModelName}
          WHERE "${targetModelName}"."${relationDef.to.column}" = "${tableName}"."${relationDef.from}"
        )`);
      }
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
  // Create properly quoted column reference
  const columnRef = `"${tableName}"."${field}"`;

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
  if (Array.isArray(value))
    return `ARRAY[${value.map(formatValue).join(", ")}]`;
  if (typeof value === "object")
    return `'${JSON.stringify(value).replace(/'/g, "''")}'`;
  return `'${String(value).replace(/'/g, "''")}'`;
}

/**
 * Builds ORDER BY clause from orderBy options - replaced with string-based version
 */
function buildOrderByClause<
  M extends Record<string, ModelDefinition<string>>,
  N extends keyof M
>(sql: Bun.SQL, modelName: N, orderBy: OrderByClause<M, N>): string {
  return buildOrderByClauseStr(modelName, orderBy);
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
      orderClauses.push(`"${tableName}"."${field}" ${direction.toUpperCase()}`);
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
  selectFields: SelectFields<M, N> | undefined,
  models: M
): any[] {
  // Process each row
  return results.map((row) => {
    const processedRow: any = {};
    const tableName = String(modelName);

    // If no fields were explicitly selected, include all returned columns
    if (!selectFields) {
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
      // Process specifically selected fields from the object format
      Object.entries(selectFields).forEach(([field, value]) => {
        if (value === true) {
          // It's a basic column
          const columnKey = `${tableName}_${field}`;
          processedRow[field] = row[columnKey];
        } else if (typeof value === "object" && value !== null) {
          // It's a relation
          processedRow[field] = row[field] || [];
        }
      });
    }

    return processedRow;
  });
}
