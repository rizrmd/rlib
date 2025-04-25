import type { Server } from "bun";
import { padEnd } from "lodash";
import type { SiteEntry } from "../../client/types";
import {
  buildAPI,
  buildPages,
  c,
  dir,
  initHandler,
  staticFileHandler,
  type onFetch,
} from "../../server";
import { initEnv } from "./env";
import { initBaseUrlFile } from "./base-file";

export const initProd = async ({
  loadApi,
  loadModels,
  onFetch,
}: {
  loadModels: () => Promise<any>;
  loadApi: () => Promise<any>;
  onFetch?: onFetch;
}) => {
  const { apiConfig, isDev, isLiveReload, pageConfig } = initEnv();
  if (isDev) return null;

  await initBaseUrlFile();
  await buildAPI(apiConfig);
  await buildPages(pageConfig);

  const { config, routes } = await initHandler({
    root: process.cwd(),
    models: await loadModels(),
    backendApi: await loadApi(),
  });

  // Production mode
  console.log(`${c.blue}PROD${c.reset} Building frontend...`);

  // Run the build script in the frontend folder
  const buildProcess = Bun.spawn(["bun", "run", "build"], {
    cwd: dir.path("frontend:"),
    stdout: "inherit",
    stderr: "inherit",
  });

  const buildExit = await buildProcess.exited;

  if (buildExit !== 0) {
    console.error(
      `${c.red}ERROR${c.reset} Frontend build failed with exit code ${buildExit}`
    );
    process.exit(1);
  }

  console.log(`${c.green}PROD${c.reset} Frontend built successfully`);

  // Setup static file handlers for both public and dist directories
  const handlePublic = staticFileHandler({
    publicDir: "frontend:public",
    cache: true,
    maxAge: 86400, // 1 day cache
  });

  const handleDist = staticFileHandler({
    publicDir: "frontend:dist",
    cache: true,
    maxAge: 86400, // 1 day cache
    spaIndexFile: "index.html",
  });

  // Choose default port - either defined in an environment variable or use 3000
  const port = process.env.PORT
    ? parseInt(process.env.PORT)
    : config?.backend?.prodPort || 3000;

  // Choose default site (first site in config if no specific default is provided)
  const defaultSiteName =
    process.env.DEFAULT_SITE || Object.keys(config.sites)[0];

  // Define server with proper type
  const server = Bun.serve({
    port,
    fetch: async (req): Promise<Response> => {
      const url = new URL(req.url);
      const host = req.headers.get("host") || "";

      if (onFetch) {
        let res = onFetch({
          url,
          req,
          server,
        });
        if (typeof res === "object") {
          if (res instanceof Promise) {
            res = await res;
          }
          if (res instanceof Response) {
            return res;
          }
        }
      }

      // Determine which site config to use based on the domain
      let siteName: string | null = null;
      let siteConfig: SiteEntry | null = null;

      for (const [name, site] of Object.entries(config.sites)) {
        if (
          site.domains?.some(
            (domain) => host === domain || host.endsWith(`.${domain}`)
          )
        ) {
          siteName = name;
          siteConfig = site;
          break;
        }
      }

      // If no matching domain found and we have a default site, use that
      if (!siteName && defaultSiteName && config.sites[defaultSiteName]) {
        siteName = defaultSiteName;
        siteConfig = config.sites[defaultSiteName] as any;
      }

      // If we still don't have a site, return 404
      if (!siteName || !siteConfig) {
        return new Response("Domain not configured", { status: 404 });
      }

      // If not a static file, handle API routes if available for this site
      const siteRoutes = siteName ? routes[siteName] : undefined;

      if (siteRoutes && Array.isArray(siteRoutes)) {
        // Find the first route that matches both method and path pattern
        const matchingRoute = siteRoutes.find((r) => {
          if (
            !r ||
            typeof r.pattern !== "string" ||
            typeof r.method !== "string"
          ) {
            return false;
          }
          return r.method === req.method && url.pathname.match(r.pattern);
        });

        if (matchingRoute && typeof matchingRoute.handler === "function") {
          try {
            return await matchingRoute.handler(req);
          } catch (err) {
            console.error(`API error:`, err);
            return new Response("Internal Server Error", { status: 500 });
          }
        }
      }

      // Try to serve static files first
      const staticResponse = await handlePublic(req);
      if (staticResponse) {
        return staticResponse;
      }

      // Then try dist files (built frontend)
      const distResponse = await handleDist(req);
      if (distResponse) {
        return distResponse;
      }
      return new Response("Not Found", { status: 404 });
    },
  });

  console.log(
    `${c.blue}PROD${c.reset} Server started on port ${c.magenta}${port}${c.reset}`
  );
  console.log(`${c.blue}PROD${c.reset} Configured domains:`);

  for (const [name, site] of Object.entries(config.sites)) {
    if (site.domains && site.domains.length > 0) {
      console.log(
        `- ${padEnd(name + " ", 20, "─")} ${c.magenta}${site.domains.join(
          ", "
        )}${c.reset}${
          defaultSiteName === name ? ` (${c.green}default${c.reset})` : ""
        }`
      );
    }
  }
};
