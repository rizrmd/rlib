import type { SiteConfig } from "../../client";
import type { buildAPI } from "../api/watch";

export const initEnv = (config?: SiteConfig) => {
  let isDev = process.argv.includes("--dev");
  let isLiveReload = false;
  if ((global as any).db) {
    isLiveReload = true;
  }

  const frontend_out = ["frontend:src/lib/gen/api.ts"];
  if (config?.mobile?.enabled) {
    frontend_out.push("mobile:src/gen/api.ts");
  }

  const apiConfig = {
    input_dir: "backend:src/api",
    export_file: "backend:src/gen/api.ts",
    frontend_out,
  } as Parameters<typeof buildAPI>[0];

  const pageConfig = {
    input_dir: "frontend:src/pages",
    out_file: "frontend:src/lib/gen/routes.ts",
  };

  return { isDev, isLiveReload, apiConfig, pageConfig };
};
