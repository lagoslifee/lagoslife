import "dotenv/config";
import { z } from "zod";

const configSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(2567),
  WEB_ORIGIN: z.url().default("http://localhost:5173"),
  DATABASE_URL: z
    .string()
    .default("postgresql://lagos:lagos_dev@localhost:5432/lagos_living"),
  BETTER_AUTH_SECRET: z.string().min(32).default("development-only-secret-change-me-now"),
  BETTER_AUTH_URL: z.url().default("http://localhost:2567"),
  SMTP_HOST: z.string().default("localhost"),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  SMTP_FROM: z.string().default("Lagos Living <no-reply@lagosliving.local>"),
  STARTING_NAIRA: z.coerce.number().int().nonnegative().default(250_000),
  /** Directory holding the streamed world tiles (building footprints for collision). */
  WORLD_TILE_DIR: z.string().optional(),
});

export const config = configSchema.parse(process.env);
