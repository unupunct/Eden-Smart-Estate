import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  onHome: () => void
}

/** Keeps a bug in one page from blanking the whole app: the menu stays usable and the data is untouched (it is saved on the server). */
export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('EDEN page crashed:', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="emptystate" role="alert">
        <h2>Something went wrong on this page</h2>
        <p>Your estate is stored on the server and was not changed by this error. Reloading usually fixes it.</p>
        <pre className="errtext">{this.state.error.message}</pre>
        <div className="btnrow">
          <button className="primary" onClick={() => location.reload()}>Reload</button>
          <button onClick={() => { this.setState({ error: null }); this.props.onHome() }}>Back to the overview</button>
        </div>
        <small>If it keeps happening, please report it with the message above (see docs/TROUBLESHOOTING.md).</small>
      </div>
    )
  }
}
