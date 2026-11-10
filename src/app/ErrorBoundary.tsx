import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ru } from './i18n';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Unhandled UI error', error, info);
  }

  override render(): ReactNode {
    if (this.state.error) {
      return (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            height: '100%',
            padding: 32,
            textAlign: 'center',
          }}
        >
          <div style={{ fontWeight: 650 }}>{ru.editor.crashTitle}</div>
          <div style={{ color: 'var(--muted)', fontSize: 13 }}>{ru.editor.crashHint}</div>
          <button type="button" className="btn" onClick={() => window.location.reload()}>
            {ru.editor.reload}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
