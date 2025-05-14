import { $, type BunRequest, type RouterTypes, type Server } from "bun";
import { join } from "path";
import type { SiteConfig } from "../../client";
import type { ModelDefinition } from "../db/types-gen";
import { dir } from "../util/dir";
import { c } from "../../server";
import { isValidElement } from "react";
import { renderToString } from "react-dom/server";

export type onFetch<T extends object = {}> = (
  arg: {
    url: URL;
    req: Request;
    server: Server;
  } & Partial<T>,
) => Promise<Response | void> | Response | void;

export const initHandler = async <
  T extends { [K in string]: ModelDefinition<K> },
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
        "DATABASE_URL is not set. Please set it in your environment variables.",
      );
    }
    g.db = await opt.loadModels();
  }

  const config: SiteConfig = await Bun.file(
    join(process.cwd(), "config.json"),
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

      let headers = {} as Record<string, string>;
      if (req.headers.get("Sec-Fetch-Mode") === "cors") {
        headers = {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "*",
        };
      }

      let result = null;
      try {
        if (req.method === "POST") {
          if (req.headers.get("content-type")?.includes("multipart")) {
            result = await (ctx.handler as any)();
          } else {
            const params = await req.json();
            if (Array.isArray(params)) {
              result = await (ctx.handler as any)(...params);
            } else {
              result = await (ctx.handler as any)(params);
            }
          }
        } else {
          result = await ctx.handler();
        }

        if (typeof result === "object" && result.jsx) {
          if (req.method === "POST") {
            result = result.data;
          } else if (req.method === "GET") {
            if (isValidElement(result.jsx)) {
              return new Response(renderToString(result.jsx), {
                headers: {
                  "Content-Type": "text/html",
                  ...headers,
                },
              });
            }
          }
        }

        if (result instanceof Response) {
          if (Object.keys(headers).length > 0) {
            for (const [key, value] of Object.entries(headers)) {
              result.headers.set(key, value);
            }
          }
          return result;
        } else if (result instanceof Error) {
          return new Response(JSON.stringify({ __error: result.message }), {
            status: 500,
            statusText: result.message,
            headers: {
              "Content-Type": "application/json",
              ...headers,
            },
          });
        }
      } catch (e: any) {
        console.log(`${c.red}[ERROR]${c.reset} ${c.cyan}${req.url}${c.reset}`);
        console.error(e);
        return new Response(JSON.stringify({ __error: e.message }), {
          status: 500,
          statusText: e.message,
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
          ...headers,
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

              // Check if the route has parameters
              if (url.includes(":")) {
                // Generate all possible route variations with optional parameters
                const routeSegments = url.split("/").filter(Boolean);
                const generatedRoutes = generateRouteVariations(routeSegments);

                // Add each generated route to the routes collection
                for (const route of generatedRoutes) {
                  routes[name][route] = createHandler(handler);
                }
              }
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

              // Check if the route has parameters
              if (route.includes(":")) {
                // Generate all possible route variations with optional parameters
                const routeSegments = route.split("/").filter(Boolean);
                const generatedRoutes = generateRouteVariations(routeSegments);

                // Add each generated route to the routes collection
                for (const route of generatedRoutes) {
                  routes[name][route] = createHandler(handler);
                }
              }
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

/**
 * Generates all possible route variations with optional parameters
 * @param segments Array of route segments
 * @returns Array of route variations
 */
function generateRouteVariations(segments: string[]): string[] {
  const routes: string[] = [];

  // Keep track of parameter positions
  const paramPositions: number[] = [];
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (segment && segment.startsWith(":")) {
      paramPositions.push(i);
    }
  }

  // Generate all possible combinations of removing parameters
  for (let i = 1; i <= paramPositions.length; i++) {
    // Get all combinations of size i from paramPositions
    const combinations = getCombinations(paramPositions, i);

    for (const combination of combinations) {
      // Create a copy of segments to modify
      const modifiedSegments = [...segments];

      // Remove parameters at the positions in the combination
      // We need to remove from right to left to avoid index shifting
      combination.sort((a, b) => b - a); // Sort in descending order

      for (const pos of combination) {
        modifiedSegments.splice(pos, 1);
      }

      // Generate the route string
      let route = "/" + modifiedSegments.join("/");
      if (route !== "/") {
        routes.push(route);
        routes.push(route + "/"); // Also add version with trailing slash
      }
    }
  }

  return [...new Set(routes)]; // Remove duplicates
}

/**
 * Get all combinations of size r from array arr
 * @param arr Array to generate combinations from
 * @param r Size of each combination
 * @returns Array of combinations
 */
function getCombinations(arr: number[], r: number): number[][] {
  const result: number[][] = [];

  function combine(start: number, current: number[]) {
    if (current.length === r) {
      result.push([...current]);
      return;
    }

    for (let i = start; i < arr.length; i++) {
      const item = arr[i];
      if (item !== undefined) {
        current.push(item);
        combine(i + 1, current);
        current.pop();
      }
    }
  }

  combine(0, []);
  return result;
}
