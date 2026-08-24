import { Cell } from '@telegram-apps/telegram-ui';
import type { Ref } from 'react';
import type { PingResult } from '../lib/dns';
import { haptic, openExternal } from '../lib/telegram';
import { StatusPill } from './StatusPill';

interface Props {
  host: string;
  result: PingResult;
  observeRef: Ref<HTMLDivElement>;
  onRetry: () => void;
}

function subtitleFor(result: PingResult): string | undefined {
  switch (result.state) {
    case 'alive':
      if (result.address) {
        const extra = (result.addressCount ?? 1) > 1 ? ` +${(result.addressCount ?? 1) - 1}` : '';
        return `${result.address}${extra}${result.cname ? ` · ${result.cname}` : ''}`;
      }
      return result.cname ? `CNAME → ${result.cname}` : undefined;
    case 'dead':
      return result.detail;
    case 'error':
      return `lookup failed · tap to retry`;
    case 'checking':
      return 'resolving…';
    default:
      return undefined;
  }
}

/** One discovered host. Registers itself with the IntersectionObserver via `observeRef`. */
export function SubdomainRow({ host, result, observeRef, onRetry }: Props) {
  return (
    <div ref={observeRef}>
      <Cell
        multiline
        subtitle={subtitleFor(result)}
        after={<StatusPill result={result} onRetry={onRetry} />}
        onClick={() => {
          haptic();
          openExternal(`https://${host}`);
        }}
      >
        {host}
      </Cell>
    </div>
  );
}
