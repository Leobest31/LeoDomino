import { Component } from "react";
import { reportError } from "./client.js";
import { CrashFallback } from "./CrashFallback.jsx";

/**
 * Root render-crash boundary. Reports unexpected React failures and shows
 * a controlled recovery screen instead of a blank root.
 */
export class MonitoringErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { crashed: false };
    this.handleReload = this.handleReload.bind(this);
  }

  static getDerivedStateFromError() {
    return { crashed: true };
  }

  componentDidCatch(error, info) {
    reportError(error, {
      screen: "root",
      backendErrorCode: "REACT_RENDER_CRASH",
    });
    void info;
  }

  handleReload() {
    if (typeof window !== "undefined" && typeof window.location?.reload === "function") {
      window.location.reload();
      return;
    }
    this.setState({ crashed: false });
  }

  render() {
    if (this.state.crashed) {
      return <CrashFallback onReload={this.handleReload} />;
    }
    return this.props.children;
  }
}
