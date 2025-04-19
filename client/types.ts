export type SiteConfig = {
  sites: Record<string, { port: number; domains?: string[] }>;
};
