import { Spinner } from '@telegram-apps/telegram-ui';
import type { PingResult } from '../lib/dns';
import './StatusPill.css';

const LABELS: Record<PingResult['state'], string> = {
  idle: 'queued',
  checking: 'checking',
  alive: 'live',
  dead: 'dead',
  error: 'retry',
};

/** Compact right-hand status for a subdomain row. */
export function StatusPill({ result, onRetry }: { result: PingResult; onRetry: () => void }) {
  if (result.state === 'checking') {
    return (
      <span className="status-pill status-pill--checking">
        <Spinner size="s" />
      </span>
    );
  }

  const interactive = result.state === 'error';
  return (
    <button
      type="button"
      className={`status-pill status-pill--${result.state}`}
      onClick={interactive ? onRetry : undefined}
      disabled={!interactive}
      title={result.detail ?? result.address ?? result.cname ?? ''}
    >
      <span className="status-pill__dot" />
      {LABELS[result.state]}
      {result.ms !== undefined && result.state === 'alive' ? (
        <span className="status-pill__ms">{result.ms}ms</span>
      ) : null}
    </button>
  );
}
