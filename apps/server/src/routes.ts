import { defaultAppearance, saveCharacterSchema } from "@lagos-living/shared";
import { fromNodeHeaders, toNodeHandler } from "better-auth/node";
import cors from "cors";
import type { Express, NextFunction, Request, Response } from "express";
import { auth } from "./auth.js";
import { config } from "./config.js";
import { pool } from "./database.js";
import { createMultiplayerToken } from "./multiplayer-token.js";

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
}
