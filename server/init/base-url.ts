import { dir } from "../util/dir";

export const initBaseUrlFile = async () => {
  dir.ensure("frontend:src/lib/gen");

  await Bun.file(dir.path("frontend:src/lib/gen/base-url.ts")).write(`\
import { defineBaseUrl, type SiteConfig } from "rlib/client";
import raw_config from "../../../../config.json";

const config = raw_config satisfies SiteConfig;
export const baseUrl = defineBaseUrl(config);
`);
};
