import { createRoot } from "react-dom/client";
import "../src/styles.css";
import { GamesApp } from "../src/ui/games/GamesApp";
createRoot(document.getElementById("root")!).render(<aside className="phone" style={{ position: "static" }}><div className="phone-body"><GamesApp /></div></aside>);
setTimeout(() => ((window as unknown as { ready: boolean }).ready = true), 800);
