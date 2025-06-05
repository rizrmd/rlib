// filepath: /Users/riz/Developer/rlib/server/db/oracle/query-write.ts
import oracledb from "oracledb";
import type { ModelDefinition } from "../types-gen";
import type {
  ModelCreate,
  ModelUpdate,
  ModelCreateOptions,
  ModelUpdateOptions,
  WhereFields,
} from "../types-lib";
import { formatValue, formatIdentifier } from "./query-util";
import { buildWhereClauseStr } from "./query-read";

/**
 * Get primary key columns from a model definition
 */
function getPrimaryKeyColumns(modelDef: ModelDefinition<string>): string[] {
  return Object.entries(modelDef.columns)
    .filter(([_, colDef]) => colDef.is_primary_key)
    .map(([colName]) => colName);
}

/**
 * Creates a function to handle creation of new records in Oracle
 */
export function createCreate<
  M extends Record<string, ModelDefinition<string>>,
  N extends keyof M
>(
  modelName: N,
  modelDef: M[N],
  models: M,
  connectionPool: oracledb.Pool,
  postProcess?: (res: any) => any
): ModelCreate<M, N> {
  return async function createFn<Debug extends boolean = false>(
    options: ModelCreateOptions<M, N, Debug>
  ): Promise<any> {
    const { data, debug } = options;
    const showDebug = debug === true;
    const tableName = modelDef.table;

    // Extract field data from main object (excluding relations)
    const fields: string[] = [];
    const values: any[] = [];

    // Process each field in the data object
    for (const [field, value] of Object.entries(data)) {
      // Skip relation fields
      if (
        modelDef.relations &&
        modelDef.relations[field as keyof typeof modelDef.relations]
      ) {
        continue;
      }

      // Handle regular fields
      if (
        modelDef.columns &&
        modelDef.columns[field as keyof typeof modelDef.columns]
      ) {
        fields.push(field);
        values.push(value);
      }
    }

// Get primary key columns and check for missing ones
const primaryKeyColumns = getPrimaryKeyColumns(modelDef);
if (primaryKeyColumns.length === 0) {
  throw new Error(`No primary key defined for table ${tableName}`);
}

// For each primary key that's not provided, we'll need to get a sequence value
const missingPks = primaryKeyColumns.filter((pk: string) => !fields.includes(pk));
const sequenceSelects = missingPks.map((pk: string) => 
  `SELECT ${formatIdentifier(tableName)}_SEQ.NEXTVAL INTO :${pk}_seq FROM DUAL`
).join(";\n");

// Add missing primary keys to fields and placeholders
missingPks.forEach((pk: string) => {
  fields.push(pk);
});

// Prepare SQL query
const placeholders = fields.map((field, i) => {
  if (missingPks.includes(field)) {
    return `:${field}_seq`; // Use sequence value for missing PKs
  }
  return `:${i + 1}`; // Oracle uses numeric placeholders
});

let sql = sequenceSelects ? `${sequenceSelects};\n` : '';
sql += `
INSERT INTO ${formatIdentifier(tableName)} (${fields.map(f => formatIdentifier(f)).join(", ")})
VALUES (${placeholders.join(", ")})`;

// Add returning clause for primary key(s)
const returningCols = primaryKeyColumns
  .map((col: string) => formatIdentifier(col))
  .join(", ");
const returningBinds = primaryKeyColumns
  .map((col: string) => `:${col}`)
  .join(", ");
sql += ` RETURNING ${returningCols} INTO ${returningBinds}`;
    
    let connection;
    let result: any = null;
    let error = null;

    try {
      connection = await connectionPool.getConnection();
      
      // Start a transaction
      // await connection.execute("BEGIN");

      // Set up binding object with values and output parameter
      const bindVars: any = {};
      values.forEach((val, idx) => {
        bindVars[String(idx + 1)] = val;
      });
      
      // Add output bindings for primary key(s)
      primaryKeyColumns.forEach((col: string) => {
        if (missingPks.includes(col)) {
          // If using sequence, we'll bind the OUT parameter with sequence value
          bindVars[`${col}_seq`] = { type: oracledb.NUMBER, dir: oracledb.BIND_INOUT };
        } else {
          bindVars[col] = { type: oracledb.NUMBER, dir: oracledb.BIND_OUT };
        }
      });
      
      // Execute the insert
      const insertResult = await connection.execute(sql, bindVars, { autoCommit: false });
      
      // Get the inserted ID
      // Get the inserted primary key values
      let pkValues: Record<string, any> = {};
      if (insertResult.outBinds) {
        const outBinds = insertResult.outBinds as Record<string, any>;
        primaryKeyColumns.forEach((col: string) => {
          if (outBinds[col]) {
            pkValues[col] = outBinds[col][0];
          }
        });
      }

      // Process relations if any
      if (modelDef.relations) {
        for (const [field, value] of Object.entries(data)) {
          // Check if it's a relation field with data
          if (
            modelDef.relations[field as keyof typeof modelDef.relations] &&
            value !== null &&
            value !== undefined
          ) {
            const relationDef = modelDef.relations[field as keyof typeof modelDef.relations];
            
            if (!relationDef) continue;
            
            // Handle the relation based on its type
            // For has_many relations (arrays of items)
            if (relationDef.type === "has_many" && Array.isArray(value)) {
              for (const relItem of value) {
                // Handle relation creating/updating
                // Get the primary key value for the relation
                const pkColumn = primaryKeyColumns && primaryKeyColumns[0];
                const pkValue = pkColumn ? pkValues[pkColumn] : null;
                await processRelationItem(
                  connection,
                  modelName,
                  relationDef,
                  relItem,
                  models,
                  pkValue
                );
              }
            } 
            // For belongs_to/has_one relations (single items)
            else if (
              (relationDef.type === "belongs_to" || relationDef.type === "has_one") &&
              typeof value === "object"
            ) {
              // Get the primary key value for the relation
              const pkColumn = primaryKeyColumns && primaryKeyColumns[0];
              const pkValue = pkColumn ? pkValues[pkColumn] : null;
              await processRelationItem(
                connection,
                modelName,
                relationDef,
                value,
                models,
                pkValue
              );
            }
          }
        }
      }

      // Commit the transaction
      await connection.execute("COMMIT");

      // Fetch the created record for return
      if (Object.keys(pkValues).length > 0) {
        const whereConditions = Object.entries(pkValues)
          .map(([col, _], idx) => `${formatIdentifier(col)} = :${idx + 1}`)
          .join(" AND ");
        const selectSql = `SELECT * FROM ${formatIdentifier(tableName)} WHERE ${whereConditions}`;
        
        const selectResult = await connection.execute(selectSql, Object.values(pkValues));
        
        if (selectResult.rows && selectResult.rows.length > 0) {
          result = selectResult.rows[0];
          
          if (postProcess) {
            result = postProcess(result);
          }
        }
      }

      if (showDebug) {
        return {
          data: result,
          sql,
        };
      } else {
        return result;
      }
    } catch (err) {
      error = err;
      
      // Rollback on error
      if (connection) {
        try {
          await connection.execute("ROLLBACK");
        } catch (rollbackErr) {
          console.error("Error during rollback:", rollbackErr);
        }
      }

      if (showDebug) {
        return {
          data: null,
          error: err instanceof Error ? err.message : String(err),
          sql,
        };
      }
      
      throw err;
    } finally {
      if (connection) {
        try {
          await connection.close();
        } catch (err) {
          console.error("Error closing Oracle connection:", err);
        }
      }
    }
  } as ModelCreate<M, N>;
}

/**
 * Creates a function to handle updating existing records in Oracle
 */
export function createUpdate<
  M extends Record<string, ModelDefinition<string>>,
  N extends keyof M
>(
  modelName: N,
  modelDef: M[N],
  models: M,
  connectionPool: oracledb.Pool,
  postProcess?: (res: any) => any
): ModelUpdate<M, N> {
  return async function updateFn<Debug extends boolean = false>(
    options: ModelUpdateOptions<M, N, Debug>
  ): Promise<any> {
    const { data, where, debug } = options;
    const showDebug = debug === true;
    const tableName = modelDef.table;

    // Extract field data from main object (excluding relations)
    const updateFields: string[] = [];
    const updateValues: any[] = [];

    // Process each field in the data object
    for (const [field, value] of Object.entries(data)) {
      // Skip relation fields
      if (
        modelDef.relations &&
        modelDef.relations[field as keyof typeof modelDef.relations]
      ) {
        continue;
      }

      // Handle regular fields
      if (
        modelDef.columns &&
        modelDef.columns[field as keyof typeof modelDef.columns]
      ) {
        updateFields.push(field);
        updateValues.push(value);
      }
    }

    // If there are no fields to update, return early
    if (updateFields.length === 0) {
      if (showDebug) {
        return {
          data: null,
          sql: "-- No fields to update",
        };
      }
      return null;
    }

    // Build WHERE clause
    const whereClauseStr = where
      ? buildWhereClauseStr(modelName, where, models)
      : "1=1";

    // Build the SET clause with placeholders
    const setClause = updateFields
      .map((field, index) => `${formatIdentifier(field)} = :${index + 1}`)
      .join(", ");

    // Prepare SQL query
    const sql = `
UPDATE ${formatIdentifier(tableName)}
SET ${setClause}
WHERE ${whereClauseStr}`;

    let connection;
    let result: any = null;
    let error = null;

    try {
      connection = await connectionPool.getConnection();
      
      // Start a transaction
      await connection.execute("BEGIN");

      // Execute the update with binding
      const bindVars: any = {};
      updateValues.forEach((val, idx) => {
        bindVars[String(idx + 1)] = val;
      });
      
      const updateResult = await connection.execute(sql, bindVars, { autoCommit: false });
      const rowsAffected = updateResult.rowsAffected || 0;

      // Find the IDs of the updated records to process relations
      let selectWhere = whereClauseStr;
      let selectSql = `SELECT * FROM ${formatIdentifier(tableName)} WHERE ${selectWhere}`;
      
      const selectResult = await connection.execute(selectSql);
      
      if (selectResult.rows && selectResult.rows.length > 0) {
        const updatedRecords = selectResult.rows;

        // Process relations for each updated record if any
        if (modelDef.relations) {
          for (const record of updatedRecords) {
            // Type assertion to safely access record properties
            const typedRecord = record as Record<string, any>;
            const recordId = typedRecord.ID || typedRecord.id; // Now safely access ID or id property
            if (!recordId) continue;

            for (const [field, value] of Object.entries(data)) {
              // Check if it's a relation field with data
              if (
                modelDef.relations[field as keyof typeof modelDef.relations] &&
                value !== null &&
                value !== undefined
              ) {
                const relationDef = modelDef.relations[field as keyof typeof modelDef.relations];
                
                if (!relationDef) continue;
                
                // Handle the relation based on its type
                // For has_many relations (arrays of items)
                if (relationDef.type === "has_many" && Array.isArray(value)) {
                  for (const relItem of value) {
                    // Handle relation creating/updating
                    await processRelationItem(
                      connection,
                      modelName,
                      relationDef,
                      relItem,
                      models,
                      recordId
                    );
                  }
                } 
                // For belongs_to/has_one relations (single items)
                else if (
                  (relationDef.type === "belongs_to" || relationDef.type === "has_one") &&
                  typeof value === "object"
                ) {
                  await processRelationItem(
                    connection,
                    modelName,
                    relationDef, 
                    value,
                    models,
                    recordId
                  );
                }
              }
            }
          }
        }

        result = updatedRecords;
        
        if (postProcess) {
          result = postProcess(result);
        }
      }

      // Commit the transaction
      await connection.execute("COMMIT");

      if (showDebug) {
        return {
          data: result,
          rowsAffected,
          sql,
        };
      } else {
        return result;
      }
    } catch (err) {
      error = err;
      
      // Rollback on error
      if (connection) {
        try {
          await connection.execute("ROLLBACK");
        } catch (rollbackErr) {
          console.error("Error during rollback:", rollbackErr);
        }
      }

      if (showDebug) {
        return {
          data: null,
          error: err instanceof Error ? err.message : String(err),
          sql,
        };
      }
      
      throw err;
    } finally {
      if (connection) {
        try {
          await connection.close();
        } catch (err) {
          console.error("Error closing Oracle connection:", err);
        }
      }
    }
  } as ModelUpdate<M, N>;
}

/**
 * Helper function to process relation items during create/update operations
 */
async function processRelationItem<
  M extends Record<string, ModelDefinition<string>>,
  N extends keyof M
>(
  connection: oracledb.Connection,
  modelName: N,
  relationDef: any,
  relItem: any,
  models: M,
  parentId: any
): Promise<void> {
  if (!relItem) return;

  const targetModelName = relationDef.to.model;
  const targetModelDef = models[targetModelName as keyof M];
  
  if (!targetModelDef) return;
  
  const targetTableName = targetModelDef.table;

  // Check if this is a delete operation
  if (relItem._delete === true) {
    // Handle deletion
    let deleteSql = '';
    
    if (relationDef.type === "has_many" || relationDef.type === "has_one") {
      // For has_many/has_one, delete/update the records that reference the parent
      deleteSql = `
        DELETE FROM ${formatIdentifier(targetTableName)}
        WHERE ${formatIdentifier(relationDef.to.column)} = :1`;
      
      await connection.execute(deleteSql, [parentId]);
    }
    // For belongs_to, we normally don't delete the parent - just update the reference
  }
  // Check if this is a create or update operation
  else {
    // Extract fields and values, excluding special operation flags
    const fields: string[] = [];
    const values: any[] = [];
    
    // Process fields from the relation item
    for (const [field, value] of Object.entries(relItem)) {
      if (field === "_delete") continue; // Skip operation flags
      
      if (targetModelDef.columns && targetModelDef.columns[field]) {
        fields.push(field);
        values.push(value);
      }
    }
    
    // Add the relation linking field if not already present
    const linkField = relationDef.to.column;
    if (!fields.includes(linkField)) {
      fields.push(linkField);
      values.push(parentId);
    }
    
    // Check if we have an ID field to determine if this is update or insert
    const idField = Object.keys(relItem).find(k => k === "id" || k === "ID");
    
    if (idField && relItem[idField]) {
      // This is an update - has an ID
      const updateFields = fields.filter(f => f !== idField);
      const updateValues = values.filter((_, i) => fields[i] !== idField);
      
      if (updateFields.length > 0) {
        // Build SET clause
        const setClause = updateFields
          .map((field, i) => `${formatIdentifier(field)} = :${i + 1}`)
          .join(", ");
          
        const updateSql = `
          UPDATE ${formatIdentifier(targetTableName)}
          SET ${setClause}
          WHERE ${formatIdentifier(idField)} = :${updateFields.length + 1}`;
          
        const bindVars: any = {};
        updateValues.forEach((val, idx) => {
          bindVars[String(idx + 1)] = val;
        });
        bindVars[String(updateFields.length + 1)] = relItem[idField];
        
        await connection.execute(updateSql, bindVars, { autoCommit: false });
      }
    } else {
      // This is an insert - no ID
      const placeholders = fields.map((_, i) => `:${i + 1}`);
      
      const insertSql = `
        INSERT INTO ${formatIdentifier(targetTableName)} (${fields.map(f => formatIdentifier(f)).join(", ")})
        VALUES (${placeholders.join(", ")})`;
        
      const bindVars: any = {};
      values.forEach((val, idx) => {
        bindVars[String(idx + 1)] = val;
      });
      
      await connection.execute(insertSql, bindVars, { autoCommit: false });
    }
  }
}
