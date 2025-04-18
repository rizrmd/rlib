import { type BunRequest, type RouterTypes } from "bun";
import { join } from "path";
import { defineDB } from "./db/define";
import type { ModelDefinition } from "./db/types-gen";
import { dir } from "./util/dir";

export const init = async <
  T extends { [K in string]: ModelDefinition<K> }
>(opt: {
  root: string;
  models: T;
  backendApi: any;
}) => {
  dir.root = join(process.cwd());

  const g = global as any;

  let isRestarted = false;
  if (!g.db) {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        "DATABASE_URL is not set. Please set it in your environment variables."
      );
    }
    g.db = await defineDB(opt.models, process.env.DATABASE_URL!);
  } else {
    isRestarted = true;
  }

  let isDev = process.argv.includes("--dev");

  const config: {
    sites: Record<string, { port: number; domains?: string[] }>;
  } = await Bun.file(join(process.cwd(), "config.json")).json();

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
        return new Response(result.message, {
          status: 500,
          statusText: result.message,
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
      for (const [_, item] of Object.entries(opt.backendApi)) {
        if (Array.isArray(item)) {
          const [url, handler] = item as any;
          if (!url.includes(".")) {
            routes[name][url] = createHandler(handler);
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
    isRestarted,
    isDev,
    config,
    routes,
  };
};
