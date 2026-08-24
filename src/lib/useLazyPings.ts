import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PingQueue, pingHost, type PingResult } from './dns';

/**
 * Resolves hosts only once their row actually scrolls into view, keeping the
 * first paint instant even for domains with thousands of certificates.
 */
export function useLazyPings(hosts: string[]) {
  const [results, setResults] = useState<Record<string, PingResult>>({});
  const queue = useMemo(() => new PingQueue(6), []);
  const requested = useRef(new Set<string>());
  const abort = useRef<AbortController>();
  const observer = useRef<IntersectionObserver>();
  const elements = useRef(new Map<string, Element>());

  // A new search invalidates everything in flight.
  useEffect(() => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    requested.current = new Set();
    setResults({});
    return () => controller.abort();
  }, [hosts]);

  const ping = useCallback(
    (host: string) => {
      if (requested.current.has(host)) return;
      requested.current.add(host);
      const controller = abort.current;
      setResults((prev) => ({ ...prev, [host]: { state: 'checking' } }));
      queue
        .run(() => pingHost(host, controller?.signal))
        .then(
          (result) => {
            if (controller?.signal.aborted) return;
            setResults((prev) => ({ ...prev, [host]: result }));
          },
          (error: unknown) => {
            if (controller?.signal.aborted) return;
            requested.current.delete(host);
            setResults((prev) => ({
              ...prev,
              [host]: { state: 'error', detail: error instanceof Error ? error.message : 'failed' },
            }));
          },
        );
    },
    [queue],
  );

  // `rootMargin` starts the lookup slightly before the row is on screen, so a
  // result is usually there by the time the user reads the name.
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const host = (entry.target as HTMLElement).dataset.host;
          if (!host) continue;
          io.unobserve(entry.target);
          elements.current.delete(host);
          ping(host);
        }
      },
      { rootMargin: '250px 0px' },
    );
    observer.current = io;
    for (const element of elements.current.values()) io.observe(element);
    return () => {
      io.disconnect();
      observer.current = undefined;
    };
  }, [ping, hosts]);

  /** Ref callback for a row: hands its element to the observer. */
  const observe = useCallback((host: string) => (element: HTMLElement | null) => {
    const previous = elements.current.get(host);
    if (previous && previous !== element) observer.current?.unobserve(previous);
    if (!element) {
      elements.current.delete(host);
      return;
    }
    if (requested.current.has(host)) return;
    element.dataset.host = host;
    elements.current.set(host, element);
    observer.current?.observe(element);
  }, []);

  const retry = useCallback(
    (host: string) => {
      requested.current.delete(host);
      ping(host);
    },
    [ping],
  );

  const stats = useMemo(() => {
    let alive = 0;
    let dead = 0;
    let checked = 0;
    for (const host of hosts) {
      const state = results[host]?.state;
      if (state === 'alive') { alive += 1; checked += 1; }
      else if (state === 'dead') { dead += 1; checked += 1; }
    }
    return { alive, dead, checked };
  }, [hosts, results]);

  return { results, observe, retry, stats };
}
