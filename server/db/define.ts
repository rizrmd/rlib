import { SQL } from "bun";
import { createFindMany, createFindFirst } from "./postgres/query-read";
import { createCreate, createUpdate } from "./postgres/query-write";
import type { ModelDefinition } from "./types-gen";
import type { ModelOperations } from "./types-lib";

export const defineDB = async <T extends { [K in string]: ModelDefinition<K> }>(
  models: T,
  url: string
) => {
  const db = {} as ModelOperations<T>;

  const sql = new SQL({ url });
  await sql.connect();

  // Create operations for each model
  for (const modelName of Object.keys(models) as Array<keyof T>) {
    const modelDef = models[modelName];

    // Set up model operations using sql directly instead of sql.unsafe
    db[modelName] = {
      findMany: createFindMany(modelName, modelDef, models, sql),
      findFirst: createFindFirst(modelName, modelDef, models, sql),
      create: createCreate(modelName, modelDef, models, sql),
      update: createUpdate(modelName, modelDef, models, sql),
    };
  }

  return db;
};
