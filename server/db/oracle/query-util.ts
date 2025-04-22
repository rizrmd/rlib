// filepath: /Users/riz/Developer/rlib/server/db/oracle/query-util.ts
/**
 * Format a value for Oracle SQL insertion with proper escaping
 */
export function formatValue(value: any): string {
  if (value === null) return "NULL";
  if (typeof value === "string") return `'${value.replace(/'/g, "''")}'`; // Basic SQL escaping
  if (typeof value === "number") return value.toString();
  if (typeof value === "boolean") return value ? "1" : "0"; // Oracle uses 1/0 for boolean
  if (value instanceof Date) return `TO_TIMESTAMP('${value.toISOString()}', 'YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"')`;
  if (Array.isArray(value)) {
    // Oracle doesn't have a direct ARRAY constructor like PostgreSQL
    // For arrays, we convert to a comma-separated string inside parentheses
    return `(${value.map(formatValue).join(", ")})`;
  }
  if (typeof value === "object") {
    // For JSON objects, Oracle has JSON functions in recent versions
    return `'${JSON.stringify(value).replace(/'/g, "''")}'`;
  }
  return `'${String(value).replace(/'/g, "''")}'`;
}

/**
 * Converts a PostgreSQL-style positional parameter (?1, ?2) to Oracle style (:1, :2)
 */
export function convertPositionalParams(sql: string): string {
  return sql.replace(/\?(\d+)/g, ":$1");
}

/**
 * Handles Oracle-specific pagination syntax
 */
export function buildPaginationClause(limit?: number, offset?: number): string {
  if (!limit && !offset) return "";
  
  if (limit && offset) {
    // Oracle syntax for pagination (12c and above)
    return `OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`;
  } else if (limit) {
    // Only limit, no offset
    return `FETCH FIRST ${limit} ROWS ONLY`;
  } else if (offset) {
    // Only offset, no limit (rare)
    return `OFFSET ${offset} ROWS`;
  }
  
  return "";
}

/**
 * Convert table/column identifiers to uppercase by default as Oracle is case-sensitive
 * unless identifiers are quoted
 */
export function formatIdentifier(name: string): string {
  // Double quotes preserve case in Oracle
  return `"${name}"`;
}