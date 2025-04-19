import type { ModelDefinition } from "../types-gen";
import type {
  WhereFields,
  ModelField,
  FieldValue,
  RelationField,
} from "../types-lib";
import { formatValue } from "./query-util";

/**
 * Creates a function to update records in the database
 */
export function createUpdate<
  M extends Record<string, ModelDefinition<string>>,
  N extends keyof M
>(modelName: N, modelDef: M[N], models: M, sql: Bun.SQL) {
  return async function updateFn<Debug extends boolean = false>(options: {
    data: {
      [F in ModelField<M, N>]?: FieldValue<M, N, F>;
    };
    where?: WhereFields<M, N>;
    relations?: {
      [R in RelationField<M, N>]?: {
        create?: any[];
        update?: { where: any; data: any }[];
        delete?: any[];
      };
    };
    debug?: Debug;
  }) {
    const { data, where, relations = {}, debug } = options;
    const tableName = modelDef.table;
    const showDebug = debug === true;

    // Start a transaction for the update and related operations
    await sql`BEGIN`;

    try {
      // Build the update query
      let updateQuery = `UPDATE "${tableName}" SET `;

      // Prepare set clauses
      const setClauses: string[] = [];
      for (const [field, value] of Object.entries(data)) {
        setClauses.push(`"${field}" = ${formatValue(value)}`);
      }

      updateQuery += setClauses.join(", ");

      // Add where clause if provided
      if (where) {
        const buildWhereClauseStr = (await import("./query-read"))
          .buildWhereClauseStr;
        updateQuery += ` WHERE ${buildWhereClauseStr(
          modelName,
          where,
          models
        )}`;
      }

      updateQuery += ` RETURNING *`;

      // Execute the update
      const result = await sql.unsafe(updateQuery);

      // Process related records
      for (const [relationName, relationOps] of Object.entries(relations)) {
        const relation = modelDef.relations?.[relationName];
        if (!relation) continue;

        const targetModelName = relation.to.model;
        const targetModelKey = targetModelName as keyof M;
        const targetModelDef = models[targetModelKey];
        if (!targetModelDef) continue;
        const targetTable = targetModelDef.table;

        // Use type assertion for relationOps to resolve TypeScript errors
        const typedRelationOps = relationOps as {
          create?: any[];
          update?: { where: any; data: any }[];
          delete?: any[];
        };

        // Handle creations
        if (typedRelationOps.create && typedRelationOps.create.length > 0) {
          for (const createData of typedRelationOps.create) {
            // Add the foreign key reference
            const createWithRelation = {
              ...createData,
              [relation.to.column]: result[0][relation.from],
            };

            // Build INSERT query
            let insertQuery = `INSERT INTO "${targetTable}" (`;
            const columns = Object.keys(createWithRelation)
              .map((col) => `"${col}"`)
              .join(", ");
            const values = Object.values(createWithRelation)
              .map((val) => formatValue(val))
              .join(", ");

            insertQuery += `${columns}) VALUES (${values}) RETURNING *`;
            await sql.unsafe(insertQuery);
          }
        }

        // Handle updates
        if (typedRelationOps.update && typedRelationOps.update.length > 0) {
          for (const {
            where: updateWhere,
            data: updateData,
          } of typedRelationOps.update) {
            // Ensure the foreign key relation is maintained
            const whereWithRelation = {
              ...updateWhere,
              [relation.to.column]: {
                eq: result[0][relation.from],
              },
            };

            // Convert where object to SQL WHERE clause
            const whereConditions: string[] = [];
            for (const [field, value] of Object.entries(whereWithRelation)) {
              if (
                typeof value === "object" &&
                value !== null &&
                "eq" in value
              ) {
                whereConditions.push(`"${field}" = ${formatValue(value.eq)}`);
              } else {
                whereConditions.push(`"${field}" = ${formatValue(value)}`);
              }
            }

            // Build UPDATE query for related records
            let relUpdateQuery = `UPDATE "${targetTable}" SET `;
            const relSetClauses: string[] = [];
            for (const [field, value] of Object.entries(updateData)) {
              relSetClauses.push(`"${field}" = ${formatValue(value)}`);
            }

            relUpdateQuery += relSetClauses.join(", ");
            relUpdateQuery += ` WHERE ${whereConditions.join(
              " AND "
            )} RETURNING *`;
            await sql.unsafe(relUpdateQuery);
          }
        }

        // Handle deletions
        if (typedRelationOps.delete && typedRelationOps.delete.length > 0) {
          for (const deleteWhere of typedRelationOps.delete) {
            // Ensure the foreign key relation is maintained
            const whereWithRelation = {
              ...deleteWhere,
              [relation.to.column]: {
                eq: result[0][relation.from],
              },
            };

            // Convert where object to SQL WHERE clause
            const whereConditions: string[] = [];
            for (const [field, value] of Object.entries(whereWithRelation)) {
              if (
                typeof value === "object" &&
                value !== null &&
                "eq" in value
              ) {
                whereConditions.push(`"${field}" = ${formatValue(value.eq)}`);
              } else {
                whereConditions.push(`"${field}" = ${formatValue(value)}`);
              }
            }

            // Build DELETE query for related records
            let deleteQuery = `DELETE FROM "${targetTable}" WHERE ${whereConditions.join(
              " AND "
            )}`;
            await sql.unsafe(deleteQuery);
          }
        }
      }

      // Commit the transaction
      await sql`COMMIT`;

      if (showDebug) {
        return {
          data: result,
          sql: updateQuery,
        };
      } else {
        return result;
      }
    } catch (error) {
      // Rollback in case of error
      await sql`ROLLBACK`;

      if (showDebug) {
        return {
          data: null,
          error: error instanceof Error ? error.message : String(error),
        };
      } else {
        throw error;
      }
    }
  };
}

/**
 * Creates a function to create new records in the database
 */
export function createCreate<
  M extends Record<string, ModelDefinition<string>>,
  N extends keyof M
>(modelName: N, modelDef: M[N], models: M, sql: Bun.SQL) {
  return async function createFn<Debug extends boolean = false>(options: {
    data: {
      [F in ModelField<M, N>]?: FieldValue<M, N, F>;
    };
    relations?: {
      [R in RelationField<M, N>]?: {
        create?: any[];
      };
    };
    debug?: Debug;
  }) {
    const { data, relations = {}, debug } = options;
    const tableName = modelDef.table;
    const showDebug = debug === true;

    // Start a transaction for the insert and related operations
    await sql`BEGIN`;

    try {
      // Build the insert query
      const columns = Object.keys(data)
        .map((col) => `"${col}"`)
        .join(", ");
      const values = Object.values(data)
        .map((val) => formatValue(val))
        .join(", ");

      const insertQuery = `INSERT INTO "${tableName}" (${columns}) VALUES (${values}) RETURNING *`;
      const result = await sql.unsafe(insertQuery);

      // Process related records
      for (const [relationName, relationOps] of Object.entries(relations)) {
        const relation = modelDef.relations?.[relationName];
        if (!relation) continue;

        const targetModelName = relation.to.model;
        const targetModelKey = targetModelName as keyof M;
        const targetModelDef = models[targetModelKey];
        if (!targetModelDef) continue;
        const targetTable = targetModelDef.table;

        // Use type assertion for relationOps to resolve TypeScript errors
        const typedRelationOps = relationOps as {
          create?: any[];
        };

        // Handle creations
        if (typedRelationOps.create && typedRelationOps.create.length > 0) {
          for (const createData of typedRelationOps.create) {
            // Add the foreign key reference
            const createWithRelation = {
              ...createData,
              [relation.to.column]: result[0][relation.from],
            };

            // Build INSERT query
            let relInsertQuery = `INSERT INTO "${targetTable}" (`;
            const relColumns = Object.keys(createWithRelation)
              .map((col) => `"${col}"`)
              .join(", ");
            const relValues = Object.values(createWithRelation)
              .map((val) => formatValue(val))
              .join(", ");

            relInsertQuery += `${relColumns}) VALUES (${relValues})`;
            await sql.unsafe(relInsertQuery);
          }
        }
      }

      // Commit the transaction
      await sql`COMMIT`;

      if (showDebug) {
        return {
          data: result,
          sql: insertQuery,
        };
      } else {
        return result;
      }
    } catch (error) {
      // Rollback in case of error
      await sql`ROLLBACK`;

      if (showDebug) {
        return {
          data: null,
          error: error instanceof Error ? error.message : String(error),
        };
      } else {
        throw error;
      }
    }
  };
}
