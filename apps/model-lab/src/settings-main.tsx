import React from "react";
import { createRoot } from "react-dom/client";
import { SettingsApp } from "./settings/SettingsApp.js";
import "./settings/styles.css";

createRoot(document.getElementById("settings-root")!).render(
  <React.StrictMode>
    <SettingsApp />
  </React.StrictMode>
);
