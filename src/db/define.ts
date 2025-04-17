import type { ModelOperations } from "./types-lib";
import type { ModelDefinition } from "./types-gen";

export const defineDB = <T extends Record<string, ModelDefinition>>(
  models: T
) => {
  const db = {} as ModelOperations<T>;

  return db;
};
