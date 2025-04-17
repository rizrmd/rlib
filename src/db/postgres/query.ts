import { sql } from "bun";
import type { ModelDefinition } from "../types-gen";
import type {
    ComparisonOperator,
    ModelQueryList,
    OrderByClause,
    SelectFields,
    WhereFields
} from "../types-lib";

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
  models: M
): ModelQueryList<M, N> {
  return async (options) => {
    // Extract query options
    const { select, where, orderBy, limit, skip } = options;
    
    // Build SQL parts
    const tableName = modelDef.table;
    const selectClause = buildSelectClause(modelName, select, models);
    const whereClause = where ? buildWhereClause(modelName, where, models) : null;
    const orderByClause = orderBy ? buildOrderByClause(modelName, orderBy) : null;
    const limitClause = typeof limit === 'number' ? `LIMIT ${limit}` : '';
    const offsetClause = typeof skip === 'number' ? `OFFSET ${skip}` : '';
    
    // Build full SQL query
    const query = `
      SELECT ${selectClause}
      FROM "${tableName}" AS "${String(modelName)}"
      ${whereClause ? `WHERE ${whereClause}` : ''}
      ${orderByClause ? `ORDER BY ${orderByClause}` : ''}
      ${limitClause}
      ${offsetClause}
    `;
    
    // Execute query
    const result = await sql.unsafe(query);
    
    // Process results to match selected fields structure
    return processResults(result, modelName, select, models);
  };
}

/**
 * Safely access relations from a model definition
 */
function getRelation<
  M extends Record<string, ModelDefinition<string>>,
  N extends keyof M
>(
  models: M, 
  modelName: N, 
  relationName: string
) {
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
  selectFields: SelectFields<M, N>[],
  models: M
): string {
  const tableName = String(modelName);
  const columns: string[] = [];
  
  for (const field of selectFields) {
    if (typeof field === 'string') {
      // Basic column selection
      columns.push(`"${tableName}"."${field}" AS "${tableName}_${field}"`);
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
        
        // Add join for this relation
        columns.push(`(
          SELECT json_agg(json_build_object(
            ${relationFields.map((rf: any) => {
              if (typeof rf === 'string') {
                return `'${rf}', "${String(targetModelName)}"."${rf}"`;
              }
              // Handle nested relations if needed
              return '';
            }).filter(Boolean).join(', ')}
          ))
          FROM "${targetModelDef.table}" AS "${String(targetModelName)}"
          WHERE "${String(targetModelName)}"."${relationDef.to.column}" = "${tableName}"."${relationDef.from}"
        ) AS "${relationName}"`);
      }
    }
  }
  
  return columns.join(', ');
}

/**
 * Builds WHERE clause from conditions
 */
function buildWhereClause<
  M extends Record<string, ModelDefinition<string>>,
  N extends keyof M
>(
  modelName: N,
  whereFields: WhereFields<M, N>,
  models: M
): string {
  const conditions: string[] = [];
  const tableName = String(modelName);
  const modelDef = models[modelName];
  
  if (!modelDef) return '1=1';
  
  for (const [field, condition] of Object.entries(whereFields)) {
    // Check if it's a field or a relation
    if (modelDef.columns && modelDef.columns[field]) {
      // It's a column field
      for (const [op, value] of Object.entries(condition as any)) {
        const conditionStr = buildCondition(tableName, field, op as ComparisonOperator, value);
        if (conditionStr) {
          conditions.push(conditionStr);
        }
      }
    } else {
      // It's a relation - we would need to add a subquery or join
      const relationDef = getRelation(models, modelName, field);
      if (!relationDef) continue;
      
      const targetModelName = String(relationDef.to.model);
      const targetModelKey = relationDef.to.model as keyof M;
      const targetModelDef = models[targetModelKey];
      if (!targetModelDef) continue;
      
      // Add placeholder for relation condition
      conditions.push(`EXISTS (
        SELECT 1 FROM "${targetModelDef.table}" AS "${targetModelName}"
        WHERE "${targetModelName}"."${relationDef.to.column}" = "${tableName}"."${relationDef.from}"
        AND 1=1 /* Relation conditions would go here */
      )`);
    }
  }
  
  return conditions.length ? conditions.join(' AND ') : '1=1';
}

/**
 * Builds condition for a specific field and operator
 */
function buildCondition(
  tableName: string,
  field: string,
  operator: ComparisonOperator,
  value: any
): string {
  const columnRef = `"${tableName}"."${field}"`;
  
  switch (operator) {
    case 'eq':
      return `${columnRef} = ${formatValue(value)}`;
    case 'neq':
      return `${columnRef} != ${formatValue(value)}`;
    case 'gt':
      return `${columnRef} > ${formatValue(value)}`;
    case 'gte':
      return `${columnRef} >= ${formatValue(value)}`;
    case 'lt':
      return `${columnRef} < ${formatValue(value)}`;
    case 'lte':
      return `${columnRef} <= ${formatValue(value)}`;
    case 'like':
      return `${columnRef} LIKE ${formatValue(value)}`;
    case 'ilike':
      return `${columnRef} ILIKE ${formatValue(value)}`;
    case 'in':
      if (Array.isArray(value) && value.length > 0) {
        const formattedValues = value.map(v => formatValue(v)).join(', ');
        return `${columnRef} IN (${formattedValues})`;
      }
      return `1=0`; // Empty IN clause is always false
    case 'nin':
      if (Array.isArray(value) && value.length > 0) {
        const formattedValues = value.map(v => formatValue(v)).join(', ');
        return `${columnRef} NOT IN (${formattedValues})`;
      }
      return `1=1`; // Empty NOT IN clause is always true
    default:
      return '';
  }
}

/**
 * Format a value for SQL insertion with proper escaping
 */
function formatValue(value: any): string {
  if (value === null) return 'NULL';
  if (typeof value === 'string') return `'${value.replace(/'/g, "''")}'`; // Basic SQL escaping
  if (typeof value === 'number') return value.toString();
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (value instanceof Date) return `'${value.toISOString()}'`;
  return `'${String(value).replace(/'/g, "''")}'`;
}

/**
 * Builds ORDER BY clause from orderBy options
 */
function buildOrderByClause<
  M extends Record<string, ModelDefinition<string>>,
  N extends keyof M
>(
  modelName: N,
  orderBy: OrderByClause<M, N>
): string {
  const tableName = String(modelName);
  const orderClauses: string[] = [];
  
  for (const [field, direction] of Object.entries(orderBy)) {
    if (direction === 'asc' || direction === 'desc') {
      orderClauses.push(`"${tableName}"."${field}" ${direction.toUpperCase()}`);
    }
  }
  
  return orderClauses.join(', ');
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
  return results.map(row => {
    const processedRow: any = {};
    const tableName = String(modelName);
    
    // Process columns
    for (const field of selectFields) {
      if (typeof field === 'string') {
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
    
    return processedRow;
  });
}