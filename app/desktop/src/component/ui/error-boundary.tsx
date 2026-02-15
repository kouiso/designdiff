import { Component, type ErrorInfo, type ReactNode } from "react";

import i18next from "i18next";

import { Button } from "./button";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary caught:", error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  override render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-screen flex-col items-center justify-center gap-4 bg-background p-8 text-foreground">
          <h1 className="font-bold text-2xl">{i18next.t("common.error")}</h1>
          <p className="max-w-md text-center text-muted-foreground text-sm">
            {this.state.error?.message}
          </p>
          <Button onClick={this.handleReset}>{i18next.t("common.reset")}</Button>
        </div>
      );
    }
    return this.props.children;
  }
}
