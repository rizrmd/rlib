import type { SiteConfig } from "../types";
export const defineBaseUrl = <T extends SiteConfig>(config: T) => {
  let defaultSite = null;
  let defaultSiteName = "";

  if (config.sites) {
    for (const siteName in config.sites) {
      const site = config.sites[siteName];
      if (site) {
        if (site.isDefault) {
          defaultSite = site;
          defaultSiteName = siteName;
        }
      }
    }
  }

  return new Proxy(
    {},
    {
      get(target, p: keyof typeof config.sites, receiver) {
        let mode = "dev";
        if (
          parseInt(location.port) === config.backend.prodPort ||
          location.protocol === "https:"
        ) {
          mode = "prod";
        }

        if (mode === "dev") {
          const site = config.sites[p.replace(/_/g, ".")];
          if (site) {
            return `http://${location.hostname}:${site.devPort}`;
          } else {
            return `http://${location.hostname}:${defaultSite?.devPort}`;
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
