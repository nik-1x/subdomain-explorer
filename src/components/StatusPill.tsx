import { Spinner } from '@telegram-apps/telegram-ui';
import type { PingResult } from '../lib/dns';
import './StatusPill.css';

const LABELS: Record<PingResult['state'], string> = {
  idle: 'queued',
  checking: 'checking',
  online: 'online',
  offline: 'offline',
};

/** Compact right-hand status for a subdomain row. */
export function StatusPill({ result }: { result: PingResult }) {
  if (result.state === 'checking') {
    return (
      <span className="status-pill status-pill--checking">
        <Spinner size="s" />
      </span>
    );
  }

  return (
    <span className={`status-pill status-pill--${result.state}`}>
      <span className="status-pill__dot" />
      {LABELS[result.state]}
      {result.state === 'online' && result.ms !== undefined ? (
        <span className="status-pill__ms">{result.ms}ms</span>
      ) : null}
    </span>
  );
}
