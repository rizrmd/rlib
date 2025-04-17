import { SQL } from "bun";
import { createQuery } from "./postgres/query";
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

    // Set up model operations
    db[modelName] = {
      findMany: createQuery(modelName, modelDef, models, sql.unsafe),
    };
  }

  return db;
};
