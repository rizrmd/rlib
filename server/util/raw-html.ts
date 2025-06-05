import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";

export const html = async <T>(opt: { jsx: ReactElement; data?: T }) => {
  return new Response(renderToString(opt.jsx), {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
};
