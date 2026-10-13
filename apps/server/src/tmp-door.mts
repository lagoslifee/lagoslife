import { pool } from "./database.js";
import { getPlace } from "@lagos-living/shared";
import { savePlayerPlace } from "./economy-service.js";
const [x, z] = getPlace("lekki-chief-okoro-house").door;
await savePlayerPlace("R9M7ET5YIgNSmqgJtmiBA0XlMaKY7eVo", x, z + 1, "street");
await pool.end();
