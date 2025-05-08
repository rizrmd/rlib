import type { ApiDefinitions } from "../../server/api/types";
import type { SiteConfig } from "../types";
import { defineBaseUrl } from "../util/base-url";

export const apiClient = <T extends ApiDefinitions, K extends keyof T>(
  api: T,
  endpoints: any,
  config: SiteConfig,
  domain?: K
) => {
  const result = {};

  type Methods = K extends string ? T[K] : T;
  type MethodKeys = keyof Methods;

  return new Proxy(
    {},
    {
      get(target, p, receiver) {
        return async (...args: any[]) => {
          const urls = domain ? endpoints[domain] : endpoints;

          const url = urls[p];
          if (typeof url !== "string") {
            throw new Error("URL not found");
          }

          let base = defineBaseUrl(config);
          console.log(domain, base)

          const finalUrl = new URL(base[domain as string] as string);
          finalUrl.pathname = url;

          const result = await fetch(finalUrl, {
            method: "POST",
            body: JSON.stringify(args),
          });
          if (!result.ok) {
            throw new Error("Request failed");
          }
          const data = await result.json();
          return data;
        };
      },
    }
  ) as {
    [M in MethodKeys]: Methods[M] extends [...any, infer R]
      ? R extends { handler?: infer P }
        ? P
        : never
      : never;
  };
};
