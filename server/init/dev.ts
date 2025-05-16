import type { HTMLBundle, Server, WebSocketHandler } from "bun";
import { padEnd } from "lodash";
import { c } from "../../server";
import { buildAPI, watchAPI } from "../api/watch";
import { buildPages, watchPage } from "../page/watch";
import { spaHandler } from "../util/spa-handler";
import { staticFileHandler } from "../util/static-handler";
import { initEnv } from "./env";
import { initHandler, type onFetch } from "./handler";
import { initBaseFile } from "./base-file";
import type { SiteConfig } from "../../client";

export const initDev = async ({
  index,
  loadApi,
  loadModels,
  onFetch,
  config,
  ws: optWs,
  onStart
}: {
  index: HTMLBundle;
  loadModels: () => Promise<any>;
  loadApi: () => Promise<any>;
  onFetch?: onFetch<{
    name: string;
    servers: Record<string, Server>;
  }>;
  ws?: Record<
    string,
    WebSocketHandler<object> & {
      upgrade?: (opt: {
        req: Request;
        server: Server;
      }) => object | Promise<object>;
    }
  >;
  config?: SiteConfig;
  onStart?: () => Promise<void>;
}) => {
  const { apiConfig, isDev, isLiveReload, pageConfig } = initEnv(config);

  if (isDev) {
    if (!isLiveReload) {
      if (onStart) {
        await onStart();
      }

      await initBaseFile();
      await buildAPI(apiConfig);
      await buildPages(pageConfig);
    }

    const { config, routes } = await initHandler({
      root: process.cwd(),
      models: await loadModels(),
      backendApi: await loadApi(),
      loadModels,
    });

    const servers = {} as Record<string, Server>;
    const spa = spaHandler({ index, port: 45622 }); //Single Page App Handler
    const handleStatic = staticFileHandler({
      publicDir: "frontend:public",
      cache: isDev ? false : true, // Disable cache in development
      maxAge: isDev ? 0 : 86400, // 1 day cache in production
    });

    for (const [name, site] of Object.entries(config.sites)) {
      servers[name] = Bun.serve({
        port: site.devPort,
        routes: routes[name],
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

            if (spa.ws.message(ws, msg)) return;
          },
          open: (ws) => {
            const data = ws.data as any;
            if (optWs && data?.url) {
              for (const [name, wsHandler] of Object.entries(optWs)) {
                if (
                  data.url.pathname.startsWith(`/ws/${name}`) &&
                  wsHandler.open
                ) {
                  wsHandler.open(ws as any);
                }
              }
            }

            if (spa.ws.open(ws)) return;
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

            if (spa.ws.close(ws)) return;
          },
        },
        fetch: async (req) => {
          const url = new URL(req.url);

          if (optWs && url.pathname.startsWith(`/ws/`)) {
            const server = servers[name];
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
              server: servers[name]!,
              name,
              servers,
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

          if (url.pathname.startsWith("/_bun/hmr")) {
            servers[name]!.upgrade(req, { data: "hmr" });
            return;
          }
          const staticResponse = await handleStatic(req);
          if (staticResponse) {
            return staticResponse;
          }

          return spa.serve(req, servers[name]!);
        },
      });
    }

    if (!isLiveReload) {
      console.log(`${c.green}DEV${c.reset} Servers started:`);
      for (const [name, site] of Object.entries(config.sites)) {
        console.log(
          `- ${padEnd(name + " ", 20, "─")} ${c.magenta}http://localhost:${
            site.devPort
          }${c.reset}`
        );
      }

      watchAPI(apiConfig);
      watchPage(pageConfig);
    }
  }
};
