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
    } & {
      [R in RelationField<M, N>]?: any[] | any;
    };
    where?: WhereFields<M, N>;
    debug?: Debug;
  }) {
    const { debug } = options;
    // Extract direct column data and relation data separately
    const columnData: Record<string, any> = {};
    const relationData: Record<string, any> = {};

    // Split data into columns and relations
    Object.entries(options.data).forEach(([key, value]) => {
      if (modelDef.columns[key] !== undefined) {
        columnData[key] = value;
      } else if (modelDef.relations?.[key] !== undefined) {
        relationData[key] = value;
      }
    });

    // Process relation data from the data argument into relations operations
    const relations: Record<string, { 
      create?: any[], 
      update?: { where: any; data: any }[], 
      delete?: any[] 
    }> = {};
    
    Object.entries(relationData).forEach(([relationName, relationValue]) => {
      const relation = modelDef.relations?.[relationName];
      if (!relation) return;
      
      // Handle array relations (has_many) vs single object relations (belongs_to/has_one)
      const relationItems = Array.isArray(relationValue) ? relationValue : relationValue ? [relationValue] : [];
      
      if (relationItems.length > 0) {
        // Determine operation type based on the presence of 'id' property in relation items
        const createItems: any[] = [];
        const updateItems: { where: { id: any }; data: any }[] = [];
        const deleteItems: { id: any }[] = [];
        
        for (const item of relationItems) {
          if (item === null) continue;
          
          if (typeof item === 'object') {
            if (item._delete === true) {
              // If _delete flag is present, add to delete items
              if (item.id) {
                deleteItems.push({ id: item.id });
              }
            } else if (item.id) {
              // If id exists, it's an update operation
              const { id, ...data } = item;
              updateItems.push({ where: { id }, data });
            } else {
              // No id means create operation
              createItems.push(item);
            }
          }
        }
        
        // Build the relations object with appropriate operations
        relations[relationName] = {};
        
        if (createItems.length > 0) relations[relationName].create = createItems;
        if (updateItems.length > 0) relations[relationName].update = updateItems;
        if (deleteItems.length > 0) relations[relationName].delete = deleteItems;
      }
    });

    const where = options.where;
    const tableName = modelDef.table;
    const showDebug = debug === true;

    // Start a transaction for the update and related operations
    await sql`BEGIN`;

    try {
      // Build the update query
      let updateQuery = `UPDATE "${tableName}" SET `;

      // Prepare set clauses
      const setClauses: string[] = [];
      for (const [field, value] of Object.entries(columnData)) {
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
    } & {
      [R in RelationField<M, N>]?: any[] | any;
    };
    debug?: Debug;
  }) {
    const { debug } = options;
    // Extract direct column data and relation data separately
    const columnData: Record<string, any> = {};
    const relationData: Record<string, any> = {};

    // Split data into columns and relations
    Object.entries(options.data).forEach(([key, value]) => {
      if (modelDef.columns[key] !== undefined) {
        columnData[key] = value;
      } else if (modelDef.relations?.[key] !== undefined) {
        relationData[key] = value;
      }
    });
    
    // Process relation data from the data argument into relations operations
    const relations: Record<string, { create?: any[] }> = {};
    
    Object.entries(relationData).forEach(([relationName, relationValue]) => {
      const relation = modelDef.relations?.[relationName];
      if (!relation) return;
      
      // Handle array relations (has_many) vs single object relations (belongs_to/has_one)
      const relationItems = Array.isArray(relationValue) ? relationValue : relationValue ? [relationValue] : [];
      
      if (relationItems.length > 0) {
        // All items in data for create operations are treated as create operations
        const createItems = relationItems.filter(item => item !== null && typeof item === 'object');
        
        if (createItems.length > 0) {
          relations[relationName] = { create: createItems };
        }
      }
    });

    const tableName = modelDef.table;
    const showDebug = debug === true;

    // Start a transaction for the insert and related operations
    await sql`BEGIN`;

    try {
      // Build the insert query
      const columns = Object.keys(columnData)
        .map((col) => `"${col}"`)
        .join(", ");
      const values = Object.values(columnData)
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

        // Handle creations
        if (relationOps.create && relationOps.create.length > 0) {
          for (const createData of relationOps.create) {
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
