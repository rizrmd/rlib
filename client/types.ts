export type SiteConfig = {
  sites: Record<string, { devPort: number; domains?: string[] }>;
};
