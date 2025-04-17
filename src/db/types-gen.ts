// Auto-generated from model.json
type ColumnType = "number" | "text" | "boolean" | "date" | "datetime";

interface ColumnDefinition {
  type: ColumnType;
  primary?: boolean;
}

interface RelationDefinition<ModelName> {
  type: "has_many" | "belongs_to" | "has_one";
  from: string;
  to: {
    model: ModelName;
    column: string;
  };
}

export interface ModelDefinition<ModelName extends string> {
  table: string;
  columns: Record<string, ColumnDefinition>;
  relations?: Record<string, RelationDefinition<ModelName>>;
}
