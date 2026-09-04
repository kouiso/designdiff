import { StrictMode } from "react";

import "@fontsource-variable/hanken-grotesk";
import "@fontsource-variable/jetbrains-mono";
import "@fontsource-variable/noto-sans-jp";
import { createRoot } from "react-dom/client";

import { App } from "./app";
import "./i18n";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
