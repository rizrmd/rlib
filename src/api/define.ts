export const defineAPI = <T extends (...arg: any[]) => Promise<any>>(opt: {
  url: string;
  handler: T;
}) => {
  return opt;
};
