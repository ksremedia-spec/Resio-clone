/** First row of a query that always returns exactly one row (aggregates). */
export function one<T>(rows: T[]): T {
  const row = rows[0];
  if (row === undefined) throw new Error('expected one row');
  return row;
}
