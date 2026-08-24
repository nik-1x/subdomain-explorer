import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PingQueue, pingHost, type PingResult } from './dns';

/**
 * Resolves hosts only once their row actually scrolls into view, keeping the
 * first paint instant even for domains with thousands of certificates.
 */
export function useLazyPings(hosts: string[]) {
  const [results, setResults] = useState<Record<string, PingResult>>({});
  // Counted as results land rather than by scanning `hosts`: an apex can carry
  // tens of thousands of names and this updates on every completed lookup.
  const [stats, setStats] = useState({ online: 0, offline: 0, checked: 0 });
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
    setStats({ online: 0, offline: 0, checked: 0 });
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
            setStats((prev) => ({
              online: prev.online + (result.state === 'online' ? 1 : 0),
              offline: prev.offline + (result.state === 'online' ? 0 : 1),
              checked: prev.checked + 1,
            }));
          },
          () => {
            // pingHost only rejects when the search was replaced mid-flight.
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

  return { results, observe, stats };
}
