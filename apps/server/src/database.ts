import { Pool } from "pg";
import { config } from "./config.js";

export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: 10,
  ssl:
    (config.DATABASE_SSL ?? (config.NODE_ENV === "production" ? "require" : "disable")) === "require"
      ? { rejectUnauthorized: true }
      : false,
});
