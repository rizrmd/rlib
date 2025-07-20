import type { SiteConfig, SiteEntry } from "../types";

// Type declaration for browser globals
declare const window: {
  location: {
    port: string;
    hostname: string;
    protocol: string;
  };
} | undefined;

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
        if (typeof window === "undefined") {
          if (mode === "dev") {
            return `http://${defaultSite?.domains?.[0]}:${
              defaultSite?.devPort || 3000
            }`;
          }
          return `https://${defaultSite?.domains?.[0]}`;
        }
        if (
          (typeof window !== "undefined" && parseInt(window.location.port) === config.backend.prodPort &&
            window.location.hostname !== "localhost") ||
          (typeof window !== "undefined" && window.location.protocol === "https:")
        ) {
          mode = "prod";
        }

        let isGithubCodespace = false;
        if (typeof window !== "undefined" && window.location.hostname.endsWith("github.dev")) {
          mode = "dev";
          isGithubCodespace = true;
        }

        let isFirebaseStudio = false;
        if (typeof window !== "undefined" && window.location.hostname.endsWith(".cloudworkstations.dev")) {
          mode = "dev";
          isFirebaseStudio = true;
        }

        if (mode === "dev") {
          const site = config.sites[p.replace(/_/g, ".")];

          if (isGithubCodespace && site) {
            const parts = window.location.hostname.split("-");

            const lastPart = parts[parts.length - 1]!.split("-");
            lastPart[0] = site.devPort + "";
            parts[parts.length - 1] = lastPart.join("-");

            return `https://${parts.join("-")}`;
          }

          if (isFirebaseStudio && site) {
            const parts = window.location.hostname.split("-");
            parts[0] = site.devPort + "";

            return `https://${parts.join("-")}`;
          }

          let devPort = site ? site.devPort : defaultSite?.devPort;
          if (!devPort) {
            devPort = typeof window !== "undefined" ? parseInt(window.location.port) : 3000;
          }

          return `http://${typeof window !== "undefined" ? window.location.hostname : 'localhost'}:${devPort}`;
        } else {
          const site = config.sites[p.replace(/_/g, ".")];

          if (site) {
            if (site.domains) {
              const tld = typeof window !== "undefined" ? window.location.hostname.split(".").pop() : undefined;

              for (const domain of site.domains) {
                if (tld && domain.endsWith(`.${tld}`)) {
                  const url = new URL(`${typeof window !== "undefined" ? window.location.protocol : 'https:'}//${domain}`);

                  if (typeof window !== "undefined" && window.location.port && !["443", "80"].includes(window.location.port)) {
                    url.port = window.location.port;
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
