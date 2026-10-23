import "./polyfills";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { findServer } from "./auth-client";
import { installDiagnostics } from "./diagnostics";
import "./styles.css";

installDiagnostics();

// Start on a game server that answers (the live address or its standby), but never hold the page up for long.
await Promise.race([findServer(), new Promise((resolve) => setTimeout(resolve, 6000))]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
