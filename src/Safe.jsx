import React, { Suspense } from 'react';

// Keeps one broken panel from taking down the whole app, and shows a tiny
// loader while a panel's code downloads (panels load only when first opened).
class Boundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error(`[${this.props.name}]`, error, info?.componentStack);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="safe-err" role="alert">
        <b>{this.props.name} hit a problem.</b>
        <span>{String(this.state.error?.message || this.state.error).slice(0, 140)}</span>
        <div>
          <button className="btn-green sm" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
          {this.props.onClose && (
            <button className="btn-ghost sm" onClick={this.props.onClose}>
              Close
            </button>
          )}
        </div>
      </div>
    );
  }
}

export default function Safe({ name, onClose, children, quiet = false }) {
  return (
    <Boundary name={name} onClose={onClose}>
      <Suspense fallback={quiet ? null : <div className="safe-loading">Loading {name}…</div>}>{children}</Suspense>
    </Boundary>
  );
}
