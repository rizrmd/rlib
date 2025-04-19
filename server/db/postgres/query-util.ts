/**
 * Format a value for SQL insertion with proper escaping
 */
export function formatValue(value: any): string {
  if (value === null) return "NULL";
  if (typeof value === "string") return `'${value.replace(/'/g, "''")}'`; // Basic SQL escaping
  if (typeof value === "number") return value.toString();
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (value instanceof Date) return `'${value.toISOString()}'`;
  if (Array.isArray(value))
    return `ARRAY[${value.map(formatValue).join(", ")}]`;
  if (typeof value === "object")
    return `'${JSON.stringify(value).replace(/'/g, "''")}'`;
  return `'${String(value).replace(/'/g, "''")}'`;
}