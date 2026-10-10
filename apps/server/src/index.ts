import { defineRoom, defineServer } from "@colyseus/core";
import express from "express";
import { config } from "./config.js";
import { LagosRoom } from "./rooms/LagosRoom.js";
import { configureRoutes } from "./routes.js";
import { purgeExpiredChat } from "./safety-service.js";

const gameServer = defineServer({
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

await gameServer.listen(config.PORT);
console.log(`Lagos Living server listening on ${config.BETTER_AUTH_URL}`);
