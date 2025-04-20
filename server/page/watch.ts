import { readdirSync, watch, writeFileSync } from "fs";
import { join, parse } from "path";
import { dir } from "../util/dir";

export const watchPage = (opt: { input_dir: string; out_file: string }) => {
  const PAGES_DIR = dir.path(opt.input_dir);
  const ROUTES_FILE = dir.path(opt.out_file);
  // Watch for changes
  watch(PAGES_DIR, { recursive: true }, (eventType, filename) => {
    if (filename && filename.endsWith(".tsx")) {
      console.log(`Change detected in: ${filename}`);
      buildPages(opt);
    }
  });
};

export const buildPages = async (opt: {
  input_dir: string;
  out_file: string;
}) => {
  const PAGES_DIR = dir.path(opt.input_dir);
  const ROUTES_FILE = dir.path(opt.out_file);

  function generateRoutes(dir: string, base = ""): Record<string, string> {
    const routes: Record<string, string> = {};
    const files = readdirSync(dir, { withFileTypes: true });

    for (const file of files) {
      const path = join(dir, file.name);
      if (file.isDirectory()) {
        Object.assign(routes, generateRoutes(path, join(base, file.name)));
      } else {
        const { name, ext } = parse(file.name);
        if (ext === ".tsx") {
          let route = join(base, name === "index" ? "." : name).replace(
            /\\/g,
            "/"
          );
          route =
            route === "." ? "/" : route.startsWith("/") ? route : `/${route}`;
          routes[route] = `@/pages${route === "/" ? "" : route}`;
        }
      }
    }

    return routes;
  }

  function updateRoutesFile() {
    const routes = generateRoutes(PAGES_DIR);
    const content = `\
// Auto-generated file - DO NOT EDIT
export const pageModules: Record<string, () => Promise<any>> = {
${Object.entries(routes)
  .map(([route, path]) => `  "${route}": () => import("${path}"),`)
  .join("\n")}
};`;

    writeFileSync(ROUTES_FILE, content);
  }

  // Initial generation
  updateRoutesFile();
};
