import postgres from "postgres";

let cached: postgres.Sql | null = null;

export function getSql(): postgres.Sql {
  if (!cached) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error("DATABASE_URL is not configured");
    }
    cached = postgres(url, { max: 1, prepare: false, idle_timeout: 20 });
  }
  return cached;
}

export type Row = Record<string, any>;
export type Query = (text: string, params?: any[]) => Promise<Row[]>;

export function getDb(): Query {
  const sql = getSql();
  return ((text: string, params: any[] = []) =>
    sql.unsafe(text, params) as unknown as Promise<Row[]>) as Query;
}

export const q: Query = ((text: string, params: any[] = []) =>
  getSql().unsafe(text, params) as unknown as Promise<Row[]>) as Query;
