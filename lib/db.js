// lib/db.js
// Neon serverless client over HTTP. One instance is reused across warm invocations.
import { neon } from "@neondatabase/serverless";

let sql;

export function getSql() {
  if (!sql) {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
    sql = neon(process.env.DATABASE_URL);
  }
  return sql;
}
