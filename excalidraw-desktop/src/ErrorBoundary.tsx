import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            color: "#e06c75",
            fontSize: 14,
            background: "#121212",
            height: "100vh",
            padding: 40,
            fontFamily: "monospace",
          }}
        >
          <h2 style={{ color: "#fff", marginBottom: 12 }}>应用出错</h2>
          <pre
            style={{
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              maxWidth: 600,
              background: "#1e1e1e",
              padding: 16,
              borderRadius: 8,
            }}
          >
            {this.state.error?.message || "未知错误"}
          </pre>
          <button
            onClick={() => {
              this.setState({ hasError: false, error: null });
              window.location.reload();
            }}
            style={{
              marginTop: 20,
              padding: "8px 24px",
              cursor: "pointer",
              background: "#3b82f6",
              color: "#fff",
              border: "none",
              borderRadius: 4,
            }}
          >
            重新加载
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
