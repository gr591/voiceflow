import React from "react";
import { ConfigProvider, useConfig } from "./config/ConfigContext";
import { useTheme } from "./hooks/useTheme";
import { Overlay } from "./components/Overlay";
import "./global.css";

function ThemedApp() {
  const { config } = useConfig();
  const theme = useTheme(config.theme);

  return (
    <div
      className={`w-screen h-screen ${theme === "dark" ? "dark" : ""}`}
      data-theme={theme}
      style={{ background: "transparent" }}
    >
      <Overlay />
    </div>
  );
}

export default function App() {
  return (
    <ConfigProvider>
      <ThemedApp />
    </ConfigProvider>
  );
}
