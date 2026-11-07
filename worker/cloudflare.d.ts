/** Minimal D1/Workers types to keep this starter dependency-light. */
interface D1PreparedStatement {
  bind(...values: Array<string | number | boolean | null>): D1PreparedStatement;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { changes: number } }>;
}
interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<unknown[]>;
}
interface Fetcher { fetch(request: Request): Promise<Response> }
interface ExportedHandler<E> { fetch(request: Request, env: E): Promise<Response> }
