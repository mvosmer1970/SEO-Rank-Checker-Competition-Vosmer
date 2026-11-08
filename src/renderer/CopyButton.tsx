// "Copy all" button: copies a table as tab-separated text, which pastes into Excel as cells.
import { useState } from 'react';

export type Cell = string | number | undefined;

/** A number in the format of the user's locale (as Excel reads it), without thousands separators. */
function formatCell(cell: Cell): string {
  if (cell === undefined) return '';
  if (typeof cell === 'number') return cell.toLocaleString(undefined, { useGrouping: false, maximumFractionDigits: 2 });
  // Tabs and line breaks would split the cell.
  return cell.replace(/[\t\r\n]+/g, ' ');
}

export function CopyButton({ headers, rows }: { headers: string[]; rows: Cell[][] }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  const copy = async () => {
    const text = [headers, ...rows].map((row) => row.map(formatCell).join('\t')).join('\r\n');
    try {
      await navigator.clipboard.writeText(text);
      setState('copied');
    } catch {
      setState('failed');
    }
    setTimeout(() => setState('idle'), 2000);
  };

  return (
    <button className="copy-button" title={`Copy ${rows.length} rows to the clipboard (paste into Excel)`} onClick={() => void copy()}>
      {state === 'copied' ? 'Copied ✓' : state === 'failed' ? 'Copy failed' : 'Copy all'}
    </button>
  );
}
