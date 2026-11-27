// Sortable table headers for the site research tables.
import { useState } from 'react';

export interface SortState<K extends string> {
  key: K;
  asc: boolean;
}

/** Sort state with a header factory; a text column sorts A-Z first, a number column highest first. */
export function useSort<K extends string>(initial: SortState<K>, textKeys: K[]) {
  const [sort, setSort] = useState(initial);
  const th = (key: K, label: string, className = '') => (
    <th
      className={`sortable ${className}`}
      onClick={() => setSort((s) => ({ key, asc: s.key === key ? !s.asc : textKeys.includes(key) }))}
    >
      {label}
      {sort.key === key ? (sort.asc ? ' ▲' : ' ▼') : ''}
    </th>
  );
  return { sort, th };
}

/** A sorted copy; empty values ('' or undefined) always last. */
export function sortRows<T>(rows: T[], value: (row: T) => string | number | undefined, asc: boolean): T[] {
  return [...rows].sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    const emptyA = va === undefined || va === '';
    const emptyB = vb === undefined || vb === '';
    if (emptyA || emptyB) return emptyA === emptyB ? 0 : emptyA ? 1 : -1;
    const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb));
    return asc ? cmp : -cmp;
  });
}

export function ExternalLink({ url, label }: { url: string; label?: string }) {
  return (
    <a className="ext-link" href={url} target="_blank" rel="noreferrer" title={url} onClick={(e) => e.stopPropagation()}>
      {label ?? url}
    </a>
  );
}
