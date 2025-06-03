import type { SiteConfig, SiteEntry } from "../types";
export const defineBaseUrl = <T extends SiteConfig>(config: T) => {
  let defaultSite: SiteEntry | null = null;
  let defaultSiteName = "";

  if (config.sites) {
    for (const siteName in config.sites) {
      const site = config.sites[siteName];
      if (site) {
        if (site.isDefault || (site as any).default) {
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
        if (typeof location === "undefined") {
          console.log(
            parseInt(defaultSite?.domains?.[0]!.split(".")[0] || ""),
            `http://${defaultSite?.domains?.[0]}`
          );
          if (parseInt(defaultSite?.domains?.[0]!.split(".")[0] || "")) {
            return `http://${defaultSite?.domains?.[0]}`;
          } else {
            return `https://${defaultSite?.domains?.[0]}`;
          }
        }
        if (
          (parseInt(location.port) === config.backend.prodPort &&
            location.hostname !== "localhost") ||
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

          let devPort = site ? site.devPort : defaultSite?.devPort;
          if (!devPort) {
            devPort = parseInt(location.port);
          }

          return `http://${location.hostname}:${devPort}`;
        } else {
          const site = config.sites[p.replace(/_/g, ".")];

          if (site) {
            if (site.domains) {
              const tld = location.hostname.split(".").pop();

              for (const domain of site.domains) {
                if (domain.endsWith(`.${tld}`)) {
                  const url = new URL(`${location.protocol}//${domain}`);

                  if (location.port && !["443", "80"].includes(location.port)) {
                    url.port = location.port;
                  }

                  const finalUrl = url.toString();
                  return finalUrl.substring(0, finalUrl.length - 1);
                }
              }
              return `https://${site.domains?.[0]}`;
            }
          }
          return `https://${defaultSite?.domains?.[0]}`;
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
