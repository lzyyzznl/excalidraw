import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import ErrorBoundary from "./ErrorBoundary";
import WebUIOffline from "./components/WebUIOffline";
import "./App.scss";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <WebUIOffline>
        <App />
      </WebUIOffline>
    </ErrorBoundary>
  </React.StrictMode>,
);
