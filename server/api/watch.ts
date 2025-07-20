import { dir } from "../util/dir";
import { watch } from "fs";
import * as fs from "fs";
import * as path from "path";

export const buildAPI = async (config: {
  input_dir: string;
  export_file: string;
  frontend_out: string[];
}) => {
  const paths = {
    in: dir.path(config.input_dir),
    out: dir.path(config.export_file),
  };

  // Get all files in input directory recursively
  const files = dir
    .list(config.input_dir)
    .filter(
      (file) =>
        (file.endsWith(".tsx") || file.endsWith(".ts")) &&
        !file.endsWith(".d.ts") &&
        !file.endsWith(".test.ts")
    );

  // Generate imports and API object
  const apiImports: string[] = [];
  // Store endpoints grouped by domain (if applicable)
  const apiEndpoints: { [name: string]: [url: string, string] } = {}; // For non-domain endpoints
  const apiDomainEndpoints = new Map<
    string,
    { [name: string]: [url: string, string] }
  >(); // For domain-grouped endpoints

  for (const file of files) {
    try {
      // Skip non-TypeScript files and test files
      const relativePath = file.replace(/\.ts$/, "");
      const fullPath = file.startsWith(paths.in)
        ? file
        : path.join(paths.in, file);

        const ext = path.extname(file);

      // Read the file content to extract the URL
      let fileContent = fs.readFileSync(fullPath, "utf-8");

      // If the file is empty or only contains whitespace, populate it with the template
      if (!fileContent.trim()) {
        // Generate a URL path based on the file path
        const fileParts = file
          .substring(0, file.length - ext.length)
          .replace(/\\/g, "/")
          .split("/");
        const name = fileParts[fileParts.length - 1];
        const url = `/api/${fileParts
          .filter((e) => !e.includes("."))
          .join("/")}`;

        const apiTemplate = `import { defineAPI } from "rlib/server";

export default defineAPI({
  name: "${url.replaceAll("/", "_").substring(5)}",
  url: "${url}",
  async handler() {
    const req = this.req!;
    console.log("route: " + "${url}");
    return {};
  },
});
`;
        // Write the template to the file
        fs.writeFileSync(fullPath, apiTemplate);
        // Update the file content for further processing
        fileContent = apiTemplate;
        continue;
      }

      // Extract the URL from defineAPI({ url: "..." })
      const urlMatch = fileContent.match(/url:\s*["']([^"']+)["']/);
      const nameMatch = fileContent.match(/name:\s*["']([^"']+)["']/);
      if (!urlMatch) {
        console.warn(`Skipping ${file}: No URL found in API definition`);
        continue;
      }

      if (!nameMatch) {
        console.warn(`Skipping ${file}: No Name found in API definition`);
        continue;
      }

      const url = urlMatch[1];
      const name = nameMatch[1];

      // Check if the file path contains folders with dots (domain identifiers)
      const pathParts = relativePath.split(path.sep);
      const domainIndex = pathParts.findIndex((part) => part.includes("."));

      // Create an import name based on the directory structure
      const importName = pathParts
        .slice(Math.max(0, pathParts.length - ext.length)) // Get the last up to 3 parts
        .join("_")
        .replace(/[^\w_]/g, "_");

      // Import path should be relative to the output file directory
      const importPath = `../../../backend/src/api/${relativePath}`.replace(/\\/g, "/");

      apiImports.push(
        `import { default as ${importName} } from "${importPath}";`
      );

      // If a domain is found, group the endpoint under that domain
      if (domainIndex !== -1 && url && name) {
        // Make sure domain is definitely a string
        const domain = pathParts[domainIndex];
        if (domain) {
          // Ensure the domain object exists
          if (!apiDomainEndpoints.has(domain)) {
            apiDomainEndpoints.set(domain, {});
          }

          // Now we can safely assign to the domain's endpoints
          const domainEndpoints = apiDomainEndpoints.get(domain);
          if (domainEndpoints) {
            domainEndpoints[name] = [url, importName];
          }
        }
      } else if (url && name) {
        // Otherwise add to the regular endpoints
        apiEndpoints[name] = [url, importName];
      }
    } catch (error) {
      console.error(`Error processing file ${file}:`, error);
    }
  }

  // Generate the output file content with domain grouping
  let apiObjectEntries = "";
  let dryObjectEntries = "";

  // Add non-domain endpoints
  const regularEndpoints = Object.entries(apiEndpoints).map(
    ([name, importName]) => [
      `    "${name}": ["${importName[0]}", ${importName[1]}]`,
      `    "${name}": "${importName[0]}"`,
    ]
  );

  // Add non-domain endpoints wrapped in "_" property
  if (Object.keys(apiEndpoints).length > 0) {
    apiObjectEntries += `  "_": {\n${regularEndpoints
      .map((e) => e[0])
      .join(",\n")}\n  }`;
    dryObjectEntries += `  "_": {\n${regularEndpoints
      .map((e) => e[1])
      .join(",\n")}\n  }`;
  }

  // Add domain-grouped endpoints
  apiDomainEndpoints.forEach((endpoints, domain) => {
    // Add a comma if there are regular endpoints or other domains already added
    if (apiObjectEntries) {
      apiObjectEntries += ",\n";
      dryObjectEntries += ",\n";
    }

    const domainEndpointsStr = Object.entries(endpoints).map(
      ([name, importName]) => [
        `    "${name}": ["${importName[0]}", ${importName[1]}]`,
        `    "${name}": "${importName[0]}"`,
      ]
    );

    apiObjectEntries += `  "${domain}": {\n${domainEndpointsStr
      .map((e) => e[0])
      .join(",\n")}\n  }`;
    dryObjectEntries += `  "${domain}": {\n${domainEndpointsStr
      .map((e) => e[1])
      .join(",\n")}\n  }`;
  });

  const content = `// Auto-generated API exports
import type { ApiDefinitions } from "rlib/server";
${apiImports.join("\n")}

export const backendApi = {
${apiObjectEntries}
} as const satisfies ApiDefinitions;
`;

  const dryContent = `// Auto-generated API exports
import type { ApiUrls } from "rlib/server";

export const endpoints = {
${dryObjectEntries}
} as const satisfies ApiUrls;
`;

  // Ensure the output directory exists
  const outDir = path.dirname(paths.out);

  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  // Write the output file
  fs.writeFileSync(paths.out, content);
  fs.writeFileSync(
    paths.out.substring(0, paths.out.length - 2) + "url.ts",
    dryContent
  );

  // Process all frontend output paths from the config
  const frontendPaths = config.frontend_out || [];

  // Generate the default API client file for each frontend output path
  for (const frontendPath of frontendPaths) {
    const outfile = dir.path(frontendPath);
    const outDir = path.dirname(outfile);

    if (!fs.existsSync(outfile)) {
      const content = `// Auto-generated file - DO NOT EDIT

import { apiClient } from "rlib/client";
import type { backendApi } from "../../../../backend/src/gen/api";
import { endpoints } from "../../../../backend/src/gen/api.url";
import config from "../../../../config.json";

export const api = apiClient({} as unknown as typeof backendApi, endpoints, config, "_");`;

      dir.ensure(outDir);
      fs.writeFileSync(outfile, content);
    }
  }

  // Generate domain-specific API client files if domains exist
  if (apiDomainEndpoints.size > 0) {
    for (const domain of apiDomainEndpoints.keys()) {
      for (const frontendPath of frontendPaths) {
        // Create domain-specific file in the same directory as the main API file
        const basePath = path.dirname(frontendPath);
        const outfile = dir.path(`${basePath}/${domain}.ts`);

        if (!fs.existsSync(outfile)) {
          const content = `// Auto-generated file - DO NOT EDIT

import { apiClient } from "rlib/client";
import { backendApi } from "../../../../backend/src/gen/api";
import { endpoints } from "../../../../backend/src/gen/api.url";
import config from "../../../../config.json";

export const api = apiClient(
  backendApi,
  endpoints,
  config,
  "${domain}"
);

`;

          dir.ensure(path.dirname(outfile));
          fs.writeFileSync(outfile, content);
        }
      }
    }
  }
};

export const watchAPI = (config: Parameters<typeof buildAPI>[0]) => {
  const paths = {
    in: dir.path(config.input_dir),
    out: dir.path(config.export_file),
  };

  const timeout = { build: null as any };
  // Watch for file changes and rebuild
  watch(paths.in, { recursive: true }, (eventType, filename) => {
    if (filename && filename.endsWith(".ts") && !filename.endsWith(".d.ts")) {
      clearTimeout(timeout.build);
      timeout.build = setTimeout(() => buildAPI(config), 300);
    }
  });
};
