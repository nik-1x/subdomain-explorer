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
import { discoverSubdomains, type DiscoveryResult } from '../lib/crtname';
import { isValidDomain, normalizeDomain } from '../lib/domain';
import { useLazyPings } from '../lib/useLazyPings';
import { bindBackButton, haptic, notify } from '../lib/telegram';
import { SubdomainRow } from '../components/SubdomainRow';
import './ResultsPage.css';

type Filter = 'all' | 'alive' | 'dead';
const PAGE_SIZE = 40;

export function ResultsPage() {
  const { domain = '' } = useParams();
  const navigate = useNavigate();
  const apex = useMemo(() => normalizeDomain(decodeURIComponent(domain)), [domain]);

  const [data, setData] = useState<DiscoveryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [filter, setFilter] = useState<Filter>('all');
  const [visible, setVisible] = useState(PAGE_SIZE);

  const hosts = useMemo(() => data?.hosts ?? [], [data]);
  const { results, observe, retry, stats } = useLazyPings(hosts);

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
        setError(failure instanceof Error ? failure.message : String(failure));
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

  if (loading) {
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

  if (data && hosts.length === 0) {
    return (
      <div className="results">
        <Header apex={apex} onBack={() => navigate('/')} subtitle={`no records · ${data.source}`} />
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

  if (error) {
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
        subtitle={`${hosts.length} unique names · ${data?.source ?? ''}`}
      />

      <div className="results__toolbar">
        <SegmentedControl>
          {(['all', 'alive', 'dead'] as Filter[]).map((value) => (
            <SegmentedControl.Item
              key={value}
              selected={filter === value}
              onClick={() => {
                haptic();
                setFilter(value);
                setVisible(PAGE_SIZE);
              }}
            >
              {value === 'all' ? `All ${hosts.length}` : value === 'alive' ? `Live ${stats.alive}` : `Dead ${stats.dead}`}
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
              ? 'Names come from crt.name. Each one is resolved over DNS-over-HTTPS as its row scrolls into view — tap a row to open it.'
              : 'Only hosts already resolved are counted here — keep scrolling the All tab to check more.'
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
                onRetry={() => retry(host)}
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

      {data?.notes.length ? (
        <div className="results__notes">
          <Text className="results__notes-title">Transport fallbacks</Text>
          {data.notes.map((note) => (
            <Caption level="2" key={note} Component="p">
              {note}
            </Caption>
          ))}
        </div>
      ) : null}
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
