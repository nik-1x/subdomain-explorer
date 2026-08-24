import { Cell } from '@telegram-apps/telegram-ui';
import type { Ref } from 'react';
import type { PingResult } from '../lib/dns';
import { haptic, openExternal } from '../lib/telegram';
import { StatusPill } from './StatusPill';

interface Props {
  host: string;
  result: PingResult;
  observeRef: Ref<HTMLDivElement>;
}

function subtitleFor(result: PingResult): string | undefined {
  if (result.state === 'checking') return 'resolving…';
  if (result.state !== 'online') return undefined;
  if (result.address) {
    const extra = (result.addressCount ?? 1) > 1 ? ` +${(result.addressCount ?? 1) - 1}` : '';
    return `${result.address}${extra}`;
  }
  return result.cname ? `CNAME → ${result.cname}` : undefined;
}

/** One discovered host. Registers itself with the IntersectionObserver via `observeRef`. */
export function SubdomainRow({ host, result, observeRef }: Props) {
  return (
    <div ref={observeRef}>
      <Cell
        multiline
        subtitle={subtitleFor(result)}
        after={<StatusPill result={result} />}
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
