import catalog from './sponsored-actions.json';

const byName = new Map(catalog.map((entry) => [entry.name, entry.selector]));
const bySelector = new Map(
  catalog.map((entry) => [entry.selector.toLowerCase(), entry.name]),
);

/** Selector for a catalogued sponsored call. */
export function sponsoredActionSelector(name: string): `0x${string}` {
  const selector = byName.get(name);
  if (!selector || !/^0x[0-9a-fA-F]{8}$/.test(selector)) {
    throw new Error(`Unknown sponsored action: ${name}`);
  }
  return selector as `0x${string}`;
}

/** Function name for a 4-byte selector, if this app sponsors that call. */
export function sponsoredActionName(selector: string): string | null {
  return bySelector.get(selector.trim().toLowerCase()) ?? null;
}
