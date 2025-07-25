import { join } from "path";
import { statSync } from "fs";
import { dir } from "./dir";

/**
 * Generate ETag for static files based on file stats (size and modification time)
 */
function generateStaticETag(stats: ReturnType<typeof statSync>): string {
  const mtime = stats?.mtime.getTime().toString(16);
  const size = stats?.size.toString(16);
  return `"${size}-${mtime}"`;
}

/**
 * Generate ETag for dynamic content based on content hash
 */
async function generateContentETag(content: string | ArrayBuffer): string {
  const encoder = new TextEncoder();
  const data = typeof content === 'string' ? encoder.encode(content) : new Uint8Array(content);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 16);
  return `"${hashHex}"`;
}

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

        let etag: string;
        
        // For HTML files, generate ETag based on content hash (since they might be generated)
        // For other files, use file stats for better performance
        if (mimeType === "text/html") {
          const content = await file.text();
          etag = await generateContentETag(content);
        } else {
          etag = generateStaticETag(stats);
        }

        // Check if client has matching ETag (conditional request)
        const ifNoneMatch = req.headers.get("If-None-Match");
        if (ifNoneMatch && ifNoneMatch === etag) {
          // Client has current version, return 304 Not Modified
          const cacheControl = cache 
            ? (mimeType === "text/html" 
                ? "no-cache" 
                : (mimeType === "text/javascript" || mimeType === "text/css")
                  ? "public, max-age=0, must-revalidate"
                  : `public, max-age=${maxAge}`)
            : "no-cache";
          
          const headers: Record<string, string> = {
            "ETag": etag,
            "Cache-Control": cacheControl,
          };
          
          if (mimeType === "text/javascript" || mimeType === "text/css") {
            headers["Vary"] = "Accept-Encoding";
          }
          
          return new Response(null, {
            status: 304,
            headers,
          });
        }

        const headers = new Headers({
          "Content-Type": mimeType,
          "ETag": etag,
        });

        // Add cache control headers if enabled
        if (cache) {
          if (mimeType === "text/html") {
            // HTML files should not be cached aggressively but can use ETag validation
            headers.set("Cache-Control", "no-cache");
          } else if (mimeType === "text/javascript" || mimeType === "text/css") {
            // JavaScript and CSS files should use ETag validation with Cloudflare-friendly headers
            headers.set("Cache-Control", "public, max-age=0, must-revalidate");
            headers.set("Vary", "Accept-Encoding");
          } else {
            // Other static assets can be cached normally
            headers.set("Cache-Control", `public, max-age=${maxAge}`);
          }
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
            const spaStats = statSync(spaFilePath);
            const file = Bun.file(spaFilePath);
            const mimeType = getMimeType(spaFilePath, mimeTypes);

            let spaEtag: string;
            
            // For HTML files, generate ETag based on content hash
            // For other files, use file stats for better performance
            if (mimeType === "text/html") {
              const content = await file.text();
              spaEtag = await generateContentETag(content);
            } else {
              spaEtag = generateStaticETag(spaStats);
            }

            // Check if client has matching ETag for SPA file
            const ifNoneMatch = req.headers.get("If-None-Match");
            if (ifNoneMatch && ifNoneMatch === spaEtag) {
              const cacheControl = cache 
                ? (mimeType === "text/html" 
                    ? "no-cache" 
                    : (mimeType === "text/javascript" || mimeType === "text/css")
                      ? "public, max-age=0, must-revalidate"
                      : `public, max-age=${maxAge}`)
                : "no-cache";
              
              const headers: Record<string, string> = {
                "ETag": spaEtag,
                "Cache-Control": cacheControl,
              };
              
              if (mimeType === "text/javascript" || mimeType === "text/css") {
                headers["Vary"] = "Accept-Encoding";
              }
              
              return new Response(null, {
                status: 304,
                headers,
              });
            }

            const headers = new Headers({
              "Content-Type": mimeType,
              "ETag": spaEtag,
            });

            if (cache) {
              if (mimeType === "text/html") {
                // HTML files should not be cached aggressively but can use ETag validation
                headers.set("Cache-Control", "no-cache");
              } else if (mimeType === "text/javascript" || mimeType === "text/css") {
                // JavaScript and CSS files should use ETag validation with Cloudflare-friendly headers
                headers.set("Cache-Control", "public, max-age=0, must-revalidate");
                headers.set("Vary", "Accept-Encoding");
              } else {
                // Other static assets can be cached normally
                headers.set("Cache-Control", `public, max-age=${maxAge}`);
              }
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
