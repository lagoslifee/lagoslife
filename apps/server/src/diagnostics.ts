import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { config } from "./config.js";
import { pool } from "./database.js";

const MAX_BYTES = 5 * 1024 * 1024;
const startedAt = Date.now();
let crashesLogged = 0;
let clientReports = 0;

/** Appends one JSON line; synchronous so it still lands when the process is about to exit. */
export function writeLog(file: "server.log" | "client.log", entry: Record<string, unknown>) {
  try {
    if (!existsSync(config.LOG_DIR)) mkdirSync(config.LOG_DIR, { recursive: true });
    const path = join(config.LOG_DIR, file);
    if (existsSync(path) && statSync(path).size > MAX_BYTES) renameSync(path, `${path}.1`);
    appendFileSync(path, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
  } catch (error) {
    console.error("Could not write diagnostics log", error);
  }
}

const describe = (error: unknown) =>
  error instanceof Error ? { message: error.message, stack: error.stack?.slice(0, 4_000) } : { message: String(error) };

/**
 * An uncaught exception leaves the process in an unknown state, so it is logged and the process exits for the
 * supervisor (`scripts/ops/supervise.sh`) to restart. A stray rejected promise is logged and the server keeps running.
 */
export function installCrashHandlers() {
  process.on("uncaughtException", (error) => {
    crashesLogged += 1;
    writeLog("server.log", { level: "fatal", kind: "uncaughtException", ...describe(error) });
    console.error("Fatal uncaught exception — exiting so the supervisor restarts the server", error);
    process.exit(1);
  });
  process.on("unhandledRejection", (reason) => {
    crashesLogged += 1;
    writeLog("server.log", { level: "error", kind: "unhandledRejection", ...describe(reason) });
    console.error("Unhandled promise rejection", reason);
  });
  writeLog("server.log", { level: "info", kind: "start", pid: process.pid, node: process.version });
}

export const clientReportSchema = z.object({
  kind: z.enum(["error", "rejection", "context-lost", "context-restored", "disconnect", "reconnect", "low-fps", "unclean-exit", "memory", "ui-crash"]),
  // Trim instead of rejecting: a report dropped for an over-long field is the one that explains a crash.
  message: z.string().default("").transform((value) => value.slice(0, 500)),
  stack: z.string().transform((value) => value.slice(0, 2_000)).optional(),
  detail: z.record(z.string(), z.union([z.string().transform((value) => value.slice(0, 200)), z.number(), z.boolean(), z.null()])).optional(),
  quality: z.string().max(10).optional(),
  device: z.string().max(240).optional(),
  page: z.string().max(200).optional(),
});

const REPORT_DAYS = 14;

export function recordClientReport(report: z.infer<typeof clientReportSchema>, userId: string | null) {
  clientReports += 1;
  writeLog("client.log", { userId, ...report });
  // The host's disk log is out of reach on managed hosting; the table is what gets read when a device misbehaves.
  void pool
    .query(
      `INSERT INTO client_report (user_id, kind, message, stack, detail, quality, device, page) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [userId, report.kind, report.message, report.stack ?? null, report.detail ? JSON.stringify(report.detail) : null, report.quality ?? null, report.device ?? null, report.page ?? null],
    )
    .then(async () => {
      if (clientReports % 200 === 0) await pool.query(`DELETE FROM client_report WHERE at < NOW() - make_interval(days => $1)`, [REPORT_DAYS]);
    })
    .catch(() => undefined);
}

export function processHealth() {
  const memory = process.memoryUsage();
  return {
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1_000),
    memoryMb: { rss: Math.round(memory.rss / 1e6), heapUsed: Math.round(memory.heapUsed / 1e6) },
    errorsSinceStart: crashesLogged,
    clientReportsSinceStart: clientReports,
  };
}
