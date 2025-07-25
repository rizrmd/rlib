import type { SiteConfig } from "../../client";

export const defineBaseUrl = <T extends SiteConfig>(config: T) => {
  let defaultSite: T["sites"][keyof T["sites"]] | null = null;
  let defaultSiteName = "";

  if (config.sites) {
    for (const siteName in config.sites) {
      const site = config.sites[siteName];
      if (site) {
        if (site.isDefault) {
          defaultSite = site as T["sites"][keyof T["sites"]];
          defaultSiteName = siteName;
        }
      }
    }
  }

  let mode = process.argv.includes("--dev") ? "dev" : "prod";

  return new Proxy(
    {},
    {
      get(target, p: keyof typeof config.sites, receiver) {
        if (mode === "dev") {
          const site = config.sites[p.replace(/_/g, ".")];
          if (site) {
            return `http://localhost:${site.devPort}`;
          } else {
            return `http://localhost:${defaultSite?.devPort}`;
          }
        } else {
          const site = config.sites[p];
          if (site) {
            return `https://${site.domains?.[0]}`;
          } else {
            return `https://${defaultSite?.domains?.[0]}`;
          }
        }

        return "";
      },
    }
  ) as unknown as {
    [K in keyof T["sites"] as K extends string
      ? K extends `${infer A}.${infer B}`
        ? `${A}_${B}`
        : K
      : K]: string;
  } & { default: string };
};
