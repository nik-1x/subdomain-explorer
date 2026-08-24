import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Button,
  Caption,
  Cell,
  List,
  Placeholder,
  Section,
  SegmentedControl,
  Skeleton,
  Spinner,
  Text,
} from '@telegram-apps/telegram-ui';
import { DiscoveryBlockedError, discoverSubdomains, type DiscoveryResult } from '../lib/crtname';
import { isValidDomain, normalizeDomain } from '../lib/domain';
import { useLazyPings } from '../lib/useLazyPings';
import { bindBackButton, haptic, notify } from '../lib/telegram';
import { SubdomainRow } from '../components/SubdomainRow';
import { Handoff } from '../components/Handoff';
import './ResultsPage.css';

type Filter = 'all' | 'online' | 'offline';
const PAGE_SIZE = 40;

export function ResultsPage() {
  const { domain = '' } = useParams();
  const navigate = useNavigate();
  const apex = useMemo(() => normalizeDomain(decodeURIComponent(domain)), [domain]);

  const [data, setData] = useState<DiscoveryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Set when the direct fetch is blocked and the user has to run the query. */
  const [blocked, setBlocked] = useState<string | null>(null);
  /** Hosts pasted back from a user-run request.  */
  const [pasted, setPasted] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [filter, setFilter] = useState<Filter>('all');
  const [visible, setVisible] = useState(PAGE_SIZE);

  const hosts = useMemo(() => pasted ?? data?.hosts ?? [], [pasted, data]);
  const { results, observe, stats } = useLazyPings(hosts);

  useEffect(() => bindBackButton(() => navigate('/')), [navigate]);

  useEffect(() => {
    if (!isValidDomain(apex)) {
      setLoading(false);
      setError(`"${apex}" is not a valid domain.`);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setBlocked(null);
    setPasted(null);
    setData(null);
    setVisible(PAGE_SIZE);

    discoverSubdomains(apex, controller.signal).then(
      (result) => {
        if (controller.signal.aborted) return;
        setData(result);
        setLoading(false);
        notify('success');
      },
      (failure: unknown) => {
        if (controller.signal.aborted) return;
        const message = failure instanceof Error ? failure.message : String(failure);
        // A blocked request is not a dead end — the user can run it instead.
        if (failure instanceof DiscoveryBlockedError) setBlocked(message);
        else setError(message);
        setLoading(false);
        notify('error');
      },
    );
    return () => controller.abort();
  }, [apex, attempt]);

  const filtered = useMemo(() => {
    if (filter === 'all') return hosts;
    return hosts.filter((host) => results[host]?.state === filter);
  }, [hosts, filter, results]);

  const shown = filtered.slice(0, visible);

  // Sentinel at the end of the rendered slice: reveals the next page of rows,
  // which in turn schedules their DNS lookups.
  const sentinel = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = sentinel.current;
    if (!node) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible((current) => Math.min(current + PAGE_SIZE, filtered.length));
        }
      },
      { rootMargin: '400px 0px' },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [filtered.length, shown.length]);

  if (loading && !pasted) {
    return (
      <div className="results">
        <Header apex={apex} onBack={() => navigate('/')} subtitle="Searching crt.name…" />
        <List>
          <Section>
            {Array.from({ length: 6 }, (_, index) => (
              <Skeleton visible key={index}>
                <Cell subtitle="resolving…">{' '.repeat(18)}</Cell>
              </Skeleton>
            ))}
          </Section>
        </List>
      </div>
    );
  }

  if (blocked && !pasted) {
    return (
      <div className="results">
        <Header apex={apex} onBack={() => navigate('/')} subtitle={blocked} />
        <Handoff
          apex={apex}
          onHosts={(hosts) => {
            setPasted(hosts);
            setBlocked(null);
          }}
          onRetry={() => setAttempt((value) => value + 1)}
        />
      </div>
    );
  }

  if (data && !pasted && hosts.length === 0) {
    return (
      <div className="results">
        <Header apex={apex} onBack={() => navigate('/')} subtitle="no records on crt.name" />
        <Placeholder
          header="No subdomains found"
          description={`crt.name has no certificates on record for ${apex}.`}
          action={
            <Button size="m" onClick={() => navigate('/')}>
              New search
            </Button>
          }
        >
          <div className="results__emoji" aria-hidden>
            🕳️
          </div>
        </Placeholder>
      </div>
    );
  }

  if (error && !pasted) {
    return (
      <div className="results">
        <Header apex={apex} onBack={() => navigate('/')} />
        <Placeholder
          header="crt.name did not answer"
          description={error}
          action={
            <div className="results__actions">
              <Button size="m" onClick={() => setAttempt((value) => value + 1)}>
                Try again
              </Button>
              <Button size="m" mode="plain" onClick={() => navigate('/')}>
                New search
              </Button>
            </div>
          }
        >
          <div className="results__emoji" aria-hidden>
            🛰️
          </div>
        </Placeholder>
      </div>
    );
  }

  return (
    <div className="results">
      <Header
        apex={apex}
        onBack={() => navigate('/')}
        subtitle={`${hosts.length} names${pasted ? ' · pasted' : ''} from crt.name`}
      />

      <div className="results__toolbar">
        <SegmentedControl>
          {(['all', 'online', 'offline'] as Filter[]).map((value) => (
            <SegmentedControl.Item
              key={value}
              selected={filter === value}
              onClick={() => {
                haptic();
                setFilter(value);
                setVisible(PAGE_SIZE);
              }}
            >
              {value === 'all'
                ? `All ${hosts.length}`
                : value === 'online'
                  ? `Online ${stats.online}`
                  : `Offline ${stats.offline}`}
            </SegmentedControl.Item>
          ))}
        </SegmentedControl>
        <Caption level="2" className="results__progress">
          {stats.checked} of {hosts.length} checked
        </Caption>
      </div>

      <List>
        <Section
          footer={
            filter === 'all'
              ? 'Each name is resolved over DNS-over-HTTPS as its row scrolls into view; no answer within 3s counts as offline. Tap a row to open it.'
              : 'Only names already checked appear here — keep scrolling the All tab to check more.'
          }
        >
          {shown.length === 0 ? (
            <Cell multiline subtitle="Scroll the All tab to resolve more hosts.">
              Nothing here yet
            </Cell>
          ) : (
            shown.map((host) => (
              <SubdomainRow
                key={host}
                host={host}
                result={results[host] ?? { state: 'idle' }}
                observeRef={observe(host)}
              />
            ))
          )}
        </Section>
      </List>

      {shown.length < filtered.length ? (
        <div className="results__sentinel" ref={sentinel}>
          <Spinner size="s" />
          <Caption level="2">{filtered.length - shown.length} more</Caption>
        </div>
      ) : (
        <div className="results__end">
          <Caption level="2">End of list</Caption>
        </div>
      )}

    </div>
  );
}

function Header({ apex, subtitle, onBack }: { apex: string; subtitle?: string; onBack: () => void }) {
  return (
    <div className="results__header">
      <button type="button" className="results__back" onClick={onBack} aria-label="Back to search">
        ‹
      </button>
      <div className="results__heading">
        <Text weight="2" className="results__domain">
          {apex}
        </Text>
        {subtitle ? (
          <Caption level="2" className="results__subtitle">
            {subtitle}
          </Caption>
        ) : null}
      </div>
    </div>
  );
}
