import { Component, type ErrorInfo, type ReactNode } from "react";
import i18n from "../i18n.js";

type ErrorBoundaryProps = {
  children: ReactNode;
};

type ErrorBoundaryState = {
  error: Error | null;
};

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Unhandled UI error:", error, info.componentStack);
  }

  private handleReset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    if (this.state.error) {
      return (
        <main className="errorBoundaryFallback">
          <div className="errorBoundaryCard">
            <h1>{i18n.t("error.boundaryTitle")}</h1>
            <p>{i18n.t("error.boundaryBody")}</p>
            <pre className="errorBoundaryDetail">{this.state.error.message}</pre>
            <div className="errorBoundaryActions">
              <button className="primary" type="button" onClick={this.handleReset}>
                {i18n.t("common.reset")}
              </button>
              <button
                className="ghostButton"
                type="button"
                onClick={() => window.location.reload()}
              >
                {i18n.t("common.refresh")}
              </button>
            </div>
          </div>
        </main>
      );
    }
    return this.props.children;
  }
}
