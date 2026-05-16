// excalidraw-desktop/src/components/WebUIOffline.tsx
import { useState, useEffect } from "react";

interface WebUIOfflineProps {
  children: React.ReactNode;
}

export default function WebUIOffline({ children }: WebUIOfflineProps) {
  const [status, setStatus] = useState<"loading" | "online" | "offline">("loading");

  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 2000);

        const res = await fetch("/api/health", { signal: controller.signal });
        clearTimeout(timeout);

        if (!cancelled) {
          setStatus(res.ok ? "online" : "offline");
        }
      } catch {
        if (!cancelled) {
          setStatus("offline");
        }
      }
    }

    if (typeof window.electronAPI === "undefined") {
      check();
    } else {
      setStatus("online");
    }

    return () => { cancelled = true; };
  }, []);

  if (status === "loading") {
    return (
      <div style={{
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#121212",
        color: "#888",
        fontSize: 14,
      }}>
        正在连接 Excalidraw Desktop 服务...
      </div>
    );
  }

  if (status === "offline") {
    return (
      <div style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "#121212",
        color: "#ccc",
        gap: 20,
      }}>
        <h1 style={{ fontSize: 22, color: "#fff", fontWeight: 600 }}>
          Excalidraw Desktop
        </h1>
        <p style={{ fontSize: 14, color: "#888", textAlign: "center", maxWidth: 360, lineHeight: 1.5 }}>
          WebUI 需要 Excalidraw Desktop 桌面应用正在运行。
          <br />
          请先启动桌面应用，然后在浏览器中刷新此页面。
        </p>
        <button
          onClick={() => window.location.reload()}
          style={{
            background: "#4a6cf7",
            border: "none",
            color: "#fff",
            fontSize: 14,
            padding: "10px 28px",
            borderRadius: 8,
            cursor: "pointer",
          }}
        >
          重试
        </button>
      </div>
    );
  }

  return <>{children}</>;
}
