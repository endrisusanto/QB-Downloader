import { Component, type ErrorInfo, type ReactNode } from "react";

export class AppErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error(error, info.componentStack); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="app-shell">
        <section className="content-area">
          <div className="empty-state compact app-error">
            <img src="/quickbuild-logo.svg" alt="" />
            <h1>App render error</h1>
            <p>{this.state.error.message}</p>
            <button className="primary-button" onClick={() => window.location.reload()}>Reload</button>
          </div>
        </section>
      </main>
    );
  }
}
