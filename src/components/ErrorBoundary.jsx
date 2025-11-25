import React from 'react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, info: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    this.setState({ error, info });
    try { window._lastError = error; } catch (e) {}
    if (window && typeof window._diagnosticAppend === 'function') {
      try { window._diagnosticAppend('[ErrorBoundary] ' + (error && error.message)); } catch (e) {}
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        React.createElement('div', { style: { padding: 20, color: '#fff', background: 'rgba(10,14,39,0.98)', minHeight: '100vh' } },
          React.createElement('h2', null, 'Se produjo un error en la aplicación'),
          React.createElement('pre', { style: { whiteSpace: 'pre-wrap', color: '#e6eef8' } }, String(this.state.error && this.state.error.stack || this.state.error && this.state.error.message || this.state.error))
        )
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
