export type SiteConfig = {
  backend: {orm: "rlib" | "prisma", prodPort: number}
  sites: Record<string, SiteEntry>;
};

export type SiteEntry = { devPort: number; domains?: string[] };
