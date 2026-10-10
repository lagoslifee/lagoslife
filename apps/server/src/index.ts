import { defineRoom, defineServer } from "@colyseus/core";
import express from "express";
import { config } from "./config.js";
import { LagosRoom } from "./rooms/LagosRoom.js";
import { configureRoutes } from "./routes.js";

const gameServer = defineServer({
  rooms: {
    lagos: defineRoom(LagosRoom),
  },
  express: (app) => {
    app.use(express.json({ limit: "32kb" }));
    configureRoutes(app as express.Express);
  },
});

await gameServer.listen(config.PORT);
console.log(`Lagos Living server listening on ${config.BETTER_AUTH_URL}`);
