/**
 * Database model type definitions
 * These types define the structure of database models
 */

// Type of model name
export type ModelName = string;

// Column definition with type
export interface ColumnDefinition {
  type: "text" | "number" | "boolean" | "date" | "datetime" | "time" | "json";
}

// Relation definition with target model
export interface RelationDefinition {
  type: "has_many" | "belongs_to" | "has_one";
  from: string;
  to: {
    model: ModelName;
    column: string;
  };
}

// Model definition with table name, columns and relations
export interface ModelDefinition<T extends ModelName = ModelName> {
  table: T;
  columns: Record<string, ColumnDefinition>;
  relations: Record<string, RelationDefinition>;
}
