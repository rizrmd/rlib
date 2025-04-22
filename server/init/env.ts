export const initEnv = () => {
  let isDev = process.argv.includes("--dev");
  let isLiveReload = false;
  if ((global as any).db) {
    isLiveReload = true;
  }

  const apiConfig = {
    input_dir: "backend:src/api",
    out_file: "backend:src/gen/api.ts",
  };
  const pageConfig = {
    input_dir: "frontend:src/pages",
    out_file: "frontend:src/lib/gen/routes.ts",
  };

  return { isDev, isLiveReload, apiConfig, pageConfig };
};
