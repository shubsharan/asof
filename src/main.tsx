import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./components/App";

// Reuse the root across hot reloads.
(import.meta.hot.data.root ??= createRoot(document.getElementById("root")!)).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
