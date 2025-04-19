export type ApiDefinitions = Record<
  string,
  | [
      url: string,
      { name: string; url: string; handler: (...arg: any[]) => Promise<any> }
    ]
  | Record<
      string,
      [
        url: string,
        { name: string; url: string; handler: (...arg: any[]) => Promise<any> }
      ]
    >
>;
export type ApiUrls = Record<string, string | Record<string, string>>;
