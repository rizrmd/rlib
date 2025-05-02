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

        let isGithubCodespace = false;
        if (location.hostname.endsWith("github.dev")) {
          mode = "dev";
          isGithubCodespace = true;
        }

        let isFirebaseStudio = false;
        if (location.hostname.endsWith(".cloudworkstations.dev")) {
          mode = "dev";
          isFirebaseStudio = true;
        }

        if (mode === "dev") {
          const site = config.sites[p.replace(/_/g, ".")];

          if (isGithubCodespace && site) {
            const parts = location.hostname.split("-");

            const lastPart = parts[parts.length - 1]!.split("-");
            lastPart[0] = site.devPort + "";
            parts[parts.length - 1] = lastPart.join("-");

            return `https://${parts.join("-")}`;
          }

          if (isFirebaseStudio && site) {
            const parts = location.hostname.split("-");
            parts[0] = site.devPort + "";

            return `https://${parts.join("-")}`;
          }

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
