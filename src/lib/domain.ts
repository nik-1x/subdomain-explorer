/** Normalisation and validation for whatever the user types into the search field. */

const DOMAIN_RE = /^(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/;

/** Strips scheme, credentials, path, port and trailing dots from a user-typed value. */
export function normalizeDomain(raw: string): string {
  let value = raw.trim().toLowerCase();
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  value = value.replace(/^[^/@]*@/, '');
  value = value.split(/[/?#]/)[0];
  value = value.split(':')[0];
  value = value.replace(/^\*\./, '');
  value = value.replace(/\.+$/, '');
  return value;
}

export function isValidDomain(value: string): boolean {
  return DOMAIN_RE.test(value);
}

/** `api.eu.example.com` relative to `example.com` -> `api.eu` (used for sorting by depth). */
export function labelDepth(host: string, apex: string): number {
  if (host === apex) return 0;
  return host.slice(0, -(apex.length + 1)).split('.').length;
}

/** Sort: apex first, then shallow names, then alphabetically by reversed labels. */
export function sortHosts(hosts: string[], apex: string): string[] {
  return [...hosts].sort((a, b) => {
    const depthDiff = labelDepth(a, apex) - labelDepth(b, apex);
    if (depthDiff !== 0) return depthDiff;
    return a.localeCompare(b);
  });
}
