export const dbClient = (arg: { bind: any; url: string }) => {
  arg.bind.db = new Proxy(
    {},
    {
      get(target, table, receiver) {
        return new Proxy(
          {},
          {
            get(target, method, receiver) {
              return async (...args: []) => {
                const res = await fetch(arg.url, {
                  method: "POST",
                  body: JSON.stringify({ table, method, args }),
                });

                return await res.json();
              };
            },
          }
        );
      },
    }
  );
};
