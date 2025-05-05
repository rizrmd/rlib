import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";

export const html = async (jsx: ReactElement) => {
  return new Response(renderToString(jsx), {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
};
