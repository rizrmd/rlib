import type { buildAPI } from "../api/watch";

export const initEnv = () => {
  let isDev = process.argv.includes("--dev");
  let isLiveReload = false;
  if ((global as any).db) {
    isLiveReload = true;
  }

  const apiConfig = {
    input_dir: "backend:src/api",
    export_file: "backend:src/gen/api.ts",
    frontend_out: ["frontend:src/lib/gen/api.ts"],
  } as Parameters<typeof buildAPI>[0];

  const pageConfig = {
    input_dir: "frontend:src/pages",
    out_file: "frontend:src/lib/gen/routes.ts",
  };

  return { isDev, isLiveReload, apiConfig, pageConfig };
};
