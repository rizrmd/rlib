import type { ModelOperations } from "./types-lib";
import type { ModelDefinition } from "./types-gen";
import { createQuery } from "./postgres/query";

export const defineDB = <T extends { [K in string]: ModelDefinition<K> }>(
  models: T
) => {
  const db = {} as ModelOperations<T>;
  
  // Create operations for each model
  for (const modelName of Object.keys(models) as Array<keyof T>) {
    const modelDef = models[modelName];
    
    // Set up model operations
    db[modelName] = {
      findMany: createQuery(modelName, modelDef, models)
    };
  }

  return db;
};
