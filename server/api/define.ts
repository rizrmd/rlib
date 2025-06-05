import type { BunRequest } from "bun";

export const defineAPI = <K extends string, T extends any>(opt: {
  name: string;
  url: K;
  handler: T;
  req?: BunRequest<K>;
  user?: { id: string };
}) => {
  return opt;
};

export const apiRequest = <T extends string>(context: {
  url: T;
  handler: any;
}) => {
  return (context as any).req as BunRequest<T>;
};
