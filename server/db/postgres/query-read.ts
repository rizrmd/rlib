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
        columns.push(`"${tableName}"."${column}" AS "${tableName}_${column}"`);
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
        if (value === true && modelDef.columns && modelDef.columns[field]) {
          // Basic column selection
          columns.push(`"${tableName}"."${field}" AS "${tableName}_${field}"`);
        } else if (
          value === true &&
          modelDef.relations &&
          modelDef.relations[field]
        ) {
          // It's a relation with "true" value - select all columns
          const relationDef = getRelation(models, modelName, field);
          if (!relationDef) {
            console.warn(
              `[DB Warning] Relation '${String(
                field
              )}' not found in model '${String(
                modelName
              )}'. SQL for this relation will not be generated.`
            );
            return;
          }

          const targetModelName = String(relationDef.to.model);
          const targetModelKey = relationDef.to.model as keyof M;
          const targetModelDef = models[targetModelKey];
          if (!targetModelDef) {
            console.warn(
              `[DB Warning] Target model '${String(
                targetModelName
              )}' for relation '${String(
                field
              )}' not found. SQL for this relation will not be generated.`
            );
            return;
          }

          // Select all columns from the target model
          let relationFields: string[] = [];
          if (targetModelDef.columns) {
            relationFields = Object.keys(targetModelDef.columns);
          }

          if (relationFields.length > 0) {
            // Add join for this relation
            columns.push(`(
              SELECT json_agg(json_build_object(
                ${relationFields
                  .map((rf) => `'${rf}', "${String(targetModelName)}"."${rf}"`)
                  .join(", ")}
              ))
              FROM "${targetModelDef.table}" AS "${String(targetModelName)}"
              WHERE "${String(targetModelName)}"."${
              relationDef.to.column
            }" = "${tableName}"."${relationDef.from}"
            ) AS "${field}"`);
          }
        } else if (typeof value === "object" && value !== null) {
          // It's a relation with object specifying fields
          const relationDef = getRelation(models, modelName, field);
          if (!relationDef) {
            console.warn(
              `[DB Warning] Relation '${String(
                field
              )}' not found in model '${String(
                modelName
              )}'. SQL for this relation will not be generated.`
            );
            return;
          }

          const targetModelName = String(relationDef.to.model);
          const targetModelKey = relationDef.to.model as keyof M;
          const targetModelDef = models[targetModelKey];
          if (!targetModelDef) {
            console.warn(
              `[DB Warning] Target model '${String(
                targetModelName
              )}' for relation '${String(
                field
              )}' not found. SQL for this relation will not be generated.`
            );
            return;
          }

          // Process nested relation selection
          // This object contains fields to select from the relation or nested relations
          const relationSelectObject = value as Record<string, any>;

          // Check if there are nested relations within this relation
          const hasNestedRelations = Object.entries(relationSelectObject).some(
            ([nestedField, nestedValue]) =>
              typeof nestedValue === "object" && nestedValue !== null
          );

          if (hasNestedRelations) {
            // For nested relations, we need to build a more complex subquery
            const nestedModelFields: string[] = []; // Fields directly from the target model
            const nestedRelationFields: Array<{
              field: string;
              subquery: string;
            }> = []; // Nested relation fields

            // Process each field in the relation selection
            Object.entries(relationSelectObject).forEach(
              ([nestedField, nestedValue]) => {
                if (
                  nestedValue === true &&
                  targetModelDef.columns &&
                  targetModelDef.columns[nestedField]
                ) {
                  // Direct field from target model
                  nestedModelFields.push(
                    `'${nestedField}', "${targetModelName}"."${nestedField}"`
                  );
                } else if (
                  typeof nestedValue === "object" ||
                  (nestedValue === true &&
                    targetModelDef.relations &&
                    targetModelDef.relations[nestedField])
                ) {
                  // It's a nested relation
                  const nestedRelationDef = getRelation(
                    models,
                    targetModelKey,
                    nestedField
                  );
                  if (!nestedRelationDef) {
                    console.warn(
                      `[DB Warning] Nested relation '${nestedField}' not found in model '${String(
                        targetModelName
                      )}'. SQL for this relation will not be generated.`
                    );
                    return;
                  }

                  const nestedTargetModelName = String(
                    nestedRelationDef.to.model
                  );
                  const nestedTargetModelKey = nestedRelationDef.to
                    .model as keyof M;
                  const nestedTargetModelDef = models[nestedTargetModelKey];
                  if (!nestedTargetModelDef) {
                    console.warn(
                      `[DB Warning] Target model '${nestedTargetModelName}' for nested relation '${nestedField}' not found. SQL for this relation will not be generated.`
                    );
                    return;
                  }

                  // Determine fields to select from nested relation
                  let nestedRelationSelectFields: string[] = [];

                  if (nestedValue === true) {
                    // Select all columns from nested target model
                    if (nestedTargetModelDef.columns) {
                      nestedRelationSelectFields = Object.keys(
                        nestedTargetModelDef.columns
                      );
                    }
                  } else {
                    // Extract specific fields marked as true
                    nestedRelationSelectFields = Object.entries(
                      nestedValue as Record<string, any>
                    )
                      .filter(([_, v]) => v === true)
                      .map(([f]) => f);
                  }

                  if (nestedRelationSelectFields.length > 0) {
                    // Build subquery for this nested relation
                    const nestedSubquery = `(
                    SELECT json_agg(json_build_object(
                      ${nestedRelationSelectFields
                        .map(
                          (nf) => `'${nf}', "${nestedTargetModelName}"."${nf}"`
                        )
                        .join(", ")}
                    ))
                    FROM "${
                      nestedTargetModelDef.table
                    }" AS "${nestedTargetModelName}"
                    WHERE "${nestedTargetModelName}"."${
                      nestedRelationDef.to.column
                    }" = "${targetModelName}"."${nestedRelationDef.from}"
                  )`;

                    nestedRelationFields.push({
                      field: nestedField,
                      subquery: nestedSubquery,
                    });
                  }
                }
              }
            );

            // Combine direct fields and nested relation fields for the full subquery
            const allFields = [
              ...nestedModelFields,
              ...nestedRelationFields.map(
                (item) => `'${item.field}', ${item.subquery}`
              ),
            ];

            if (allFields.length > 0) {
              columns.push(`(
                SELECT json_agg(json_build_object(
                  ${allFields.join(", ")}
                ))
                FROM "${targetModelDef.table}" AS "${targetModelName}"
                WHERE "${targetModelName}"."${
                relationDef.to.column
              }" = "${tableName}"."${relationDef.from}"
              ) AS "${field}"`);
            }
          } else {
            // Handle regular relation selection (no nested relations)
            // Get fields to select from relation
            let relationFields: string[] = [];

            // Extract fields marked as true
            relationFields = Object.entries(relationSelectObject)
              .filter(([_, v]) => v === true)
              .map(([f]) => f);

            if (relationFields.length > 0) {
              // Add join for this relation using string concatenation
              columns.push(`(
                SELECT json_agg(json_build_object(
                  ${relationFields
                    .map(
                      (rf) => `'${rf}', "${String(targetModelName)}"."${rf}"`
                    )
                    .join(", ")}
                ))
                FROM "${targetModelDef.table}" AS "${String(targetModelName)}"
                WHERE "${String(targetModelName)}"."${
                relationDef.to.column
              }" = "${tableName}"."${relationDef.from}"
              ) AS "${field}"`);
            }
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
export function buildWhereClauseStr<
  M extends Record<string, ModelDefinition<string>>,
  N extends keyof M
>(modelName: N, whereFields: WhereFields<M, N>, models: M): string {
  return processLogicalOperators(modelName, whereFields, models);
}

/**
 * Process the logical operators and build the WHERE clause
 */
function processLogicalOperators<
  M extends Record<string, ModelDefinition<string>>,
  N extends keyof M
>(modelName: N, whereFields: WhereFields<M, N>, models: M): string {
  // Handle logical operators at the top level
  const logicalOperators = ["AND", "OR", "NOT"] as const;
  const conditions: string[] = [];
  const tableName = String(modelName);
  const modelDef = models[modelName];

  if (!modelDef) return "1=1";

  // Process each field or logical operator
  for (const [field, condition] of Object.entries(whereFields)) {
    // Handle logical operators
    if (field === "AND" && Array.isArray(condition)) {
      const andConditions = condition.map((cond) =>
        processLogicalOperators(modelName, cond, models)
      );
      if (andConditions.length > 0) {
        conditions.push(`(${andConditions.join(" AND ")})`);
      }
      continue;
    }

    if (field === "OR" && Array.isArray(condition)) {
      const orConditions = condition.map((cond) =>
        processLogicalOperators(modelName, cond, models)
      );
      if (orConditions.length > 0) {
        conditions.push(`(${orConditions.join(" OR ")})`);
      }
      continue;
    }

    if (field === "NOT" && condition && typeof condition === "object") {
      const notCondition = processLogicalOperators(
        modelName,
        condition as WhereFields<M, N>,
        models
      );
      conditions.push(`NOT (${notCondition})`);
      continue;
    }

    // Check if it's a field or a relation
    if (modelDef.columns && modelDef.columns[field]) {
      // It's a column field

      // Handle direct value assignment as equality condition (id: "ABC" === id: { eq: "ABC" })
      if (
        condition !== null &&
        typeof condition !== "undefined" &&
        (typeof condition !== "object" ||
          condition instanceof Date ||
          Array.isArray(condition))
      ) {
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
      } else if (condition !== null && typeof condition === "object") {
        // Regular object with operators
        for (const [op, value] of Object.entries(condition as any)) {
          // Handle special case for string operators like endsWith, startsWith, etc.
          if (["endsWith", "startsWith", "contains"].includes(op)) {
            let pattern = "";
            switch (op) {
              case "endsWith":
                pattern = `%${String(value).replace(/[%_]/g, "\\$&")}`;
                break;
              case "startsWith":
                pattern = `${String(value).replace(/[%_]/g, "\\$&")}%`;
                break;
              case "contains":
                pattern = `%${String(value).replace(/[%_]/g, "\\$&")}%`;
                break;
            }
            const conditionStr = buildConditionStr(
              tableName,
              field,
              "ilike" as ComparisonOperator,
              pattern
            );
            if (conditionStr) {
              conditions.push(conditionStr);
            }
          } else {
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

      if (
        typeof relationCondition === "object" &&
        Object.keys(relationCondition).length > 0
      ) {
        // Build WHERE conditions for the related model fields
        const relationWhereClauses: string[] = [];

        for (const [relField, relCondition] of Object.entries(
          relationCondition
        )) {
          // Handle direct value assignment for relation fields too
          if (
            relCondition !== null &&
            typeof relCondition !== "undefined" &&
            (typeof relCondition !== "object" ||
              relCondition instanceof Date ||
              Array.isArray(relCondition))
          ) {
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
          } else if (
            relCondition !== null &&
            typeof relCondition === "object"
          ) {
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
        const relationWhereStr =
          relationWhereClauses.length > 0
            ? ` AND ${relationWhereClauses.join(" AND ")}`
            : "";

        conditions.push(`EXISTS (
          SELECT 1 
          FROM "${targetModelDef.table}" AS "${targetModelName}"
          WHERE "${targetModelName}"."${relationDef.to.column}" = "${tableName}"."${relationDef.from}"${relationWhereStr}
        )`);
      } else {
        // Simple existence check if no conditions specified
        conditions.push(`EXISTS (
          SELECT 1 
          FROM "${targetModelDef.table}" AS "${targetModelName}"
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

  // Special handling for NULL values
  if (value === null) {
    switch (operator) {
      case "eq":
        return `${columnRef} IS NULL`;
      case "neq":
        return `${columnRef} IS NOT NULL`;
      default:
        // Other operators don't make sense with NULL
        return `${columnRef} IS NULL`;
    }
  }

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
          const modelDef = models[modelName];

          if (modelDef && modelDef.relations && modelDef.relations[field]) {
            const relationType = modelDef.relations[field].type;

            // Handle relation data based on type
            if (relationType === "has_many") {
              // Ensure has_many relationships return as arrays
              const relationData = row[field];
              if (relationData === null) {
                processedRow[field] = [];
              } else if (Array.isArray(relationData)) {
                processedRow[field] = relationData;
              } else {
                // If it's not already an array, wrap it in an array to ensure consistent return type
                processedRow[field] = [relationData];
              }
            } else {
              // For has_one and belongs_to, keep as is or default to null/empty array
              processedRow[field] = row[field] || null;
            }
          } else {
            // Fallback for unknown relations
            processedRow[field] = row[field] || [];
          }
        }
      });
    }

    return processedRow;
  });
}
