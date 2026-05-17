import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import ErrorBoundary from "./ErrorBoundary";
import { webApi, resolveDirectory } from "./web-api";
import "./App.scss";

// WebUI mode: inject fetch-based API when not in Electron
if (!window.electronAPI) {
  window.electronAPI = webApi;

  // Listen for directory path submitted via the welcome UI
  window.addEventListener("message", (event) => {
    if (event.data?.type === "select-directory-webui") {
      resolveDirectory(event.data.path);
    }
  });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
