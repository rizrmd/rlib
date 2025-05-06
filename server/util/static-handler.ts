import { join } from "path";
import { statSync } from "fs";
import { dir } from "./dir";

/**
 * Configuration options for serving static files
 */
export interface StaticFileOptions {
  /**
   * Path to the public directory (default: "frontend:public")
   */
  publicDir?: string;

  /**
   * Custom MIME types for specific file extensions
   */
  mimeTypes?: Record<string, string>;

  /**
   * Whether to show directory listings (default: false)
   */
  showDirectoryListing?: boolean;

  /**
   * Set cache control headers (default: true)
   */
  cache?: boolean;

  /**
   * Maximum age for cache control headers in seconds (default: 86400 = 1 day)
   */
  maxAge?: number;

  /**
   * If specified, treat as SPA and serve this file when requested path is not found
   * (default: undefined - disabled)
   */
  spaIndexFile?: string;

  exclude?: string[];
}

/**
 * Default MIME types for common file extensions
 */
const defaultMimeTypes: Record<string, string> = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".txt": "text/plain",
  ".pdf": "application/pdf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".eot": "application/vnd.ms-fontobject",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
};

/**
 * Get the MIME type for a file extension
 */
function getMimeType(
  filePath: string,
  customMimeTypes?: Record<string, string>
): string {
  const ext = filePath.substring(filePath.lastIndexOf(".")).toLowerCase();
  return (
    (customMimeTypes && customMimeTypes[ext]) ||
    defaultMimeTypes[ext] ||
    "application/octet-stream"
  );
}

/**
 * Creates a handler function to serve static files
 *
 * @param options Static file serving options
 * @returns A function that handles HTTP requests for static files
 */
export function staticFileHandler(options: StaticFileOptions = {}) {
  const {
    publicDir = "frontend:public",
    mimeTypes = {},
    showDirectoryListing = false,
    cache = true,
    maxAge = 86400,
    spaIndexFile,
    exclude,
  } = options;

  const publicDirPath = dir.path(publicDir);

  return async (req: Request): Promise<Response | null> => {
    try {
      const url = new URL(req.url);
      let pathname = url.pathname;

      // Handle root path
      if (pathname === "/") {
        pathname = "/index.html";
      }

      if (exclude) {
        for (const pattern of exclude) {
          if (pathname.startsWith(pattern)) {
            return null; // Skip and let the application handle it
          }
        }
      }

      const filePath = join(publicDirPath, pathname);

      try {
        const stats = statSync(filePath);

        // Handle directory listing if enabled
        if (stats.isDirectory()) {
          if (!showDirectoryListing) {
            return null; // Skip and let the application handle it
          }

          // Implementation for directory listing would go here
          // Omitted for simplicity
          return new Response("Directory listing not implemented", {
            status: 501,
          });
        }

        // Handle file
        const file = Bun.file(filePath);
        const mimeType = getMimeType(filePath, mimeTypes);

        const headers = new Headers({
          "Content-Type": mimeType,
        });

        // Add cache control headers if enabled
        if (cache) {
          headers.set("Cache-Control", `public, max-age=${maxAge}`);
        }

        return new Response(file, {
          headers,
        });
      } catch (error) {
        // File not found or not accessible

        // If SPA mode is enabled, serve the index file
        if (spaIndexFile) {
          try {
            const spaFilePath = join(publicDirPath, spaIndexFile);
            const file = Bun.file(spaFilePath);
            const mimeType = getMimeType(spaFilePath, mimeTypes);

            const headers = new Headers({
              "Content-Type": mimeType,
            });

            if (cache) {
              headers.set("Cache-Control", `public, max-age=${maxAge}`);
            }

            return new Response(file, {
              headers,
            });
          } catch (spaError) {
            console.error("SPA index file not found:", spaError);
          }
        }

        return null; // Skip and let the application handle it
      }
    } catch (error) {
      console.error("Static file handling error:", error);
      return null; // Skip and let the application handle it
    }
  };
}
