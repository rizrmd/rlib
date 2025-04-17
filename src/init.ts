import { defineDB } from "./db/define";
import type { ModelDefinition } from "./db/types-gen";
import { dir } from "./util/dir";
import { join } from "path";

export const init = async <
  T extends { [K in string]: ModelDefinition<K> }
>(opt: {
  root: string;
  models: T;
}) => {
  dir.root = join(process.cwd());

  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is not set. Please set it in your environment variables."
    );
  }
  (global as any).db = await defineDB(opt.models, process.env.DATABASE_URL!);

  return {
    isDEV: process.argv.includes("--dev"),
  };
};
