import "dotenv/config";
import { z } from "zod";

const DEVELOPMENT_SECRET = "development-only-secret-change-me-now";

const configSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().positive().default(2567),
    WEB_ORIGIN: z.url().default("http://localhost:5173"),
    DATABASE_URL: z
      .string()
      .default("postgresql://lagos:lagos_dev@localhost:5432/lagos_living"),
    /**
     * `require` verifies the database certificate; `disable` is only for a database
     * reachable solely over a private network (for example the compose network).
     * Defaults to `require` in production.
     */
    DATABASE_SSL: z.enum(["require", "disable"]).optional(),
    BETTER_AUTH_SECRET: z.string().min(32).default(DEVELOPMENT_SECRET),
    BETTER_AUTH_URL: z.url().default("http://localhost:2567"),
    SMTP_HOST: z.string().default("localhost"),
    SMTP_PORT: z.coerce.number().int().positive().default(1025),
    /** `true` for implicit TLS (usually port 465); otherwise STARTTLS is used when the server offers it. */
    SMTP_SECURE: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),
    SMTP_FROM: z.string().default("Lagos Living <no-reply@lagosliving.local>"),
    STARTING_NAIRA: z.coerce.number().int().nonnegative().default(250_000),
    /**
     * Comma-separated IPs/CIDRs of reverse proxies that append to X-Forwarded-For. Without it only a single-value
     * header is trusted, so the proxy in front of the API must overwrite that header.
     */
    TRUSTED_PROXIES: z
      .string()
      .default("")
      .transform((value) => value.split(",").map((entry) => entry.trim()).filter(Boolean)),
    /** Directory holding the streamed world tiles (building footprints for collision). */
    WORLD_TILE_DIR: z.string().optional(),
    /** Shared Redis for running several server processes; unset keeps everything in one process. */
    REDIS_URL: z.string().optional(),
    /** Address clients use to reach this process directly (host[:port][/path]) when several processes run. */
    PUBLIC_ADDRESS: z.string().optional(),
  })
  .superRefine((value, context) => {
    if (value.NODE_ENV !== "production") return;
    if (value.BETTER_AUTH_SECRET === DEVELOPMENT_SECRET) {
      context.addIssue({
        code: "custom",
        path: ["BETTER_AUTH_SECRET"],
        message: "Set a unique BETTER_AUTH_SECRET for production",
      });
    }
    for (const key of ["WEB_ORIGIN", "BETTER_AUTH_URL"] as const) {
      if (!value[key].startsWith("https://") && !/^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(value[key])) {
        context.addIssue({ code: "custom", path: [key], message: `${key} must use https in production` });
      }
    }
  });

export const parseConfig = (env: NodeJS.ProcessEnv) => configSchema.parse(env);

export const config = parseConfig(process.env);
