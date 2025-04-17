import type { ModelDefinition } from "./types-gen";

// Extract column and relation information
export type ModelColumns<M, N extends keyof M> = M[N] extends ModelDefinition<string>
  ? M[N]["columns"]
  : never;
export type ModelField<M, N extends keyof M> = keyof ModelColumns<M, N>;
export type ModelRelations<M, N extends keyof M> = M[N] extends ModelDefinition<string>
  ? M[N]["relations"]
  : never;
export type RelationField<M, N extends keyof M> = keyof ModelRelations<M, N>;

// Extract actual value type from column definition
type ColumnType<T> = T extends { type: "text" }
  ? string
  : T extends { type: "number" }
  ? number
  : T extends { type: "boolean" }
  ? boolean
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

// Handle recursive selection structure
export type SelectFields<M, N extends keyof M> =
  | ModelField<M, N>
  | Partial<{
      [R in RelationField<M, N>]: SelectFields<
        M,
        RelationTargetInfo<M, N, R>
      >[];
    }>;

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

// Where condition type for a single field
export type WhereCondition<T> = {
  [K in ComparisonOperator]?: K extends "in" | "nin"
    ? T[]
    : K extends "like" | "ilike"
    ? string
    : T;
};

// Where clauses for model fields and relations
export type WhereFields<M, N extends keyof M> = {
  [F in ModelField<M, N>]?: WhereCondition<FieldValue<M, N, F>>;
} & {
  [R in RelationField<M, N>]?: WhereFields<M, RelationTargetInfo<M, N, R>>;
};

// Order by direction type
export type OrderDirection = "asc" | "desc";

// Order by clause type
export type OrderByClause<M, N extends keyof M> = {
  [F in ModelField<M, N>]?: OrderDirection;
};

// Result type based on selection
export type ModelResultType<
  M,
  N extends keyof M,
  S extends SelectFields<M, N>[] | undefined
> = S extends SelectFields<M, N>[]
  ? Array<{
      [K in S[number] as K extends ModelField<M, N> ? K : never]: K extends ModelField<M, N> 
        ? FieldValue<M, N, K> 
        : never;
    } & {
      [K in keyof S[number] as K extends RelationField<M, N> ? K : never]: K extends RelationField<M, N>
        ? ModelResultType<
            M,
            RelationTargetInfo<M, N, K>,
            S[number][K] extends SelectFields<M, RelationTargetInfo<M, N, K>>[] ? S[number][K] : undefined
          >
        : never;
    }>
  : Array<{
      [K in ModelField<M, N>]: FieldValue<M, N, K>;
    }>;

// Debug response type for when debug is set to true
export interface DebugResponse<T> {
  data: T;
  sql: string;
}

// Query options type with an explicit debug flag
export interface ModelQueryOptions<M, N extends keyof M, S extends SelectFields<M, N>[] | undefined = undefined> {
  select?: S;
  where?: WhereFields<M, N>;
  orderBy?: OrderByClause<M, N>;
  limit?: number;
  skip?: number;
  debug?: boolean; 
}

// Query options for findFirst (without limit and skip)
export interface ModelQueryFirstOptions<M, N extends keyof M, S extends SelectFields<M, N>[] | undefined = undefined> {
  select?: S;
  where?: WhereFields<M, N>;
  orderBy?: OrderByClause<M, N>;
  debug?: boolean;
}

export type ModelQueryList<M, N extends keyof M> = <
  S extends SelectFields<M, N>[] | undefined = undefined,
  Debug extends boolean = false
>(options?: ModelQueryOptions<M, N, S> & { debug?: Debug }) => Promise<
  Debug extends true
    ? DebugResponse<ModelResultType<M, N, S>>
    : ModelResultType<M, N, S>
>;

export type ModelQueryFirst<M, N extends keyof M> = <
  S extends SelectFields<M, N>[] | undefined = undefined,
  Debug extends boolean = false
>(options?: ModelQueryFirstOptions<M, N, S> & { debug?: Debug }) => Promise<
  Debug extends true
    ? { data: ModelResultType<M, N, S>[0] | null; sql: string }
    : ModelResultType<M, N, S>[0] | null
>;

export type ModelOperation<
  M extends Record<string, ModelDefinition<string>>,
  N extends keyof M
> = {
  findMany: ModelQueryList<M, N>;
  findFirst: ModelQueryFirst<M, N>;
};

export type ModelOperations<M extends Record<string, ModelDefinition<string>>> = {
  [N in keyof M]: ModelOperation<M, N>;
};
