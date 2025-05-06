import { $, type BunRequest, type RouterTypes, type Server } from "bun";
import { join } from "path";
import type { SiteConfig } from "../../client";
import type { ModelDefinition } from "../db/types-gen";
import { dir } from "../util/dir";

export type onFetch<T extends object = {}> = (
  arg: {
    url: URL;
    req: Request;
    server: Server;
  } & Partial<T>
) => Promise<Response | void> | Response | void;

export const initHandler = async <
  T extends { [K in string]: ModelDefinition<K> }
>(opt: {
  root: string;
  models: T;
  backendApi: any;
  config?: SiteConfig;
  loadModels: () => Promise<any>;
}) => {
  dir.root = join(process.cwd());

  const g = global as any;

  if (!g.db) {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        "DATABASE_URL is not set. Please set it in your environment variables."
      );
    }
    g.db = await opt.loadModels();
  }

  const config: SiteConfig = await Bun.file(
    join(process.cwd(), "config.json")
  ).json();

  const routes = {} as Record<
    string,
    { [K in string]: RouterTypes.RouteValue<Extract<K, string>> }
  >;

  const createHandler = (handler: any) => {
    const fn = async (req: BunRequest) => {
      const ctx = { ...(handler as any), req } as {
        url: string;
        handler: () => any;
      };

      let result = null;
      try {
        if (req.method === "POST") {
          const params = await req.json();
          if (Array.isArray(params)) {
            result = await (ctx.handler as any)(...params);
          } else {
            result = await (ctx.handler as any)(params);
          }
        } else {
          result = await ctx.handler();
        }

        if (result instanceof Response) {
          return result;
        } else if (result instanceof Error) {
          return new Response(JSON.stringify({ __error: e.message }), {
            status: 500,
            statusText: result.message,
            headers: {
              "Content-Type": "application/json",
            },
          });
        }
      } catch (e:any) {
        return new Response(JSON.stringify({ __error: e.message }), {
          status: 500,
          statusText: result.message,
          headers: {
            "Content-Type": "application/json",
          },
        });
      }

      return new Response(JSON.stringify(result), {
        status: 200,
        statusText: "OK",
        headers: {
          "Content-Type": "application/json",
        },
      });
    };

    return { GET: fn, POST: fn, PUT: fn, DELETE: fn, OPTIONS: fn };
  };

  for (const [name] of Object.entries(config.sites)) {
    routes[name] = {};
    try {
      if (opt.backendApi._) {
        for (const [_, item] of Object.entries(opt.backendApi._)) {
          if (Array.isArray(item)) {
            const [url, handler] = item as any;
            if (!url.includes(".")) {
              routes[name][url] = createHandler(handler);
            }
          }
        }
      }

      for (const [url, value] of Object.entries(opt.backendApi)) {
        if (url.includes(".")) {
          if (name === url) {
            for (const [_, item] of Object.entries(value as any)) {
              const [route, handler] = item as any;
              routes[name][route] = createHandler(handler);
            }
          }
        }
      }
    } catch (e) {
      console.error(e);
    }
  }

  return {
    config,
    routes,
  };
};
