import { Pool } from "pg";
import { config } from "./config.js";

export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: 10,
  ssl: config.NODE_ENV === "production" ? { rejectUnauthorized: true } : false,
});
