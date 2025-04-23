import type { ModelDefinition } from "./types-gen";

// Extract column and relation information
export type ModelColumns<
  M,
  N extends keyof M
> = M[N] extends ModelDefinition<string> ? M[N]["columns"] : never;
export type ModelField<M, N extends keyof M> = keyof ModelColumns<M, N>;
export type ModelRelations<
  M,
  N extends keyof M
> = M[N] extends ModelDefinition<string> ? M[N]["relations"] : never;
export type RelationField<M, N extends keyof M> = keyof ModelRelations<M, N>;

// Extract actual value type from column definition
type ColumnType<T> = T extends { type: "text" }
  ? string
  : T extends { type: "number" }
  ? number
  : T extends { type: "boolean" }
  ? boolean
  : T extends { type: "datetime" }
  ? Date
  : T extends { type: "date" }
  ? Date
  : T extends { type: "time" }
  ? string
  : T extends { type: "json" }
  ? Record<string, any>
  : never;

// Get the value type for a specific model field
export type FieldValue<
  M,
  N extends keyof M,
  F extends ModelField<M, N>
> = ColumnType<ModelColumns<M, N>[F]>;

// Extract target model from relation
export type RelationTargetInfo<
  M,
  N extends keyof M,
  R extends RelationField<M, N>
> = ModelRelations<M, N>[R] extends { to: { model: infer T } }
  ? T extends keyof M
    ? T
    : never
  : never;

// Handle recursive selection structure with strict validation
export type SelectFields<M, N extends keyof M> = {
  [F in ModelField<M, N>]?: true;
} & {
  [R in RelationField<M, N>]?:
    | SelectFields<M, RelationTargetInfo<M, N, R>>
    | true
    | Record<string, any>; // Allow any record for flexibility
};

// Define comparison operators for where clauses
export type ComparisonOperator =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "like"
  | "ilike"
  | "in"
  | "nin";

// String operators for convenience
export type StringOperator = "contains" | "startsWith" | "endsWith";

// Where condition type for a single field
export type WhereCondition<T> = {
  [K in ComparisonOperator]?: K extends "in" | "nin"
    ? T[]
    : K extends "like" | "ilike"
    ? string
    : T | null;
} & (T extends string
  ? {
      [K in StringOperator]?: string;
    }
  : {});

// Where clauses for model fields and relations
export type WhereFields<M, N extends keyof M> = {
  [F in ModelField<M, N>]?:
    | WhereCondition<FieldValue<M, N, F>>
    | FieldValue<M, N, F>
    | null;
} & {
  [R in RelationField<M, N>]?: WhereFields<M, RelationTargetInfo<M, N, R>>;
} & {
  AND?: WhereFields<M, N>[];
  OR?: WhereFields<M, N>[];
  NOT?: WhereFields<M, N>;
};

// Order by direction type
export type OrderDirection = "asc" | "desc";

// Order by clause type
export type OrderByClause<M, N extends keyof M> = {
  [F in ModelField<M, N>]?: OrderDirection;
};

// Define a helper type to extract relation result types based on selection
export type ExtractRelationResultType<
  M,
  N extends keyof M, 
  R extends RelationField<M, N>,
  S
> = S extends true
  ? { 
      [K in ModelField<M, RelationTargetInfo<M, N, R>>]: FieldValue<
        M, 
        RelationTargetInfo<M, N, R>,
        K
      > 
    }[]
  : S extends Record<string, any>
  ? { 
      [K in keyof S as S[K] extends true ? K : never]: 
        K extends ModelField<M, RelationTargetInfo<M, N, R>>
          ? FieldValue<M, RelationTargetInfo<M, N, R>, K & ModelField<M, RelationTargetInfo<M, N, R>>>
          : never
    }[]
  : never;

// Result type based on selection
export type ModelResultType<
  M,
  N extends keyof M,
  S extends SelectFields<M, N> | undefined
> = S extends SelectFields<M, N>
  ? {
      [K in ModelField<M, N> as K extends keyof S
        ? S[K] extends true
          ? K
          : never
        : never]-?: FieldValue<M, N, K>; // Notice the -? modifier to make fields non-optional
    } & {
      [K in RelationField<M, N> as K extends keyof S
        ? K
        : never]-?: K extends keyof S
        ? ExtractRelationResultType<M, N, K & RelationField<M, N>, S[K]>
        : never;
    }
  : {
      [K in ModelField<M, N>]-?: FieldValue<M, N, K>; // Non-optional by default
    };

// Debug response type for when debug is set to true
export interface DebugResponse<T> {
  data: T;
  sql: string;
}

// Query options type with an explicit debug flag
export type ModelQueryListOptions<
  M,
  N extends keyof M,
  S extends SelectFields<M, N> | undefined = undefined
> = S extends undefined
  ? {
      where?: WhereFields<M, N>;
      orderBy?: OrderByClause<M, N>;
      limit?: number;
      skip?: number;
      debug?: boolean;
    }
  : {
      select: S;
      where?: WhereFields<M, N>;
      orderBy?: OrderByClause<M, N>;
      limit?: number;
      skip?: number;
      debug?: boolean;
    };

// Query options for findFirst (without limit and skip)
export type ModelQueryFirstOptions<
  M,
  N extends keyof M,
  S extends SelectFields<M, N> | undefined = undefined
> = S extends undefined
  ? {
      where?: WhereFields<M, N>;
      orderBy?: OrderByClause<M, N>;
      debug?: boolean;
    }
  : {
      select?: S;
      where?: WhereFields<M, N>;
      orderBy?: OrderByClause<M, N>;
      debug?: boolean;
    };

// Types for relation operations in create and update
export type RelationCreateItem<
  M,
  N extends keyof M,
  R extends RelationField<M, N>
> = {
  [F in ModelField<M, RelationTargetInfo<M, N, R>>]?: FieldValue<
    M,
    RelationTargetInfo<M, N, R>,
    F
  >;
};

export type RelationUpdateItem<
  M,
  N extends keyof M,
  R extends RelationField<M, N>
> = {
  [F in ModelField<M, RelationTargetInfo<M, N, R>>]?: FieldValue<
    M,
    RelationTargetInfo<M, N, R>,
    F
  >;
};

export type RelationDeleteItem<M, N extends keyof M> = {
  _delete: true;
};

// Union type for relation items in operations
export type RelationItem<M, N extends keyof M, R extends RelationField<M, N>> =
  | RelationCreateItem<M, N, R>
  | RelationUpdateItem<M, N, R>
  | RelationDeleteItem<M, N>;

// Relation value can be a single item or array depending on relation type
export type RelationValue<
  M,
  N extends keyof M,
  R extends RelationField<M, N>
> = ModelRelations<M, N>[R] extends { type: "has_many" }
  ? RelationItem<M, N, R>[]
  : RelationItem<M, N, R> | null;

// Types for create operation
export type ModelCreateOptions<
  M,
  N extends keyof M,
  Debug extends boolean = false
> = {
  data: {
    [F in ModelField<M, N>]?: FieldValue<M, N, F>;
  } & {
    [R in RelationField<M, N>]?: RelationValue<M, N, R>;
  };
  debug?: Debug;
};

// Types for update operation
export type ModelUpdateOptions<
  M,
  N extends keyof M,
  Debug extends boolean = false
> = {
  data: {
    [F in ModelField<M, N>]?: FieldValue<M, N, F>;
  } & {
    [R in RelationField<M, N>]?: RelationValue<M, N, R>;
  };
  where?: WhereFields<M, N>;
  debug?: Debug;
};

export type ModelQueryList<M, N extends keyof M> = <
  S extends SelectFields<M, N> | undefined = undefined,
  Debug extends boolean = false
>(
  options?: ModelQueryListOptions<M, N, S> & { debug?: Debug }
) => Promise<
  Debug extends true
    ? DebugResponse<ModelResultType<M, N, S>[]>
    : ModelResultType<M, N, S>[]
>;

// Define a more specific ModelQueryFirst type to ensure selected fields are non-undefined when the result exists
export type ModelQueryFirst<M, N extends keyof M> = <
  S extends SelectFields<M, N>,
  Debug extends boolean = false
>(
  options?: ModelQueryFirstOptions<M, N, S> & { debug?: Debug }
) => Promise<
  Debug extends true
    ? { data: ModelResultType<M, N, S> | null; sql: string }
    : ModelResultType<M, N, S> | null
>;

export type ModelCreate<M, N extends keyof M> = <Debug extends boolean = false>(
  options: ModelCreateOptions<M, N, Debug>
) => Promise<
  Debug extends true
    ? { data: any; sql: string } | { data: null; error: string }
    : any
>;

export type ModelUpdate<M, N extends keyof M> = <Debug extends boolean = false>(
  options: ModelUpdateOptions<M, N, Debug>
) => Promise<
  Debug extends true
    ? { data: any; sql: string } | { data: null; error: string }
    : any
>;

export type ModelOperation<
  M extends Record<string, ModelDefinition<string>>,
  N extends keyof M
> = {
  findMany: ModelQueryList<M, N>;
  findFirst: ModelQueryFirst<M, N>;
  create: ModelCreate<M, N>;
  update: ModelUpdate<M, N>;
};

export type ModelOperations<M extends Record<string, ModelDefinition<string>>> =
  {
    [N in keyof M]: ModelOperation<M, N>;
  };
