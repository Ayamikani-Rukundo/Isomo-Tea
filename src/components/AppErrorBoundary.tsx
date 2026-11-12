import { Component, type ErrorInfo, type ReactNode } from 'react'

type AppErrorBoundaryProps = { children: ReactNode }
type AppErrorBoundaryState = { error: Error | null }

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Isomo Tea encountered a rendering error.', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <main className="app-error-boundary" role="alert">
          <strong>Isomo Tea hit an unexpected error.</strong>
          <p>Your account data remains on the server. Reload the app to try again.</p>
          <button onClick={() => window.location.reload()} type="button">Reload app</button>
        </main>
      )
    }
    return this.props.children
  }
}
