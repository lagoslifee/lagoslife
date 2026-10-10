import {
  acquirePropertySchema,
  communityVisitSchema,
  completeJobRequestSchema,
  defaultAppearance,
  defaultSettings,
  eatRequestSchema,
  settingsSchema,
  tenancyActionSchema,
  homeActionSchema,
  inviteGuestSchema,
  placeFurnitureSchema,
  purchaseRequestSchema,
  saveCharacterSchema,
  garageVehicleSchema,
  vehicleLockSchema,
  purchaseVehicleSchema,
  placeById,
  vehicleActionSchema,
  appealCitationSchema,
  blockSchema,
  decideAppealSchema,
  districtAt,
  JUSTICE,
  moderationActionSchema,
  payCitationSchema,
  reportSchema,
  resolveReportSchema,
  roleChangeSchema,
} from "@lagos-living/shared";
import { fromNodeHeaders, toNodeHandler } from "better-auth/node";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import cors from "cors";
import type { Express, NextFunction, Request, Response } from "express";
import { auth } from "./auth.js";
import { acquirePlot, buildingEvents, listPlots, payNextStage, releasePlotsOf, renewPlotLease, startConstruction } from "./building-service.js";
import { config } from "./config.js";
import { pool } from "./database.js";
import { getPlayerPosition, markProgressReset } from "./player-presence.js";
import { withinRate } from "./request-rate.js";
import {
  appealCitation,
  citationHistory,
  decideAppeal,
  issueCitation,
  listAppeals,
  listCitations,
  payCitation,
} from "./justice-service.js";
import {
  acknowledgeWarnings,
  activeSuspension,
  applyModerationAction,
  blockPlayer,
  findResident,
  getSafetyStatus,
  listAudit,
  listReports,
  reportPlayer,
  requireStaff,
  residentRecord,
  resolveReport,
  setStaffRole,
  staffOverview,
  unblockPlayer,
} from "./safety-service.js";
import { createMultiplayerToken } from "./multiplayer-token.js";
import { loadCharacter, saveAppearance } from "./profile-service.js";
import { getCommunityStatus, visitQuietPlace, volunteerShift } from "./community-service.js";
import { z } from "zod";
import {
  cancelDelivery,
  completeDelivery,
  eatItem,
  EconomyError,
  ensureProfile,
  getEconomyState,
  purchaseItem,
  resetTestProgress,
  restAtHome,
  savePlayerPlace,
  startDelivery,
} from "./economy-service.js";
import {
  acquireProperty,
  cancelTenancy,
  getInterior,
  invitePropertyGuest,
  listProperties,
  moveStorage,
  performHomeAction,
  placeFurniture,
  removeFurniture,
  renewTenancy,
  setHome,
} from "./property-service.js";
import {
  garageVehicle,
  insureVehicle,
  listVehicles,
  purchaseVehicle,
  retrieveVehicle,
  setVehicleLock,
  serviceVehicle,
  towVehicle,
} from "./vehicle-service.js";

type Handler = (req: Request, userId: string) => Promise<unknown>;

/** Wraps an authenticated JSON handler and maps EconomyError to its status. */
function guarded(fallback: string, handler: Handler) {
  return async (req: Request, res: Response) => {
    try {
      res.json(await handler(req, (req as AuthenticatedRequest).player.userId));
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: "Invalid request" });
        return;
      }
      if (!(error instanceof EconomyError)) console.error(fallback, error);
      res.status(error instanceof EconomyError ? error.status : 500).json({
        error: error instanceof EconomyError ? error.message : fallback,
      });
    }
  };
}

/** Per-player limit for money-moving routes; generous for play, hostile to scripts. Shared by every server process. */
async function rateLimited(req: Request, res: Response, next: NextFunction) {
  const userId = (req as AuthenticatedRequest).player.userId;
  try {
    if (!(await withinRate(`player:${userId}`, 25, 10_000))) {
      res.status(429).json({ error: "Too many requests — slow down a little." });
      return;
    }
  } catch (error) {
    console.error("Rate limit check failed", error);
    res.status(503).json({ error: "Try again in a moment." });
    return;
  }
  next();
}

type AuthenticatedRequest = Request & {
  player: { userId: string; name: string };
};

async function requireSession(req: Request, res: Response, next: NextFunction) {
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(req.headers),
  });
  if (!session) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  (req as AuthenticatedRequest).player = {
    userId: session.user.id,
    name: session.user.displayUsername ?? session.user.username ?? session.user.name,
  };
  next();
}

/** A signed-in player whose account is not suspended. */
function requirePlayer(req: Request, res: Response, next: NextFunction) {
  void requireSession(req, res, async () => {
    const suspension = await activeSuspension((req as AuthenticatedRequest).player.userId).catch(() => null);
    if (suspension) {
      res.status(403).json({
        error: "This account is suspended.",
        suspension: { reason: suspension.reason, until: suspension.endsAt?.toISOString() ?? null },
      });
      return;
    }
    next();
  });
}

function staffOnly(role: "moderator" | "admin") {
  return (req: Request, res: Response, next: NextFunction) => {
    requireStaff((req as AuthenticatedRequest).player.userId, role)
      .then(() => next())
      .catch(() => res.status(404).json({ error: "Not found" }));
  };
}

const actorOf = (req: Request) => {
  const { userId, name } = (req as AuthenticatedRequest).player;
  return { userId, name };
};

/** Test-harness routes exist only for a development server reached on localhost; anywhere else they 404 before auth. */
function devOnly(req: Request, res: Response, next: NextFunction) {
  const isLocalHost = ["localhost", "127.0.0.1", "::1"].includes(req.hostname);
  if (config.NODE_ENV !== "development" || !isLocalHost) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  next();
}

export function configureRoutes(app: Express) {
  // Behind a reverse proxy or tunnel, per-address limits must see the visitor, not the proxy.
  if (config.TRUSTED_PROXIES.length) app.set("trust proxy", config.TRUSTED_PROXIES);
  app.use(
    cors({
      origin: config.WEB_ORIGIN,
      credentials: true,
      methods: ["GET", "POST", "PUT", "OPTIONS"],
      exposedHeaders: ["set-auth-token"],
    }),
  );

  app.all("/api/auth/*splat", toNodeHandler(auth));

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", service: "lagos-living-server" });
  });

  app.post("/api/dev/sign-in", devOnly, async (req, res) => {

    const credentials = {
      email: "local-tester@lagosliving.local",
      password: `${createHmac("sha256", config.BETTER_AUTH_SECRET)
        .update("lagos-living-local-tester")
        .digest("hex")}!Dev1`,
    };
    let response = await auth.api.signInEmail({
      body: credentials,
      headers: fromNodeHeaders(req.headers),
      asResponse: true,
    });
    if (!response.ok) {
      response = await auth.api.signUpEmail({
        body: {
          ...credentials,
          name: "Local Tester",
          username: "LocalTester",
        },
        headers: fromNodeHeaders(req.headers),
        asResponse: true,
      });
      if (!response.ok) {
        response = await auth.api.signInEmail({
          body: credentials,
          headers: fromNodeHeaders(req.headers),
          asResponse: true,
        });
      }
    }

    const setCookies = response.headers.getSetCookie();
    if (setCookies.length > 0) res.setHeader("set-cookie", setCookies);
    const contentType = response.headers.get("content-type");
    if (contentType) res.setHeader("content-type", contentType);
    res.status(response.status).send(Buffer.from(await response.arrayBuffer()));
  });

  app.post("/api/guest", async (req, res) => {
    if (!config.GUEST_MODE && config.NODE_ENV !== "development") {
      res.status(404).json({ error: "Not found" });
      return;
    }
    try {
      if (!(await withinRate(`guest:${req.ip ?? "unknown"}`, 20, 3_600_000))) {
        res.status(429).json({ error: "Too many guest accounts from this address. Try again later." });
        return;
      }
      const tag = randomBytes(4).toString("hex").slice(0, 6);
      const result = await auth.api.signUpEmail({
        body: {
          email: `guest-${randomUUID()}@guest.lagosliving.local`,
          password: randomBytes(24).toString("base64url"),
          name: `Guest ${tag}`,
          username: `Guest_${tag}`,
        },
        headers: fromNodeHeaders(req.headers),
      });
      if (!result.token) throw new Error("Guest sign-up returned no session");
      res.json({ token: result.token, name: `Guest_${tag}` });
    } catch (error) {
      console.error("Guest account failed", error);
      res.status(500).json({ error: "Could not start a guest session." });
    }
  });

  app.post("/api/multiplayer-token", requirePlayer, (req, res) => {
    const { userId, name } = (req as AuthenticatedRequest).player;
    res.json({ token: createMultiplayerToken({ userId, name }) });
  });

  app.get("/api/character", requirePlayer, guarded("Character unavailable", (_req, userId) => loadCharacter(userId)));

  app.put("/api/character", requirePlayer, rateLimited, guarded("Character could not be saved", (req, userId) =>
    saveAppearance(userId, saveCharacterSchema.parse(req.body).appearance)));

  app.get("/api/economy", requirePlayer, async (req, res) => {
    const { userId } = (req as AuthenticatedRequest).player;
    res.json(await getEconomyState(userId));
  });

  app.post("/api/shop/purchase", requirePlayer, rateLimited, guarded("Purchase could not be completed", (req, userId) => {
    const body = purchaseRequestSchema.parse(req.body);
    return purchaseItem(userId, body.itemId, body.idempotencyKey);
  }));

  app.post("/api/food/eat", requirePlayer, rateLimited, guarded("Could not eat", (req, userId) =>
    eatItem(userId, eatRequestSchema.parse(req.body).itemId)));

  app.post("/api/needs/sleep", requirePlayer, rateLimited, guarded("Could not sleep", (_req, userId) =>
    restAtHome(userId)));

  app.post("/api/jobs/delivery/start", requirePlayer, rateLimited, guarded("Job could not be started", (_req, userId) =>
    startDelivery(userId)));

  app.post("/api/jobs/delivery/complete", requirePlayer, rateLimited, guarded("Job could not be completed", (req, userId) =>
    completeDelivery(userId, completeJobRequestSchema.parse(req.body).jobId)));

  app.post("/api/jobs/delivery/cancel", requirePlayer, guarded("Job could not be cancelled", (_req, userId) =>
    cancelDelivery(userId)));

  app.get("/api/properties", requirePlayer, guarded("Listings unavailable", (_req, userId) =>
    listProperties(userId)));

  app.get("/api/plots", requirePlayer, guarded("Plots unavailable", (_req, userId) => listPlots(userId)));

  app.post("/api/plots/:plotId/acquire", requirePlayer, rateLimited, guarded("Plot could not be acquired", (req, userId) => {
    const body = z.object({ tenure: z.enum(["leased", "owned"]), idempotencyKey: z.string().min(8).max(80) }).parse(req.body);
    return acquirePlot(userId, String(req.params.plotId), body.tenure, body.idempotencyKey);
  }));

  app.post("/api/plots/:plotId/renew", requirePlayer, rateLimited, guarded("Ground rent could not be paid", (req, userId) =>
    renewPlotLease(userId, String(req.params.plotId), tenancyActionSchema.parse(req.body).idempotencyKey)));

  app.post("/api/plots/:plotId/build", requirePlayer, rateLimited, guarded("Building could not start", (req, userId) => {
    const body = z.object({ designId: z.string().min(1).max(40), idempotencyKey: z.string().min(8).max(80) }).parse(req.body);
    return startConstruction(userId, String(req.params.plotId), body.designId, body.idempotencyKey);
  }));

  app.post("/api/plots/:plotId/next-stage", requirePlayer, rateLimited, guarded("The builders could not be paid", (req, userId) =>
    payNextStage(userId, String(req.params.plotId), tenancyActionSchema.parse(req.body).idempotencyKey)));

  app.post("/api/properties/acquire", requirePlayer, rateLimited, guarded("Property could not be acquired", (req, userId) => {
    const body = acquirePropertySchema.parse(req.body);
    return acquireProperty(userId, body.propertyId, body.tenure, body.idempotencyKey);
  }));

  app.post("/api/properties/:propertyId/renew", requirePlayer, rateLimited, guarded("Rent could not be renewed", (req, userId) =>
    renewTenancy(userId, String(req.params.propertyId), tenancyActionSchema.parse(req.body).idempotencyKey)));

  app.post("/api/properties/:propertyId/cancel", requirePlayer, rateLimited, guarded("Tenancy could not be cancelled", (req, userId) =>
    cancelTenancy(userId, String(req.params.propertyId), tenancyActionSchema.parse(req.body).idempotencyKey)));

  app.post("/api/properties/:propertyId/home", requirePlayer, guarded("Home could not be set", (req, userId) =>
    setHome(userId, String(req.params.propertyId))));

  app.get("/api/properties/:propertyId/interior", requirePlayer, guarded("Home could not be entered", (req, userId) =>
    getInterior(userId, String(req.params.propertyId))));

  app.post("/api/properties/:propertyId/furniture", requirePlayer, rateLimited, guarded("Furniture could not be placed", (req, userId) =>
    placeFurniture(userId, String(req.params.propertyId), placeFurnitureSchema.parse(req.body))));

  app.post("/api/properties/:propertyId/furniture/remove", requirePlayer, rateLimited, guarded("Furniture could not be moved", (req, userId) =>
    removeFurniture(userId, String(req.params.propertyId), z.object({ placementId: z.uuid() }).parse(req.body).placementId)));

  app.post("/api/properties/:propertyId/storage", requirePlayer, rateLimited, guarded("Storage action failed", (req, userId) => {
    const body = z.object({ itemId: z.string().min(1).max(80), direction: z.enum(["store", "retrieve"]) }).parse(req.body);
    return moveStorage(userId, String(req.params.propertyId), body.itemId, body.direction);
  }));

  app.post("/api/properties/:propertyId/action", requirePlayer, rateLimited, guarded("Home action failed", (req, userId) =>
    performHomeAction(userId, String(req.params.propertyId), homeActionSchema.parse(req.body).action)));

  app.post("/api/properties/:propertyId/guests", requirePlayer, rateLimited, guarded("Guest could not be invited", (req, userId) =>
    invitePropertyGuest(userId, String(req.params.propertyId), inviteGuestSchema.parse(req.body).username)));

  app.get("/api/vehicles", requirePlayer, guarded("Vehicles unavailable", (_req, userId) =>
    listVehicles(userId)));

  app.post("/api/vehicles/purchase", requirePlayer, rateLimited, guarded("Vehicle could not be purchased", (req, userId) => {
    const body = purchaseVehicleSchema.parse(req.body);
    return purchaseVehicle(userId, body.modelId, body.colour, body.idempotencyKey);
  }));

  app.post("/api/vehicles/:vehicleId/service", requirePlayer, rateLimited, guarded("Service could not be completed", (req, userId) =>
    serviceVehicle(userId, String(req.params.vehicleId), vehicleActionSchema.parse(req.body).idempotencyKey)));

  app.post("/api/vehicles/:vehicleId/insure", requirePlayer, rateLimited, guarded("Cover could not be bought", (req, userId) =>
    insureVehicle(userId, String(req.params.vehicleId), vehicleActionSchema.parse(req.body).idempotencyKey)));

  app.post("/api/vehicles/:vehicleId/tow", requirePlayer, rateLimited, guarded("Tow could not be booked", (req, userId) =>
    towVehicle(userId, String(req.params.vehicleId), vehicleActionSchema.parse(req.body).idempotencyKey)));

  app.post("/api/vehicles/:vehicleId/garage", requirePlayer, rateLimited, guarded("Vehicle could not be garaged", (req, userId) =>
    garageVehicle(userId, String(req.params.vehicleId), garageVehicleSchema.parse(req.body).propertyId)));

  app.post("/api/vehicles/:vehicleId/lock", requirePlayer, rateLimited, guarded("Lock could not be changed", (req, userId) =>
    setVehicleLock(userId, String(req.params.vehicleId), vehicleLockSchema.parse(req.body).locked)));

  app.post("/api/vehicles/:vehicleId/retrieve", requirePlayer, rateLimited, guarded("Vehicle could not be retrieved", (req, userId) =>
    retrieveVehicle(userId, String(req.params.vehicleId))));

  app.get("/api/community", requirePlayer, guarded("Community status unavailable", (_req, userId) =>
    getCommunityStatus(userId)));

  app.post("/api/community/visit", requirePlayer, rateLimited, guarded("Visit could not be recorded", (req, userId) =>
    visitQuietPlace(userId, communityVisitSchema.parse(req.body).placeId)));

  app.post("/api/community/volunteer", requirePlayer, rateLimited, guarded("Volunteer shift could not be recorded", (req, userId) =>
    volunteerShift(userId, communityVisitSchema.parse(req.body).placeId)));

  app.get("/api/account/standing", requireSession, guarded("Standing unavailable", async (_req, userId) => {
    const suspension = await activeSuspension(userId);
    return { suspension: suspension ? { reason: suspension.reason, until: suspension.endsAt?.toISOString() ?? null } : null };
  }));

  app.get("/api/safety", requirePlayer, guarded("Safety settings unavailable", (_req, userId) =>
    getSafetyStatus(userId)));

  app.post("/api/safety/block", requirePlayer, rateLimited, guarded("Could not block", (req, userId) =>
    blockPlayer(userId, blockSchema.parse(req.body).userName)));

  app.post("/api/safety/unblock", requirePlayer, rateLimited, guarded("Could not unblock", (req, userId) =>
    unblockPlayer(userId, blockSchema.parse(req.body).userName)));

  app.post("/api/safety/report", requirePlayer, rateLimited, guarded("Report could not be sent", (req, userId) =>
    reportPlayer(userId, reportSchema.parse(req.body))));

  app.post("/api/safety/warnings/acknowledge", requirePlayer, guarded("Could not acknowledge", (_req, userId) =>
    acknowledgeWarnings(userId)));

  app.get("/api/justice", requirePlayer, guarded("Citations unavailable", (_req, userId) =>
    listCitations(userId)));

  app.post("/api/justice/:citationId/pay", requirePlayer, rateLimited, guarded("Fine could not be paid", (req, userId) =>
    payCitation(userId, String(req.params.citationId), payCitationSchema.parse(req.body).idempotencyKey)));

  app.post("/api/justice/:citationId/appeal", requirePlayer, rateLimited, guarded("Appeal could not be filed", (req, userId) =>
    appealCitation(userId, String(req.params.citationId), appealCitationSchema.parse(req.body).statement)));

  const moderator = [requirePlayer, staffOnly("moderator")];

  app.get("/api/mod/overview", ...moderator, guarded("Overview unavailable", () => staffOverview()));

  app.get("/api/mod/reports", ...moderator, guarded("Reports unavailable", (req) =>
    listReports(z.enum(["open", "actioned", "dismissed"]).default("open").parse(req.query.status))));

  app.post("/api/mod/reports/:reportId/resolve", ...moderator, rateLimited, guarded("Report could not be resolved", (req) => {
    const body = resolveReportSchema.parse(req.body);
    return resolveReport(actorOf(req), String(req.params.reportId), body.resolution, body.note);
  }));

  app.get("/api/mod/residents", ...moderator, guarded("Resident not found", async (req) =>
    residentRecord((await findResident(z.string().min(1).max(40).parse(req.query.name))).id)));

  app.get("/api/mod/residents/:userId", ...moderator, guarded("Resident not found", (req) =>
    residentRecord(String(req.params.userId))));

  app.post("/api/mod/actions", ...moderator, rateLimited, guarded("Action could not be applied", (req) =>
    applyModerationAction(actorOf(req), moderationActionSchema.parse(req.body))));

  app.get("/api/mod/appeals", ...moderator, guarded("Appeals unavailable", () => listAppeals()));

  app.post("/api/mod/appeals/:citationId/decide", ...moderator, rateLimited, guarded("Appeal could not be decided", (req) => {
    const body = decideAppealSchema.parse(req.body);
    return decideAppeal(actorOf(req), String(req.params.citationId), body.outcome, body.note);
  }));

  app.get("/api/mod/citations/:citationId/history", ...moderator, guarded("History unavailable", (req) =>
    citationHistory(String(req.params.citationId))));

  app.get("/api/mod/audit", ...moderator, guarded("Audit log unavailable", (req) =>
    listAudit(z.coerce.number().int().default(100).parse(req.query.limit))));

  app.post("/api/admin/roles", requirePlayer, staffOnly("admin"), rateLimited, guarded("Role could not be changed", (req) => {
    const body = roleChangeSchema.parse(req.body);
    return setStaffRole(actorOf(req), body.userName, body.role, body.reason);
  }));

  /** Local test harness: makes the signed-in account staff, recorded in the audit log as a console action. */
  app.post("/api/dev/staff", devOnly, requireSession, guarded("Role change failed", async (req) => {
    const { role } = z.object({ role: z.enum(["moderator", "admin"]).nullable() }).parse(req.body);
    return setStaffRole({ userId: "console", name: "dev console" }, actorOf(req).name, role, "local development");
  }));

  /** Local test harness: issues a careless-driving citation where the player stands, as the room does on a crash. */
  app.post("/api/dev/citation", devOnly, requirePlayer, guarded("Citation failed", async (req, userId) => {
    const position = getPlayerPosition(userId);
    const x = position?.x ?? 0;
    const z = position?.z ?? 0;
    return issueCitation(userId, "careless_driving", { x, z, speed: JUSTICE.carelessDrivingSpeed + 2, district: districtAt(x, z)?.name ?? null });
  }));

  app.get("/api/settings", requirePlayer, guarded("Settings unavailable", async (_req, userId) => {
    await ensureProfile(pool, userId);
    const result = await pool.query(`SELECT settings FROM player_profile WHERE user_id = $1`, [userId]);
    return { ...defaultSettings, ...(result.rows[0]?.settings ?? {}) };
  }));

  app.put("/api/settings", requirePlayer, guarded("Settings could not be saved", async (req, userId) => {
    const settings = settingsSchema.parse(req.body);
    await ensureProfile(pool, userId);
    await pool.query(`UPDATE player_profile SET settings = $2, updated_at = NOW() WHERE user_id = $1`, [userId, settings]);
    return settings;
  }));

  app.post("/api/dev/reset-progress", devOnly, requirePlayer, guarded("Reset failed", async (req, userId) => {
    markProgressReset(userId);
    await releasePlotsOf(userId);
    await resetTestProgress(userId);
    return { reset: true };
  }));

  /** Local test harness: the builders finish the current stage now instead of after minutes. */
  app.post("/api/dev/finish-stage", devOnly, requirePlayer, guarded("Finish stage failed", async (req, userId) => {
    const result = await pool.query(
      `UPDATE construction SET stage_ready_at = NOW() - interval '1 second', stage_started_at = LEAST(stage_started_at, NOW() - interval '2 seconds')
       WHERE owner_user_id = $1 AND completed_at IS NULL RETURNING plot_id`,
      [userId],
    );
    if (!result.rowCount) throw new EconomyError("Nothing is being built", 404);
    buildingEvents.emit("changed");
    return { plotId: result.rows[0].plot_id };
  }));

  /** Local test harness: the next session starts at a place's kerb, so far districts can be tested without the drive. */
  app.post("/api/dev/spawn-at", devOnly, requirePlayer, guarded("Spawn failed", async (req, userId) => {
    const place = placeById.get(communityVisitSchema.parse(req.body).placeId);
    if (!place) throw new EconomyError("Unknown place", 404);
    markProgressReset(userId);
    await savePlayerPlace(userId, place.kerb[0], place.kerb[1], "street");
    return { x: place.kerb[0], z: place.kerb[1] };
  }));
}
