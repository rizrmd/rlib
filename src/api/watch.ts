import { dir } from "../util/dir";
import { watch } from "fs";
import * as fs from "fs";
import * as path from "path";

export const watchAPI = (config: { input_dir: string; out_file: string }) => {
  const paths = {
    in: dir.path(config.input_dir),
    out: dir.path(config.out_file),
  };

  const build = async () => {
    // Get all files in input directory recursively
    const files = dir
      .list(config.input_dir)
      .filter(
        (file) =>
          file.endsWith(".ts") &&
          !file.endsWith(".d.ts") &&
          !file.endsWith(".test.ts")
      );

    // Generate imports and API object
    const apiImports: string[] = [];
    const apiEndpoints: { [key: string]: string } = {};

    for (const file of files) {
      try {
        // Skip non-TypeScript files and test files
        const relativePath = file.replace(/\.ts$/, "");
        const fullPath = path.join(paths.in, file);

        // Read the file content to extract the URL
        let fileContent = fs.readFileSync(fullPath, "utf-8");

        // If the file is empty or only contains whitespace, populate it with the template
        if (!fileContent.trim()) {
          // Generate a URL path based on the file path
          const urlPath = relativePath.replace(/\\/g, "/");
          const apiTemplate = `import { defineAPI } from "rlib";

export default defineAPI({
  url: "/api/hello/world",
  handler: async () => {
    console.log("hello-world");
    return {};
  },
});
`;
          // Write the template to the file
          fs.writeFileSync(fullPath, apiTemplate);
          console.log(`Populated empty file with template: ${file}`);
          // Update the file content for further processing
          fileContent = apiTemplate;
        }

        // Extract the URL from defineAPI({ url: "..." })
        const urlMatch = fileContent.match(/url:\s*["']([^"']+)["']/);
        if (!urlMatch) {
          console.warn(`Skipping ${file}: No URL found in API definition`);
          continue;
        }

        const url = urlMatch[1];

        // Create an import name based on the directory structure
        // For example, "backend/api/auth.esensi/login" -> "auth_esensi_login"
        const pathParts = relativePath.split("/");
        const importName = pathParts
          .slice(Math.max(0, pathParts.length - 3)) // Get the last up to 3 parts
          .join("_")
          .replace(/[^\w_]/g, "_");

        // Import path should be relative to the output file directory
        const importPath = path
          .relative(path.dirname(paths.out), path.join(paths.in, relativePath))
          .replace(/\\/g, "/");

        apiImports.push(
          `import { default as ${importName} } from "${importPath}";`
        );
        if (url) apiEndpoints[url] = importName;
      } catch (error) {
        console.error(`Error processing file ${file}:`, error);
      }
    }

    // Generate the output file content
    const apiObjectEntries = Object.entries(apiEndpoints)
      .map(([url, importName]) => `  "${url}": ${importName}`)
      .join(",\n");

    const content = `// Auto-generated API exports
${apiImports.join("\n")}

export const api = {
${apiObjectEntries}
};
`;

    // Ensure the output directory exists
    const outDir = path.dirname(paths.out);
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    // Write the output file
    fs.writeFileSync(paths.out, content);
  };

  // Run the build once at start
  build();

  const timeout = { build: null as any };
  // Watch for file changes and rebuild
  watch(paths.in, { recursive: true }, (eventType, filename) => {
    if (filename && filename.endsWith(".ts") && !filename.endsWith(".d.ts")) {
      clearTimeout(timeout.build);
      timeout.build = setTimeout(build, 300);
    }
  });
};
