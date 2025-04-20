export type SiteConfig = {
  sites: Record<string, SiteEntry>;
};

export type SiteEntry = { devPort: number; domains?: string[] };
