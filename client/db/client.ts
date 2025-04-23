export const dbClient = (window: any) => {
  window.db = new Proxy(
    {},
    {
      get(target, table, receiver) {
        return new Proxy(
          {},
          {
            get(target, method, receiver) {
              return async (...args: []) => {
                console.log(table, method, args);
                return null;
              };
            },
          }
        );
      },
    }
  );
};
