import { defineRoom, defineServer } from "@colyseus/core";
import { RedisDriver } from "@colyseus/redis-driver";
import { RedisPresence } from "@colyseus/redis-presence";
import express from "express";
import { buildingEvents, refreshPlotFootprints } from "./building-service.js";
import { bridgeEmitter, joinCluster } from "./cluster.js";
import { config } from "./config.js";
import { profileEvents } from "./profile-service.js";
import { LagosRoom } from "./rooms/LagosRoom.js";
import { configureRoutes } from "./routes.js";
import { purgeExpiredRates } from "./request-rate.js";
import { purgeExpiredChat, safetyEvents } from "./safety-service.js";
import { vehicleEvents } from "./vehicle-events.js";

const presence = config.REDIS_URL ? new RedisPresence(config.REDIS_URL) : undefined;
if (presence) {
  bridgeEmitter("vehicle", vehicleEvents);
  bridgeEmitter("profile", profileEvents);
  bridgeEmitter("safety", safetyEvents);
  bridgeEmitter("building", buildingEvents);
  await joinCluster(presence);
}

await refreshPlotFootprints();

const gameServer = defineServer({
  ...(presence && {
    presence,
    driver: new RedisDriver(config.REDIS_URL),
    ...(config.PUBLIC_ADDRESS && { publicAddress: config.PUBLIC_ADDRESS }),
  }),
  rooms: {
    lagos: defineRoom(LagosRoom),
  },
  express: (app) => {
    app.use(express.json({ limit: "32kb" }));
    configureRoutes(app as express.Express);
  },
});

const purgeChat = () =>
  void purgeExpiredChat()
    .then((removed) => removed && console.log(`Removed ${removed} chat messages past retention`))
    .catch((error) => console.error("Chat retention purge failed", error));
purgeChat();
setInterval(purgeChat, 6 * 3_600_000).unref();
setInterval(() => void purgeExpiredRates().catch((error) => console.error("Rate-limit purge failed", error)), 3_600_000).unref();

await gameServer.listen(config.PORT);
console.log(`Lagos Living server listening on ${config.BETTER_AUTH_URL}`);
