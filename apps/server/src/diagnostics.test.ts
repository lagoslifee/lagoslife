import { afterAll, describe, expect, it } from "vitest";
import { pool } from "./database.js";
import { listClientReports, recordClientReport } from "./diagnostics.js";

const marker = `test-${Date.now()}`;

afterAll(async () => {
  await pool.query(`DELETE FROM client_report WHERE message = $1`, [marker]);
});

describe("device reports", () => {
  it("lists a recorded report for staff, filtered by kind", async () => {
    recordClientReport({ kind: "unclean-exit", message: marker, detail: { area: "creator-first" }, device: "iPad", page: "/#creator-first" }, null);
    let found: Awaited<ReturnType<typeof listClientReports>> = [];
    for (let attempt = 0; attempt < 20 && found.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      found = (await listClientReports(50, "unclean-exit")).filter((row) => row.message === marker);
    }
    expect(found[0]).toMatchObject({ kind: "unclean-exit", page: "/#creator-first", detail: { area: "creator-first" }, userName: null });
    expect((await listClientReports(50, "memory")).some((row) => row.message === marker)).toBe(false);
  });
});
