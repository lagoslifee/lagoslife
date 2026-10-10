import { STAFF_ROLES, type StaffRole } from "@lagos-living/shared";
import { pool } from "./database.js";
import { setStaffRole } from "./safety-service.js";

/** Server console: `npm run staff:role -w @lagos-living/server -- <username> <moderator|admin|none> "<reason>"`. */
const [userName, roleArg, ...reasonWords] = process.argv.slice(2);
const reason = reasonWords.join(" ").trim();
if (!userName || !roleArg || (roleArg !== "none" && !STAFF_ROLES.includes(roleArg as StaffRole)) || reason.length < 3) {
  console.error('Usage: staff:role <username> <moderator|admin|none> "<reason>"');
  process.exit(2);
}

try {
  const result = await setStaffRole({ userId: "console", name: "server console" }, userName, roleArg === "none" ? null : (roleArg as StaffRole), reason);
  console.log(`${result.userName} is now ${result.role ?? "a regular resident"}. Recorded in the moderation audit log.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
