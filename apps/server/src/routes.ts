import { setFinish } from "./home-finish-service.js";
import {
  claimAccountSchema,
  SONG_REQUEST,
  buyBusinessSchema,
  listBusinessSchema,
  sellToBrokerSchema,
  songUploadSchema,
  songUpdateSchema,
  SONG_VENUES,
  type StaffRole,
  directMessageSendSchema,
  friendRequestSchema,
  friendRespondSchema,
  getPlace,
  roomArea,
  GUEST_EMAIL_DOMAIN,
  lifeGoalsSchema,
  enrolSchema,
  viewingEntrySchema,
  viewingOrderSchema,
  gymSetSchema,
  startBusinessSchema,
  upgradeBusinessSchema,
  acquirePropertySchema,
  clubOrderSchema,
  tableBottleSchema,
  tableInviteSchema,
  communityVisitSchema,
  completeJobRequestSchema,
  defaultAppearance,
  defaultSettings,
  eatRequestSchema,
  settingsSchema,
  footballBetSchema,
  owambeHostSchema,
  spinBetSchema,
  tradeRequestSchema,
  transferRequestSchema,
  takeGigSchema,
  repairSchema,
  hireStaffSchema,
  orderDeliverySchema,
  spraySchema,
  aircraftPurchaseSchema,
  tenancyActionSchema,
  homeActionSchema,
  inviteGuestSchema,
  moveFurnitureSchema,
  homeFinishSchema,
  placeFurnitureSchema,
  purchaseRequestSchema,
  saveCharacterSchema,
  visaApplySchema,
  ticketBuySchema,
  ticketCancelSchema,
  travelInviteSchema,
  inviteAnswerSchema,
  hotelBookSchema,
  hotelBookingSchema,
  hotelExtendSchema,
  hotelGuestSchema,
  hotelStoreSchema,
  travelOrderSchema,
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
  hireSecuritySchema,
  policeReportSchema,
  ROBBERY,
  isRankingBoard,
  buyDieselSchema,
  buyGeneratorSchema,
  generatorSwitchSchema,
  buyFuelSchema,
  fuelStationPriceSchema,
} from "@lagos-living/shared";
import { fromNodeHeaders, toNodeHandler } from "better-auth/node";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import cors from "cors";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { borrow, claimChapter, hustleStatus, repay } from "./hustle-service.js";
import { buyAircraft, hangar } from "./aircraft-service.js";
import { businessMarket, businessStatus, buyBusiness, collectBusiness, enrol, listBusiness, sellToBroker, startBusiness, upgradeBusiness } from "./business-service.js";
import { finishSet, gymStatus, hireTrainer, joinGym, startSet } from "./gym-service.js";
import { buyViewingPass, orderAtViewing, viewingStatus } from "./viewing-service.js";
import { finishRest, startRest } from "./home-living-service.js";
import { buyFuel, buyStation, fuelStations, setStationPrice } from "./fuel-service.js";
import { currentOwambe, hostOwambe } from "./owambe-service.js";
import { agePower, buyDiesel, buyGenerator, homePower, switchGenerator } from "./power-service.js";
import { applyCleaner, collectParcel, dismissStaff, eatParcel, hireStaff, homeStaff, openParcels, orderDelivery, partyUntil, staffByHome, startParty, stopParty } from "./home-services-service.js";
import { addSong, listSongs, removeSong, songAudio, updateSong } from "./song-service.js";
import { cancelGig, completeGig, gigStatus, repairGig, startGigWork, takeGig } from "./gig-service.js";
import { betFootball, betSpin, bettingStatus, claimDaily, dailyStatus, marketStatus, sprayMoney, trade, transferMoney } from "./finance-service.js";
import { auth } from "./auth.js";
import { accountSummary, claimGuestAccount, getGoals, resetAddress, saveGoals } from "./account-service.js";
import { acquirePlot, buildingEvents, buyReadyBuilt, listPlots, payNextStage, releasePlotsOf, renewPlotLease, startConstruction } from "./building-service.js";
import { matchMaker } from "@colyseus/core";
import { config, isWebOrigin } from "./config.js";
import { pool } from "./database.js";
import { clientReportSchema, listClientReports, processHealth, recordClientReport } from "./diagnostics.js";
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
import { conversation, friendsStatus, removeFriend, requestFriend, respondFriend, sendDirectMessage } from "./social-service.js";
import { claimReferral, referralStatus } from "./referral-service.js";
import { rankings } from "./ranking-service.js";
import { loadPlayerPlace } from "./economy-service.js";
import { loadCharacter, saveAppearance, wardrobe } from "./profile-service.js";
import { getCommunityStatus, visitQuietPlace, volunteerShift } from "./community-service.js";
import { bookTable, buyWristband, getClubStatus, listTables, orderAtBar, orderBottle, setTableGuest } from "./club-service.js";
import { dismissSecurity, getSecurityStatus, hireSecurity, policeRecords, reportRobbery } from "./police-service.js";
import { encounterIncidents } from "./street-encounter-service.js";
import {
  answerInvite,
  applyVisa,
  bookHotel,
  buyTicket,
  cancelTicket,
  checkInHotel,
  endHotelStay,
  extendHotelStay,
  inviteFriend,
  moveStorage as moveHotelStorage,
  orderTravelFood,
  setHotelGuest,
  travelEvents,
  travelStatus,
} from "./travel-service.js";
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
  moveFurniture,
  removePropertyGuest,
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
  if (!config.GUEST_MODE && config.NODE_ENV !== "development" && session.user.email.endsWith(`@${GUEST_EMAIL_DOMAIN}`)) {
    res.status(401).json({ error: "Guest play is closed. Create a free account to keep playing." });
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

function staffOnly(role: StaffRole) {
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
      origin: (origin, done) => done(null, !origin || isWebOrigin(origin)),
      credentials: true,
      methods: ["GET", "POST", "PUT", "OPTIONS"],
      exposedHeaders: ["set-auth-token"],
    }),
  );

  app.all("/api/auth/*splat", toNodeHandler(auth));

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", service: "lagos-living-server" });
  });

  /** For the supervisor and uptime checks: 503 when the database does not answer within 3 s. */
  app.get("/api/health/deep", async (_req, res) => {
    const began = Date.now();
    const database = await Promise.race([
      pool.query("SELECT 1").then(() => "ok" as const),
      new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 3_000).unref()),
    ]).catch(() => "down" as const);
    const rooms = await matchMaker.query({ name: "lagos" }).catch(() => []);
    res.status(database === "ok" ? 200 : 503).json({
      status: database === "ok" ? "ok" : "degraded",
      database,
      databaseMs: Date.now() - began,
      instances: rooms.length,
      players: rooms.reduce((sum, room) => sum + room.clients, 0),
      ...processHealth(),
    });
  });

  /** Crash and performance reports from browsers; anonymous allowed, limited per address. */
  app.post("/api/diagnostics", async (req, res) => {
    const parsed = clientReportSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid report" });
      return;
    }
    if (!(await withinRate(`diag:${req.ip ?? "unknown"}`, 30, 600_000).catch(() => false))) {
      res.status(429).json({ error: "Too many reports" });
      return;
    }
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) }).catch(() => null);
    recordClientReport(parsed.data, session?.user.id ?? null);
    res.status(204).end();
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
      // Nigerian mobile networks put many phones behind one carrier address, so the cap is per address, not per person.
      if (!(await withinRate(`guest:${req.ip ?? "unknown"}`, 60, 3_600_000))) {
        res.status(429).json({ error: "Too many guest accounts from this address. Try again later." });
        return;
      }
      const tag = randomBytes(4).toString("hex").slice(0, 6);
      const result = await auth.api.signUpEmail({
        body: {
          email: `guest-${randomUUID()}@${GUEST_EMAIL_DOMAIN}`,
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

  /**
   * Which group a resident joins: their own district's if it has room, otherwise the liveliest group with a free place,
   * so a quiet district doesn't leave someone alone while another group has space. A new group starts only when all are full.
   */
  async function neighbourhoodFor(home: string) {
    const open = (await matchMaker.query({ name: "lagos" })).filter((room) => !room.locked && !room.private && room.clients < room.maxClients);
    if (open.some((room) => room.metadata?.area === home)) return home;
    const liveliest = open.filter((room) => room.clients > 0 && typeof room.metadata?.area === "string").sort((a, b) => b.clients - a.clients)[0];
    return (liveliest?.metadata?.area as string | undefined) ?? home;
  }

  app.post("/api/multiplayer-token", requirePlayer, async (req, res) => {
    const { userId, name } = (req as AuthenticatedRequest).player;
    const place = await loadPlayerPlace(userId).catch(() => null);
    const home = place ? roomArea(place.x, place.z) : roomArea(...getPlace("starter-home").door);
    res.json({ token: createMultiplayerToken({ userId, name }), area: await neighbourhoodFor(home).catch(() => home) });
  });

  app.get("/api/referral", requirePlayer, guarded("Invites unavailable", (_req, userId) => referralStatus(userId)));
  app.post("/api/referral/claim", requirePlayer, rateLimited, guarded("Could not use the invite", (req, userId) => claimReferral(userId, String(req.body?.code ?? ""))));
  app.get("/api/rankings/:board", requirePlayer, guarded("Rankings unavailable", (req, userId) => {
    const board = String(req.params.board);
    if (!isRankingBoard(board)) throw new EconomyError("No such ranking.", 404);
    return rankings(userId, board);
  }));
  app.get("/api/friends", requirePlayer, guarded("Friends unavailable", (_req, userId) => friendsStatus(userId)));
  app.post("/api/friends/request", requirePlayer, rateLimited, guarded("Could not send the friend request", (req, userId) => requestFriend(userId, friendRequestSchema.parse(req.body).userName)));
  app.post("/api/friends/respond", requirePlayer, rateLimited, guarded("Could not answer the friend request", (req, userId) => {
    const { userId: from, accept } = friendRespondSchema.parse(req.body);
    return respondFriend(userId, from, accept);
  }));
  app.delete("/api/friends/:id", requirePlayer, rateLimited, guarded("Could not remove the friend", (req, userId) => removeFriend(userId, z.string().min(1).max(100).parse(req.params.id))));
  app.get("/api/messages/:id", requirePlayer, guarded("Messages unavailable", (req, userId) => conversation(userId, z.string().min(1).max(100).parse(req.params.id))));
  app.post("/api/messages", requirePlayer, rateLimited, guarded("Message not sent", (req, userId) => {
    const { to, text } = directMessageSendSchema.parse(req.body);
    return sendDirectMessage(userId, to, text);
  }));

  app.get("/api/character", requirePlayer, guarded("Character unavailable", (_req, userId) => loadCharacter(userId)));

  app.get("/api/wardrobe", requirePlayer, guarded("Wardrobe unavailable", (_req, userId) => wardrobe(userId)));
  app.put("/api/character", requirePlayer, rateLimited, guarded("Character could not be saved", (req, userId) =>
    saveAppearance(userId, saveCharacterSchema.parse(req.body).appearance)));

  app.get("/api/travel", requirePlayer, guarded("Travel unavailable", (_req, userId) => travelStatus(userId)));
  app.post("/api/travel/visa", requirePlayer, rateLimited, guarded("Visa application failed", (req, userId) => {
    const body = visaApplySchema.parse(req.body);
    return applyVisa(userId, body.plan, body.idempotencyKey);
  }));
  app.post("/api/travel/ticket", requirePlayer, rateLimited, guarded("Ticket could not be bought", (req, userId) => {
    const body = ticketBuySchema.parse(req.body);
    return buyTicket(userId, body.cabin, body.idempotencyKey);
  }));
  app.post("/api/travel/ticket/cancel", requirePlayer, rateLimited, guarded("Ticket could not be cancelled", (req, userId) =>
    cancelTicket(userId, ticketCancelSchema.parse(req.body).ticketId)));
  app.post("/api/travel/invite", requirePlayer, rateLimited, guarded("Invitation failed", async (req, userId) => {
    const body = travelInviteSchema.parse(req.body);
    const result = await inviteFriend(userId, body.ticketId, body.userName);
    travelEvents.emit("invite", result.friendId, (req as AuthenticatedRequest).player.name);
    return result;
  }));
  app.post("/api/travel/invite/answer", requirePlayer, rateLimited, guarded("Invitation could not be answered", (req, userId) => {
    const body = inviteAnswerSchema.parse(req.body);
    return answerInvite(userId, body.inviteId, body.accept, body.idempotencyKey);
  }));
  app.post("/api/travel/hotel/book", requirePlayer, rateLimited, guarded("Booking failed", (req, userId) => {
    const body = hotelBookSchema.parse(req.body);
    return bookHotel(userId, body.hotelId, body.roomType, body.nights, body.idempotencyKey);
  }));
  app.post("/api/travel/hotel/checkin", requirePlayer, rateLimited, guarded("Check-in failed", (req, userId) =>
    checkInHotel(userId, hotelBookingSchema.parse(req.body).bookingId)));
  app.post("/api/travel/hotel/end", requirePlayer, rateLimited, guarded("Checkout failed", (req, userId) =>
    endHotelStay(userId, hotelBookingSchema.parse(req.body).bookingId)));
  app.post("/api/travel/hotel/extend", requirePlayer, rateLimited, guarded("Extension failed", (req, userId) => {
    const body = hotelExtendSchema.parse(req.body);
    return extendHotelStay(userId, body.bookingId, body.nights, body.idempotencyKey);
  }));
  app.post("/api/travel/hotel/guest", requirePlayer, rateLimited, guarded("Guest list unchanged", (req, userId) => {
    const body = hotelGuestSchema.parse(req.body);
    return setHotelGuest(userId, body.bookingId, body.userName, body.invited);
  }));
  app.post("/api/travel/hotel/storage", requirePlayer, rateLimited, guarded("Safe unavailable", (req, userId) => {
    const body = hotelStoreSchema.parse(req.body);
    return moveHotelStorage(userId, body.bookingId, body.itemId, body.direction);
  }));
  app.post("/api/travel/order", requirePlayer, rateLimited, guarded("Order failed", (req, userId) => {
    const body = travelOrderSchema.parse(req.body);
    return orderTravelFood(userId, body.menu, body.itemId, body.bookingId, body.idempotencyKey);
  }));

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
  app.post("/api/needs/rest", requirePlayer, rateLimited, guarded("Could not sit down", (_req, userId) => startRest(userId)));
  app.post("/api/needs/rest/finish", requirePlayer, rateLimited, guarded("Could not stand up", (_req, userId) => finishRest(userId)));

  app.post("/api/jobs/delivery/start", requirePlayer, rateLimited, guarded("Job could not be started", (_req, userId) =>
    startDelivery(userId)));

  app.post("/api/jobs/delivery/complete", requirePlayer, rateLimited, guarded("Job could not be completed", (req, userId) =>
    completeDelivery(userId, completeJobRequestSchema.parse(req.body).jobId)));

  app.post("/api/jobs/delivery/cancel", requirePlayer, guarded("Job could not be cancelled", (_req, userId) =>
    cancelDelivery(userId)));

  app.get("/api/properties", requirePlayer, guarded("Listings unavailable", (_req, userId) =>
    listProperties(userId)));

  app.get("/api/plots", requirePlayer, guarded("Plots unavailable", async (_req, userId) => {
    const plots = await listPlots(userId);
    const staff = await staffByHome(plots.flatMap((plot) => (plot.construction?.homeId ? [plot.construction.homeId] : [])));
    return plots.map((plot) => ({ ...plot, staff: plot.construction?.homeId ? (staff.get(plot.construction.homeId) ?? []) : [] }));
  }));

  app.post("/api/plots/:plotId/acquire", requirePlayer, rateLimited, guarded("Plot could not be acquired", (req, userId) => {
    const body = z.object({ tenure: z.enum(["leased", "owned"]), idempotencyKey: z.string().min(8).max(80), viaAgent: z.boolean().optional() }).parse(req.body);
    return acquirePlot(userId, String(req.params.plotId), body.tenure, body.idempotencyKey, body.viaAgent ?? false);
  }));

  app.post("/api/plots/:plotId/renew", requirePlayer, rateLimited, guarded("Ground rent could not be paid", (req, userId) =>
    renewPlotLease(userId, String(req.params.plotId), tenancyActionSchema.parse(req.body).idempotencyKey)));

  app.post("/api/plots/:plotId/build", requirePlayer, rateLimited, guarded("Building could not start", (req, userId) => {
    const body = z.object({ designId: z.string().min(1).max(40), idempotencyKey: z.string().min(8).max(80) }).parse(req.body);
    return startConstruction(userId, String(req.params.plotId), body.designId, body.idempotencyKey);
  }));

  app.post("/api/plots/:plotId/buy-built", requirePlayer, rateLimited, guarded("The house could not be bought", (req, userId) => {
    const body = z.object({ designId: z.string().min(1).max(40), idempotencyKey: z.string().min(8).max(80), viaAgent: z.boolean().optional() }).parse(req.body);
    return buyReadyBuilt(userId, String(req.params.plotId), body.designId, body.idempotencyKey, body.viaAgent ?? false);
  }));

  app.post("/api/plots/:plotId/next-stage", requirePlayer, rateLimited, guarded("The builders could not be paid", (req, userId) =>
    payNextStage(userId, String(req.params.plotId), tenancyActionSchema.parse(req.body).idempotencyKey)));

  app.post("/api/properties/acquire", requirePlayer, rateLimited, guarded("Property could not be acquired", (req, userId) => {
    const body = acquirePropertySchema.parse(req.body);
    return acquireProperty(userId, body.propertyId, body.tenure, body.idempotencyKey, body.viaAgent ?? false);
  }));

  app.post("/api/properties/:propertyId/renew", requirePlayer, rateLimited, guarded("Rent could not be renewed", (req, userId) =>
    renewTenancy(userId, String(req.params.propertyId), tenancyActionSchema.parse(req.body).idempotencyKey)));

  app.post("/api/properties/:propertyId/cancel", requirePlayer, rateLimited, guarded("Tenancy could not be cancelled", (req, userId) =>
    cancelTenancy(userId, String(req.params.propertyId), tenancyActionSchema.parse(req.body).idempotencyKey)));

  app.post("/api/properties/:propertyId/home", requirePlayer, guarded("Home could not be set", (req, userId) =>
    setHome(userId, String(req.params.propertyId))));

  app.get("/api/properties/:propertyId/interior", requirePlayer, guarded("Home could not be entered", async (req, userId) => {
    const propertyId = String(req.params.propertyId);
    await applyCleaner(propertyId);
    const [interior, staff, party] = await Promise.all([getInterior(userId, propertyId), homeStaff(propertyId), partyUntil(propertyId)]);
    return { ...interior, staff, partyUntil: party };
  }));
  app.post("/api/properties/:propertyId/staff", requirePlayer, rateLimited, guarded("Staff could not be hired", (req, userId) => {
    const body = hireStaffSchema.parse(req.body);
    return hireStaff(userId, String(req.params.propertyId), body.role, body.idempotencyKey);
  }));
  app.post("/api/properties/:propertyId/staff/dismiss", requirePlayer, rateLimited, guarded("Staff unchanged", (req, userId) =>
    dismissStaff(userId, String(req.params.propertyId), hireStaffSchema.pick({ role: true }).parse(req.body).role)));
  app.post("/api/properties/:propertyId/party", requirePlayer, rateLimited, guarded("Party could not start", (req, userId) =>
    z.object({ on: z.boolean() }).parse(req.body).on ? startParty(userId, String(req.params.propertyId)) : stopParty(userId, String(req.params.propertyId))));
  app.post("/api/spray", requirePlayer, rateLimited, guarded("Could not spray", (req, userId) => {
    const body = spraySchema.parse(req.body);
    return sprayMoney(userId, body.amount, body.idempotencyKey);
  }));

  app.get("/api/hustle", requirePlayer, guarded("Hustle Fund unavailable", (_req, userId) => hustleStatus(userId)));
  app.post("/api/hustle/borrow", requirePlayer, rateLimited, guarded("Loan could not be paid out", (req, userId) => {
    const body = z.object({ amount: z.number().int().positive(), idempotencyKey: z.uuid() }).parse(req.body);
    return borrow(userId, body.amount, body.idempotencyKey);
  }));
  app.post("/api/hustle/repay", requirePlayer, rateLimited, guarded("Repayment failed", (req, userId) => {
    const body = z.object({ amount: z.number().int().positive().optional(), idempotencyKey: z.uuid() }).parse(req.body);
    return repay(userId, body.amount, body.idempotencyKey);
  }));
  app.get("/api/aircraft", requirePlayer, guarded("Hangar unavailable", async (_req, userId) => ({ owned: await hangar(userId) })));
  app.post("/api/aircraft/purchase", requirePlayer, rateLimited, guarded("Aircraft purchase failed", (req, userId) => {
    const body = aircraftPurchaseSchema.parse(req.body);
    return buyAircraft(userId, body.modelId, body.idempotencyKey);
  }));
  app.post("/api/story/:chapter/claim", requirePlayer, rateLimited, guarded("Reward could not be claimed", (req, userId) =>
    claimChapter(userId, z.enum(["fresh", "hustler", "clean-slate", "moving", "landlord", "big-boss"]).parse(req.params.chapter))));

  app.get("/api/business", requirePlayer, guarded("Business unavailable", (_req, userId) => businessStatus(userId)));
  app.post("/api/business", requirePlayer, rateLimited, guarded("Business could not be registered", (req, userId) => {
    const body = startBusinessSchema.parse(req.body);
    return startBusiness(userId, body.type, body.name, body.idempotencyKey, body.plotId);
  }));
  app.post("/api/business/:businessId/upgrade", requirePlayer, rateLimited, guarded("Upgrade failed", (req, userId) =>
    upgradeBusiness(userId, z.uuid().parse(req.params.businessId), upgradeBusinessSchema.parse(req.body).idempotencyKey)));
  app.post("/api/business/:businessId/collect", requirePlayer, rateLimited, guarded("Collection failed", (req, userId) =>
    collectBusiness(userId, z.uuid().parse(req.params.businessId))));
  app.get("/api/business/market", requirePlayer, guarded("Business market unavailable", (_req, userId) => businessMarket(userId)));
  app.post("/api/business/:businessId/list", requirePlayer, rateLimited, guarded("Listing failed", (req, userId) =>
    listBusiness(userId, z.uuid().parse(req.params.businessId), listBusinessSchema.parse(req.body).price)));
  app.post("/api/business/:businessId/buy", requirePlayer, rateLimited, guarded("Purchase failed", (req, userId) => {
    const body = buyBusinessSchema.parse(req.body);
    return buyBusiness(userId, z.uuid().parse(req.params.businessId), body.price, body.idempotencyKey);
  }));
  app.post("/api/business/:businessId/broker", requirePlayer, rateLimited, guarded("Sale failed", (req, userId) =>
    sellToBroker(userId, z.uuid().parse(req.params.businessId), sellToBrokerSchema.parse(req.body).idempotencyKey)));
  app.post("/api/school/enrol", requirePlayer, rateLimited, guarded("Enrolment failed", (req, userId) => {
    const body = enrolSchema.parse(req.body);
    return enrol(userId, body.course, body.idempotencyKey);
  }));

  app.get("/api/gym", requirePlayer, guarded("Gym unavailable", (_req, userId) => gymStatus(userId)));
  app.post("/api/gym/join", requirePlayer, rateLimited, guarded("Membership failed", (req, userId) =>
    joinGym(userId, z.object({ idempotencyKey: z.string().uuid() }).parse(req.body).idempotencyKey)));
  app.post("/api/gym/set", requirePlayer, rateLimited, guarded("Could not start the set", (req, userId) => {
    const { exercise, kg } = gymSetSchema.parse(req.body);
    return startSet(userId, exercise, kg);
  }));
  app.post("/api/gym/trainer", requirePlayer, rateLimited, guarded("Could not hire a trainer", (req, userId) =>
    hireTrainer(userId, z.object({ idempotencyKey: z.string().uuid() }).parse(req.body).idempotencyKey)));
  app.post("/api/gym/finish", requirePlayer, rateLimited, guarded("Could not finish the set", (_req, userId) => finishSet(userId)));

  app.get("/api/viewing", requirePlayer, guarded("Viewing centre unavailable", (req, userId) =>
    viewingStatus(userId, typeof req.query.placeId === "string" ? req.query.placeId : undefined)));
  app.post("/api/viewing/entry", requirePlayer, rateLimited, guarded("Could not pay at the door", (req, userId) =>
    buyViewingPass(userId, viewingEntrySchema.parse(req.body).placeId)));
  app.post("/api/viewing/:placeId/order", requirePlayer, rateLimited, guarded("Order could not be placed", (req, userId) => {
    const { itemId, idempotencyKey } = viewingOrderSchema.parse(req.body);
    return orderAtViewing(userId, String(req.params.placeId), itemId, idempotencyKey);
  }));

  app.post("/api/delivery/order", requirePlayer, rateLimited, guarded("Order failed", (req, userId) => {
    const body = orderDeliverySchema.parse(req.body);
    return orderDelivery(userId, body.itemId, body.idempotencyKey, body.destination);
  }));
  app.get("/api/delivery/parcels", requirePlayer, guarded("Orders unavailable", (_req, userId) => openParcels(userId)));
  app.post("/api/delivery/parcels/:parcelId/collect", requirePlayer, rateLimited, guarded("Could not take the order", (req, userId) =>
    collectParcel(userId, z.string().uuid().parse(req.params.parcelId))));
  app.post("/api/delivery/parcels/:parcelId/eat", requirePlayer, rateLimited, guarded("Could not eat", (req, userId) =>
    eatParcel(userId, z.string().uuid().parse(req.params.parcelId))));

  app.post("/api/properties/:propertyId/furniture", requirePlayer, rateLimited, guarded("Furniture could not be placed", (req, userId) =>
    placeFurniture(userId, String(req.params.propertyId), placeFurnitureSchema.parse(req.body))));

  app.post("/api/properties/:propertyId/furniture/move", requirePlayer, rateLimited, guarded("Furniture could not be moved", (req, userId) =>
    moveFurniture(userId, String(req.params.propertyId), moveFurnitureSchema.parse(req.body))));

  app.get("/api/owambe", requirePlayer, guarded("The event ground is unavailable", () => currentOwambe()));
  app.post("/api/owambe/host", requirePlayer, rateLimited, guarded("The owambe could not be booked", (req, userId) => hostOwambe(userId, owambeHostSchema.parse(req.body))));
  app.get("/api/fuel/stations", requirePlayer, guarded("Filling stations unavailable", (_req, userId) => fuelStations(userId)));
  app.post("/api/fuel/buy", requirePlayer, rateLimited, guarded("The attendant could not fill the tank", (req, userId) => buyFuel(userId, buyFuelSchema.parse(req.body))));
  app.post("/api/fuel/stations/:stationId/buy", requirePlayer, rateLimited, guarded("The station could not be bought", (req, userId) =>
    buyStation(userId, String(req.params.stationId), z.object({ idempotencyKey: z.string().min(8).max(120) }).parse(req.body).idempotencyKey)));
  app.post("/api/fuel/stations/:stationId/price", requirePlayer, rateLimited, guarded("The pump price could not be changed", (req, userId) =>
    setStationPrice(userId, String(req.params.stationId), fuelStationPriceSchema.parse(req.body).price)));

  app.get("/api/properties/:propertyId/power", requirePlayer, guarded("Could not check the light", (req, userId) =>
    homePower(userId, String(req.params.propertyId), req.query.home === "1")));
  app.post("/api/properties/:propertyId/generator", requirePlayer, rateLimited, guarded("The generator could not be installed", (req, userId) =>
    buyGenerator(userId, String(req.params.propertyId), buyGeneratorSchema.parse(req.body))));
  app.post("/api/properties/:propertyId/diesel", requirePlayer, rateLimited, guarded("Diesel could not be delivered", (req, userId) =>
    buyDiesel(userId, String(req.params.propertyId), buyDieselSchema.parse(req.body))));
  app.post("/api/properties/:propertyId/generator/switch", requirePlayer, rateLimited, guarded("Could not reach the generator", (req, userId) =>
    switchGenerator(userId, String(req.params.propertyId), generatorSwitchSchema.parse(req.body))));

  app.post("/api/properties/:propertyId/finish", requirePlayer, rateLimited, guarded("Your home could not be redecorated", (req, userId) =>
    setFinish(userId, String(req.params.propertyId), homeFinishSchema.parse(req.body))));

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

  app.post("/api/properties/:propertyId/guests/remove", requirePlayer, rateLimited, guarded("Guest list unchanged", (req, userId) =>
    removePropertyGuest(userId, String(req.params.propertyId), inviteGuestSchema.parse(req.body).username)));

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

  app.get("/api/clubs/:placeId", requirePlayer, guarded("Club unavailable", (req, userId) =>
    getClubStatus(userId, String(req.params.placeId))));

  app.post("/api/clubs/:placeId/wristband", requirePlayer, rateLimited, guarded("Entry could not be paid", (req, userId) =>
    buyWristband(userId, String(req.params.placeId))));

  app.post("/api/clubs/:placeId/order", requirePlayer, rateLimited, guarded("Order could not be placed", (req, userId) => {
    const { itemId, idempotencyKey } = clubOrderSchema.parse(req.body);
    return orderAtBar(userId, String(req.params.placeId), itemId, idempotencyKey);
  }));

  const tableNo = (req: { params: Record<string, unknown> }) => Number(req.params.no);

  app.get("/api/clubs/:placeId/tables", requirePlayer, guarded("Tables unavailable", (req, userId) =>
    listTables(userId, String(req.params.placeId))));

  app.post("/api/clubs/:placeId/tables/:no/book", requirePlayer, rateLimited, guarded("Table could not be booked", (req, userId) =>
    bookTable(userId, String(req.params.placeId), tableNo(req))));

  app.post("/api/clubs/:placeId/tables/:no/guests", requirePlayer, rateLimited, guarded("Guest list not updated", (req, userId) =>
    setTableGuest(userId, String(req.params.placeId), tableNo(req), tableInviteSchema.parse(req.body).userName, true)));

  app.post("/api/clubs/:placeId/tables/:no/guests/remove", requirePlayer, rateLimited, guarded("Guest list not updated", (req, userId) =>
    setTableGuest(userId, String(req.params.placeId), tableNo(req), tableInviteSchema.parse(req.body).userName, false)));

  app.post("/api/clubs/:placeId/tables/:no/bottle", requirePlayer, rateLimited, guarded("Bottle could not be ordered", (req, userId) => {
    const { itemId, idempotencyKey } = tableBottleSchema.parse(req.body);
    return orderBottle(userId, String(req.params.placeId), tableNo(req), itemId, idempotencyKey);
  }));

  app.get("/api/daily", requirePlayer, guarded("Daily bonus unavailable", (_req, userId) => dailyStatus(userId)));
  app.post("/api/daily/claim", requirePlayer, rateLimited, guarded("Daily bonus could not be collected", (_req, userId) => claimDaily(userId)));
  app.post("/api/bank/transfer", requirePlayer, rateLimited, guarded("Transfer failed", (req, userId) => transferMoney(userId, transferRequestSchema.parse(req.body))));
  app.get("/api/market", requirePlayer, guarded("Market unavailable", (_req, userId) => marketStatus(userId)));
  app.post("/api/market/trade", requirePlayer, rateLimited, guarded("Trade failed", (req, userId) => trade(userId, tradeRequestSchema.parse(req.body))));
  app.get("/api/betting", requirePlayer, guarded("Betting unavailable", (_req, userId) => bettingStatus(userId)));
  app.post("/api/betting/spin", requirePlayer, rateLimited, guarded("Bet failed", (req, userId) => betSpin(userId, spinBetSchema.parse(req.body))));
  app.post("/api/betting/football", requirePlayer, rateLimited, guarded("Bet failed", (req, userId) => betFootball(userId, footballBetSchema.parse(req.body))));

  app.get("/api/gigs", requirePlayer, guarded("Gigs unavailable", (_req, userId) => gigStatus(userId)));
  app.post("/api/gigs/take", requirePlayer, rateLimited, guarded("Gig could not be taken", (req, userId) => takeGig(userId, takeGigSchema.parse(req.body).gigId)));
  app.post("/api/gigs/start", requirePlayer, rateLimited, guarded("Job could not start", (_req, userId) => startGigWork(userId)));
  app.post("/api/gigs/repair", requirePlayer, rateLimited, guarded("Repair step failed", (req, userId) => repairGig(userId, repairSchema.parse(req.body).action)));
  app.post("/api/gigs/complete", requirePlayer, rateLimited, guarded("Job could not be finished", (_req, userId) => completeGig(userId)));
  app.post("/api/gigs/cancel", requirePlayer, rateLimited, guarded("Gig could not be cancelled", (_req, userId) => cancelGig(userId)));

  app.get("/api/security", requirePlayer, guarded("Security unavailable", (_req, userId) =>
    getSecurityStatus(userId)));

  app.post("/api/security/hire", requirePlayer, rateLimited, guarded("Guards could not be hired", (req, userId) => {
    const { plan, idempotencyKey } = hireSecuritySchema.parse(req.body);
    return hireSecurity(userId, plan, idempotencyKey);
  }));

  app.post("/api/security/dismiss", requirePlayer, rateLimited, guarded("Guards could not be dismissed", (_req, userId) =>
    dismissSecurity(userId)));

  app.get("/api/police/records", requirePlayer, guarded("Police records unavailable", async (_req, userId) => ({
    ...(await policeRecords(userId)),
    incidents: await encounterIncidents(userId),
  })));

  app.post("/api/police/report", requirePlayer, rateLimited, guarded("Report could not be filed", (req, userId) => {
    const { userName, details } = policeReportSchema.parse(req.body);
    return reportRobbery(userId, userName, details);
  }));

  app.get("/api/account", requireSession, guarded("Account unavailable", (_req, userId) => accountSummary(userId)));

  app.post("/api/account/claim", requireSession, rateLimited, guarded("Could not create your account", (req, userId) =>
    claimGuestAccount(userId, claimAccountSchema.parse(req.body))));

  // Lets players who signed up with a username (and an email) ask for a reset link without remembering the email.
  app.post("/api/account/forgot", async (req, res) => {
    const parsed = z.object({ identifier: z.string().trim().min(3).max(120), redirectTo: z.string().url().max(300) }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Enter your username or email." });
      return;
    }
    try {
      if (!(await withinRate(`forgot:${req.ip ?? "unknown"}`, 8, 900_000))) {
        res.status(429).json({ error: "Too many reset requests. Try again in a few minutes." });
        return;
      }
      const email = await resetAddress(parsed.data.identifier);
      if (email) await auth.api.requestPasswordReset({ body: { email, redirectTo: parsed.data.redirectTo }, headers: fromNodeHeaders(req.headers) });
    } catch (error) {
      console.error("Password reset request failed", error);
    }
    res.json({ ok: true });
  });

  app.get("/api/goals", requirePlayer, guarded("Goals unavailable", async (_req, userId) => ({ goals: await getGoals(userId) })));

  app.put("/api/goals", requirePlayer, rateLimited, guarded("Could not save your goals", async (req, userId) => ({
    goals: await saveGoals(userId, lifeGoalsSchema.parse(req.body)),
  })));

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

  app.get("/api/admin/device-reports", requirePlayer, staffOnly("admin"), guarded("Device reports unavailable", (req) =>
    listClientReports(z.coerce.number().int().min(1).max(500).default(200).parse(req.query.limit), z.string().max(30).optional().parse(req.query.kind || undefined))));

  app.post("/api/admin/roles", requirePlayer, staffOnly("admin"), rateLimited, guarded("Role could not be changed", (req) => {
    const body = roleChangeSchema.parse(req.body);
    return setStaffRole(actorOf(req), body.userName, body.role, body.reason);
  }));

  app.get("/api/songs", requirePlayer, guarded("Songs unavailable", (req) =>
    listSongs(z.enum(SONG_VENUES).default("club").parse(req.query.venue))));
  app.get("/api/admin/songs", requirePlayer, staffOnly("music"), guarded("Songs unavailable", () => listSongs()));

  /** Public by unguessable id, so a plain <audio> element can stream it from another origin. */
  app.get("/api/songs/:songId/audio", async (req, res) => {
    try {
      const song = await songAudio(String(req.params.songId));
      if (!song) return void res.status(404).json({ error: "Not found" });
      res.setHeader("Content-Type", song.mime);
      res.setHeader("Cache-Control", "public, max-age=86400, immutable");
      res.setHeader("Accept-Ranges", "bytes");
      const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ""));
      if (range) {
        const size = song.audio.length;
        const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
        const end = range[1] && range[2] ? Math.min(size - 1, Number(range[2])) : size - 1;
        if (start >= size || start > end) return void res.status(416).setHeader("Content-Range", `bytes */${size}`).end();
        res.status(206).setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
        return void res.end(song.audio.subarray(start, end + 1));
      }
      res.end(song.audio);
    } catch (error) {
      console.error("Song audio failed", error);
      res.status(500).json({ error: "Song unavailable" });
    }
  });

  app.post(
    "/api/admin/songs",
    requirePlayer,
    staffOnly("music"),
    rateLimited,
    express.raw({ type: ["audio/*", "application/octet-stream"], limit: SONG_REQUEST.maxBytes }),
    guarded("Song could not be uploaded", (req) => {
      const meta = songUploadSchema.parse(req.query);
      const audio = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      return addSong({ ...meta, mime: String(req.headers["content-type"] ?? ""), audio }, actorOf(req).name);
    }),
  );

  app.post("/api/admin/songs/:songId", requirePlayer, staffOnly("music"), rateLimited, guarded("Song could not be updated", (req) =>
    updateSong(String(req.params.songId), songUpdateSchema.parse(req.body))));
  app.post("/api/admin/songs/:songId/remove", requirePlayer, staffOnly("music"), rateLimited, guarded("Song could not be removed", (req) =>
    removeSong(String(req.params.songId))));

  /** Local test harness: makes the signed-in account staff, recorded in the audit log as a console action. */
  /** Local test harness: winds the generator's clocks back as if the house had sat through a cut. */
  app.post("/api/dev/age-power", devOnly, requirePlayer, guarded("Age power failed", async (req) => {
    const body = z.object({ propertyId: z.string().min(1), minutes: z.number().int().min(1).max(10_000) }).parse(req.body);
    await agePower(body.propertyId, body.minutes);
    return { aged: true };
  }));

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

  /** Local test harness: makes this account older than the new-resident protection against robbery. */
  app.post("/api/dev/age-account", devOnly, requirePlayer, guarded("Age account failed", async (_req, userId) => {
    await pool.query(`UPDATE "user" SET "createdAt" = NOW() - make_interval(secs => $2) WHERE id = $1`, [userId, ROBBERY.newResidentMs / 1_000 + 60]);
    return { aged: true };
  }));
}
