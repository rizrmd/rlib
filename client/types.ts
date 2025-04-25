export type SiteConfig = {
  backend: { prodPort: number };
  sites: Record<string, SiteEntry>;
  db?: { skip_tables?: string[] };
};

export type SiteEntry = {
  devPort: number;
  domains?: string[];
  isDefault?: boolean;
};
