import type { ModelOperations } from "./types-lib";
import type { ModelDefinition } from "./types-gen";

export const defineDB = <T extends { [K in string]: ModelDefinition<K> }>(
  models: T
) => {
  const db = {} as ModelOperations<T>;

  return db;
};
