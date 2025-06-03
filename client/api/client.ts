import { error } from "console";
import type { ApiDefinitions } from "../../server/api/types";
import type { SiteConfig } from "../types";
import { defineBaseUrl } from "../util/base-url";

export const apiClient = <T extends ApiDefinitions, K extends keyof T>(
  api: T,
  endpoints: any,
  config: SiteConfig & { fetch?: typeof fetch },
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

          const finalUrl = new URL(base[domain as string] as string);
          finalUrl.pathname = url;

          const _fetch = config.fetch || fetch;

          const result = await fetch(finalUrl, {
            method: "POST",
            body: JSON.stringify(args),
          });

          if (!result.ok || result.status >= 300) {
            const errorText = await result.text();
            let errorData: any = {};
            try {
              errorData = JSON.parse(errorText);
            } catch (e) {
              // Ignore JSON parse error
            }

            if (errorData.__error) {
              throw new Error(errorData.__error);
            }
            // If the error is not JSON, throw the raw text
            throw new Error(errorText);
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
