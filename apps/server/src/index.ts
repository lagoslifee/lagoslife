import { defineRoom, defineServer, Room } from "colyseus";
import express from "express";
import { config } from "./config.js";
import { configureRoutes } from "./routes.js";

class LagosRoom extends Room {
  maxClients = 32;
}

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
