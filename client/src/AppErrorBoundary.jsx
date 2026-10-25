import React from "react";
import { useLocation } from "react-router-dom";
import { translateUiText } from "./i18n.js";
export class AppErrorBoundary extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidUpdate(previous) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) this.setState({ failed: false });
  }
  componentDidCatch() {
    // Exceptions and component stacks can contain patient values. Never log them.
    console.error("The interface could not be rendered.");
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return <main className="page"><section className="card" role="alert">
      <h1>{translateUiText("This screen could not be displayed")}</h1>
      <p>{translateUiText("Your last action may already have completed. Check its status before submitting it again.")}</p>
      <button type="button" className="primary" onClick={() => this.setState({ failed: false })}>{translateUiText("Try displaying this screen again")}</button>
      <button type="button" className="ghost" onClick={() => window.location.reload()}>{translateUiText("Reload page")}</button>
    </section></main>;
  }
}
export function RouteRecoveryBoundary({ children }) {
  const location = useLocation();
  return <AppErrorBoundary resetKey={location.pathname}>{children}</AppErrorBoundary>;
}
