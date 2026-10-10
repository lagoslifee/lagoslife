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
  purchaseVehicleSchema,
  vehicleActionSchema,
} from "@lagos-living/shared";
import { fromNodeHeaders, toNodeHandler } from "better-auth/node";
import { createHmac } from "node:crypto";
import cors from "cors";
import type { Express, NextFunction, Request, Response } from "express";
import { auth } from "./auth.js";
import { config } from "./config.js";
import { pool } from "./database.js";
import { markProgressReset } from "./player-presence.js";
import { createMultiplayerToken } from "./multiplayer-token.js";
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

const sensitiveRates = new Map<string, { since: number; count: number }>();
/** Per-player limit for money-moving routes; generous for play, hostile to scripts. */
function rateLimited(req: Request, res: Response, next: NextFunction) {
  const userId = (req as AuthenticatedRequest).player.userId;
  const now = Date.now();
  const rate = sensitiveRates.get(userId) ?? { since: now, count: 0 };
  if (now - rate.since > 10_000) {
    rate.since = now;
    rate.count = 0;
  }
  rate.count += 1;
  sensitiveRates.set(userId, rate);
  if (rate.count > 25) {
    res.status(429).json({ error: "Too many requests — slow down a little." });
    return;
  }
  next();
}

type AuthenticatedRequest = Request & {
  player: { userId: string; name: string };
};

async function requirePlayer(req: Request, res: Response, next: NextFunction) {
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(req.headers),
  });
  if (!session) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  (req as AuthenticatedRequest).player = {
    userId: session.user.id,
    name: session.user.username ?? session.user.name,
  };
  next();
}

export function configureRoutes(app: Express) {
  app.use(
    cors({
      origin: config.WEB_ORIGIN,
      credentials: true,
      methods: ["GET", "POST", "PUT", "OPTIONS"],
    }),
  );

  app.all("/api/auth/*splat", toNodeHandler(auth));

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", service: "lagos-living-server" });
  });

  app.post("/api/dev/sign-in", async (req, res) => {
    const isLocalHost = ["localhost", "127.0.0.1", "::1"].includes(req.hostname);
    if (config.NODE_ENV !== "development" || !isLocalHost) {
      res.status(404).json({ error: "Not found" });
      return;
    }

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

  app.post("/api/multiplayer-token", requirePlayer, (req, res) => {
    const { userId, name } = (req as AuthenticatedRequest).player;
    res.json({ token: createMultiplayerToken({ userId, name }) });
  });

  app.get("/api/character", requirePlayer, async (req, res) => {
    const { userId } = (req as AuthenticatedRequest).player;
    const result = await pool.query(
      `SELECT appearance, tutorial_complete AS "tutorialComplete"
       FROM player_profile WHERE user_id = $1`,
      [userId],
    );
    res.json(
      result.rows[0] ?? {
        appearance: defaultAppearance,
        tutorialComplete: false,
      },
    );
  });

  app.put("/api/character", requirePlayer, async (req, res) => {
    const parsed = saveCharacterSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid character options" });
      return;
    }
    const { userId } = (req as AuthenticatedRequest).player;
    const result = await pool.query(
      `INSERT INTO player_profile (user_id, appearance)
       VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE
       SET appearance = EXCLUDED.appearance, updated_at = NOW()
       RETURNING appearance, tutorial_complete AS "tutorialComplete"`,
      [userId, parsed.data.appearance],
    );
    res.json(result.rows[0]);
  });

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

  app.post("/api/vehicles/:vehicleId/retrieve", requirePlayer, rateLimited, guarded("Vehicle could not be retrieved", (req, userId) =>
    retrieveVehicle(userId, String(req.params.vehicleId))));

  app.get("/api/community", requirePlayer, guarded("Community status unavailable", (_req, userId) =>
    getCommunityStatus(userId)));

  app.post("/api/community/visit", requirePlayer, rateLimited, guarded("Visit could not be recorded", (req, userId) =>
    visitQuietPlace(userId, communityVisitSchema.parse(req.body).placeId)));

  app.post("/api/community/volunteer", requirePlayer, rateLimited, guarded("Volunteer shift could not be recorded", (req, userId) =>
    volunteerShift(userId, communityVisitSchema.parse(req.body).placeId)));

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

  app.post("/api/dev/reset-progress", requirePlayer, guarded("Reset failed", async (req, userId) => {
    const isLocalHost = ["localhost", "127.0.0.1", "::1"].includes(req.hostname);
    if (config.NODE_ENV !== "development" || !isLocalHost) throw new EconomyError("Not found", 404);
    markProgressReset(userId);
    await resetTestProgress(userId);
    return { reset: true };
  }));
}
