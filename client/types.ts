export type SiteConfig = {
  backend: { prodPort: number };
  sites: Record<string, SiteEntry>;
  mobile?: { enabled?: boolean };
  db?: { skip_tables?: string[] };
};

export type SiteEntry = {
  devPort: number;
  domains?: string[];
  mobile?: {
    enabled?: boolean;
  };
  isDefault?: boolean;
};
