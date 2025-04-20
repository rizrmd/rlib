import type { BunRequest, Server, ServerWebSocket } from "bun";

export const spaHandler = (opt: { index: any; port: number }) => {
  const assetServer = Bun.serve({
    static: {
      "/*": opt.index,
    },
    fetch() {
      return new Response(null, { status: 404 });
    },
    port: opt.port,
  });
  const hmr = new WeakMap<ServerWebSocket<unknown>, WebSocket>();

  return {
    server: assetServer,
    serve: (req: Request, server: Server) => {
      return fetch(
        new URL(req.url.slice(server.url.href.length), assetServer.url)
      );
    },
    ws: {
      open(ws: ServerWebSocket<unknown>) {
        if (ws.data === "hmr") {
          const sw = new WebSocket(
            `ws://localhost:${assetServer.port}/_bun/hmr`
          );
          sw.onmessage = (e) => {
            ws.send(e.data as any);
          };
          sw.onclose = () => {
            hmr.delete(ws);
          };
          hmr.set(ws, sw as any);
          return true;
        }
      },
      message(ws: ServerWebSocket<unknown>, msg: any) {
        if (ws.data === "hmr") {
          const sw = hmr.get(ws);
          if (sw) {
            sw.send(msg);
          }
          return true;
        }
      },
      close(ws: ServerWebSocket<unknown>) {
        if (ws.data === "hmr") {
          hmr.delete(ws);
          return true;
        }
      },
    },
  };
};
