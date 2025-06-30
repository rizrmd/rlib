import {
  build,
  type HTMLBundle,
  type Server,
  type WebSocketHandler,
} from "bun";
import bunPluginTailwind from "bun-plugin-tailwind";
import { padEnd } from "lodash";
import { basename, dirname, extname, join } from "path";
import { rimrafSync } from "rimraf";
import type { SiteConfig, SiteEntry } from "../../client/types";
import {
  buildAPI,
  buildPages,
  c,
  dir,
  initHandler,
  staticFileHandler,
  type onFetch,
} from "../../server";
import { initBaseFile } from "./base-file";
import { initEnv } from "./env";
export const initProd = async ({
  index,
  loadApi,
  loadModels,
  onFetch,
  config,
  onStart,
  ws: optWs,
}: {
  index: HTMLBundle;
  loadModels: () => Promise<any>;
  loadApi: () => Promise<any>;
  onFetch?: onFetch;
  ws?: Record<
    string,
    WebSocketHandler<object> & {
      upgrade?: (opt: {
        req: Request;
        server: Server;
      }) => object | Promise<object>;
    }
  >;
  config: SiteConfig;
  onStart?: () => Promise<void>;
}) => {
  const { apiConfig, isDev, pageConfig } = initEnv(config);
  if (isDev) return null;

  await initBaseFile();
  await buildAPI(apiConfig);
  await buildPages(pageConfig);

  const { config: initConfig, routes } = await initHandler({
    root: process.cwd(),
    models: await loadModels(),
    backendApi: await loadApi(),
    config,
    loadModels,
  });

  if (onStart) {
    await onStart();
  }

  // Production mode
  console.log(`${c.blue}PROD${c.reset} Building frontend...`);

  const indexDir = dirname(index.index);
  let entry = "";
  let entryName = "";
  const rewriter = new HTMLRewriter().on("script", {
    element(element) {
      const src = element.getAttribute("src") || "";
      if (src) {
        entry = join(indexDir, src);

        if (src.startsWith("./")) {
          element.setAttribute(src, src.substring(1));
          entryName = src.substring(2);
          const ext = extname(entryName);
          entryName = basename(entryName, ext);
        }
        element.remove();
      }
    },
  });
  const html = rewriter.transform(await Bun.file(index.index).text());

  rimrafSync(dir.path("frontend:dist"));
  await build({
    entrypoints: [entry],
    outdir: dir.path("frontend:dist"),
    plugins: [bunPluginTailwind],
    minify: true,
    target: "browser",
    sourcemap: "linked",
    splitting: true,
    publicPath: "/",
    define: {
      "process.env.NODE_ENV": JSON.stringify("production"),
    },
  });

  const newre = new HTMLRewriter().on("head", {
    element(element) {
      dir.list("frontend:dist").forEach((file) => {
        if (file.startsWith(entryName)) {
          if (file.endsWith(".css")) {
            element.append(`<link rel="stylesheet" href="/${file}" />`, {
              html: true,
            });
          } else if (file.endsWith(".js")) {
            element.append(`<script type="module" src="/${file}"></script>`, {
              html: true,
            });
          }
        }
      });
    },
  });
  await Bun.file(dir.path("frontend:dist/index.html")).write(
    newre.transform(html)
  );

  console.log(`${c.green}PROD${c.reset} Frontend built successfully`);

  // Setup static file handlers for both public and dist directories
  const handlePublic = staticFileHandler({
    publicDir: "frontend:public",
    cache: true,
    maxAge: 86400, // 1 day cache,
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
    : initConfig?.backend?.prodPort || 3000;

  // Choose default site (first site in config if no specific default is provided)
  const defaultSiteName =
    process.env.DEFAULT_SITE || Object.keys(initConfig.sites)[0];

  const finalRoutes = {} as Record<string, any>;

  for (const [name, site] of Object.entries(config.sites)) {
    const route = routes[name];
    if (route) {
      for (const [path, handler] of Object.entries(route)) {
        if (finalRoutes[path]) {
          finalRoutes[path].sites[name] = { site, handler };
          for (const [key, value] of Object.entries(handler)) {
            finalRoutes[path][key] = async (req: any) => {
              const url = new URL(req.url);
              const sites = finalRoutes[path].sites as Record<
                string,
                { site: SiteEntry; handler: any }
              >;

              for (const [name, s] of Object.entries(sites)) {
                if (s.site.domains && s.site.domains.includes(url.hostname)) {
                  return await s.handler[req.method].bind(this)(req);
                }
              }

              for (const s of Object.values(config.sites)) {
                if (s.domains?.includes(url.hostname)) {
                  const staticResponse = await handleDist(req);
                  if (staticResponse) {
                    return staticResponse;
                  }
                }
              }

              return new Response("Domain not configured", { status: 404 });
            };
          }
        } else {
          finalRoutes[path] = {
            ...handler,
            sites: { [name]: { site, handler } },
          };
        }
      }
    }
  }

  // Define server with proper type
  const server = Bun.serve({
    port,
    routes: finalRoutes,
    websocket: {
      message: (ws, msg) => {
        const data = ws.data as any;
        if (optWs && data?.url) {
          for (const [name, wsHandler] of Object.entries(optWs)) {
            if (
              data.url.pathname.startsWith(`/ws/${name}`) &&
              wsHandler.message
            ) {
              wsHandler.message(ws as any, msg);
            }
          }
        }
      },
      open: (ws) => {
        const data = ws.data as any;
        if (optWs && data?.url) {
          for (const [name, wsHandler] of Object.entries(optWs)) {
            if (data.url.pathname.startsWith(`/ws/${name}`) && wsHandler.open) {
              wsHandler.open(ws as any);
            }
          }
        }
      },
      close: (ws, code, reason) => {
        const data = ws.data as any;
        if (optWs && data?.url) {
          for (const [name, wsHandler] of Object.entries(optWs)) {
            if (
              data.url.pathname.startsWith(`/ws/${name}`) &&
              wsHandler.close
            ) {
              wsHandler.close(ws as any, code, reason);
            }
          }
        }
      },
    },
    fetch: async (req): Promise<Response | void> => {
      const url = new URL(req.url);
      const host = req.headers.get("host") || "";

      if (optWs && url.pathname.startsWith(`/ws/`)) {
        if (server) {
          for (const [name, handler] of Object.entries(optWs)) {
            if (url.pathname.startsWith(`/ws/${name}`)) {
              if (handler.upgrade) {
                let data = handler.upgrade({ req, server });
                if (data instanceof Promise) {
                  data = await data;
                }
                if (typeof data === "object") {
                  server.upgrade(req, {
                    data: { ...data, url: new URL(url) },
                  });
                } else {
                  throw new Error(
                    " ws.upgrade have to return object to be used as data "
                  );
                }
              } else {
                server.upgrade(req, { data: { url: new URL(url) } });
              }
              return;
            }
          }
        }
      }

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

      for (const [name, site] of Object.entries(initConfig.sites)) {
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
      if (!siteName && defaultSiteName && initConfig.sites[defaultSiteName]) {
        siteName = defaultSiteName;
        siteConfig = initConfig.sites[defaultSiteName] as any;
      }

      // If we still don't have a site, return 404
      if (!siteName || !siteConfig) {
        return new Response("Domain not configured", { status: 404 });
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

  for (const [name, site] of Object.entries(initConfig.sites)) {
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
