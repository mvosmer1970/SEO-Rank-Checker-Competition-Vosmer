// Dragging to resize, remembered in the browser storage of the app: the columns of every table (the edge between two
// header cells; a double click on it restores the automatic widths), the right-hand panel of the two-column layouts,
// and the sidebar.

const EDGE = 5;
const MIN_COLUMN = 40;
const SIDE_MIN = 300;
const MAIN_MIN = 400;
const SIDEBAR_MIN = 170;
const SIDEBAR_MAX = 480;

function read<T>(key: string): T | undefined {
  try {
    const value = localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : undefined;
  } catch {
    return undefined;
  }
}

function write(key: string, value: unknown): void {
  try {
    if (value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Without storage the widths are not remembered.
  }
}

// ---------------------------------------------------------------- columns

function headerCells(table: HTMLTableElement): HTMLTableCellElement[] {
  return [...table.querySelectorAll<HTMLTableCellElement>(':scope > thead > tr:first-child > th')];
}

/** The text of a header without sort arrows and the state of a Copy button. */
function labelOf(th: HTMLTableCellElement): string {
  return (th.textContent ?? '')
    .replace(/[▲▼]/g, '')
    .replace(/Copy all|Copied ✓|Copy failed/g, '')
    .trim();
}

/** Tables with the same headers share their widths (e.g. the same table of every project). */
function tableKey(table: HTMLTableElement): string {
  return `columns:${headerCells(table).map(labelOf).join('|')}`;
}

const applied = new WeakMap<HTMLTableElement, string>();

/** A column of numbers stays wide enough for a position like "41.3?" (no cut-off values). */
const MIN_NUMBER_COLUMN = 66;

function minWidth(th: HTMLTableCellElement): number {
  return th.classList.contains('num') ? MIN_NUMBER_COLUMN : MIN_COLUMN;
}

function setWidths(table: HTMLTableElement, widths: number[]): void {
  headerCells(table).forEach((th, i) => {
    th.style.width = `${Math.max(minWidth(th), widths[i] ?? th.offsetWidth)}px`;
  });
  table.style.tableLayout = 'fixed';
  table.classList.add('resized');
}

function clearWidths(table: HTMLTableElement): void {
  for (const th of headerCells(table)) th.style.width = '';
  table.style.tableLayout = '';
  table.classList.remove('resized');
}

/** Applies the remembered widths to a table whose headers are new or changed. */
function applyColumns(table: HTMLTableElement): void {
  const cells = headerCells(table);
  if (cells.length < 2) return;
  const key = tableKey(table);
  if (applied.get(table) === key) return;
  applied.set(table, key);
  const widths = read<number[]>(key);
  if (widths && widths.length === cells.length) setWidths(table, widths);
  else clearWidths(table);
}

function applyAll(): void {
  document.querySelectorAll<HTMLTableElement>('table.keywords').forEach(applyColumns);
}

/** The index of the header cell whose right edge is at x (not the last cell). */
function edgeAt(cells: HTMLTableCellElement[], x: number): number {
  return cells.findIndex((th, i) => i < cells.length - 1 && Math.abs(th.getBoundingClientRect().right - x) <= EDGE);
}

function tableAt(target: EventTarget | null): HTMLTableElement | undefined {
  const th = target instanceof Element ? target.closest('th') : null;
  const table = th?.closest('table');
  return table instanceof HTMLTableElement && table.classList.contains('keywords') && th?.parentElement?.parentElement?.tagName === 'THEAD'
    ? table
    : undefined;
}

/** A click that ends a drag must not sort the column. */
function swallowNextClick(): void {
  const stop = (e: Event) => {
    e.stopPropagation();
    e.preventDefault();
  };
  window.addEventListener('click', stop, { capture: true, once: true });
  setTimeout(() => window.removeEventListener('click', stop, { capture: true }), 0);
}

function startColumnDrag(e: MouseEvent): boolean {
  const table = tableAt(e.target);
  if (!table) return false;
  const cells = headerCells(table);
  const index = edgeAt(cells, e.clientX);
  if (index < 0) return false;

  // The boundary between two columns moves: the left one grows as much as the right one shrinks.
  const widths = cells.map((th) => th.getBoundingClientRect().width);
  setWidths(table, widths);
  const startX = e.clientX;
  const left = widths[index] ?? 0;
  const right = widths[index + 1] ?? 0;
  const leftCell = cells[index];
  const rightCell = cells[index + 1];
  const leftMin = leftCell ? minWidth(leftCell) : MIN_COLUMN;
  const rightMin = rightCell ? minWidth(rightCell) : MIN_COLUMN;
  let moved = false;
  document.body.classList.add('col-resizing');

  const move = (ev: MouseEvent) => {
    const dx = Math.max(Math.min(0, leftMin - left), Math.min(Math.max(0, right - rightMin), ev.clientX - startX));
    if (dx !== 0) moved = true;
    widths[index] = left + dx;
    widths[index + 1] = right - dx;
    setWidths(table, widths);
  };
  const up = () => {
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
    document.body.classList.remove('col-resizing');
    if (moved) swallowNextClick();
    write(tableKey(table), widths.map(Math.round));
    applied.set(table, tableKey(table));
  };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
  e.preventDefault();
  return true;
}

function resetColumns(e: MouseEvent): void {
  const table = tableAt(e.target);
  if (!table || edgeAt(headerCells(table), e.clientX) < 0) return;
  write(tableKey(table), undefined);
  clearWidths(table);
  e.preventDefault();
}

// ---------------------------------------------------------------- panels

function setPanelWidths(): void {
  const side = read<number>('panel:side');
  const sidebar = read<number>('panel:sidebar');
  const root = document.documentElement.style;
  if (side) root.setProperty('--side-width', `${side}px`);
  else root.removeProperty('--side-width');
  if (sidebar) root.setProperty('--sidebar-width', `${sidebar}px`);
  else root.removeProperty('--sidebar-width');
}

function dragPanel(e: MouseEvent, width: (x: number) => number, key: string, cssVar: string): void {
  document.body.classList.add('col-resizing');
  const move = (ev: MouseEvent) => {
    document.documentElement.style.setProperty(cssVar, `${Math.round(width(ev.clientX))}px`);
  };
  const up = (ev: MouseEvent) => {
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
    document.body.classList.remove('col-resizing');
    write(key, Math.round(width(ev.clientX)));
    swallowNextClick();
  };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
  e.preventDefault();
}

/** The handle of the right-hand panel is in the gap to its left (only when the layout has two columns). */
function startSideDrag(e: MouseEvent): boolean {
  const side = e.target instanceof Element ? e.target.closest<HTMLElement>('.side-column') : null;
  const layout = side?.parentElement;
  if (!side || !layout || e.clientX >= side.getBoundingClientRect().left) return false;
  if (getComputedStyle(layout).gridTemplateColumns.trim().split(/\s+/).length < 2) return false;
  const box = layout.getBoundingClientRect();
  dragPanel(e, (x) => Math.max(SIDE_MIN, Math.min(box.width - MAIN_MIN, box.right - x - 8)), 'panel:side', '--side-width');
  return true;
}

function startSidebarDrag(e: MouseEvent): boolean {
  const sidebar = e.target instanceof Element ? e.target.closest<HTMLElement>('.sidebar') : null;
  if (!sidebar || e.clientX < sidebar.getBoundingClientRect().right - EDGE) return false;
  const left = sidebar.getBoundingClientRect().left;
  dragPanel(e, (x) => Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, x - left)), 'panel:sidebar', '--sidebar-width');
  return true;
}

function resetPanel(e: MouseEvent): void {
  const target = e.target instanceof Element ? e.target : null;
  const side = target?.closest<HTMLElement>('.side-column');
  if (side && e.clientX < side.getBoundingClientRect().left) write('panel:side', undefined);
  else {
    const sidebar = target?.closest<HTMLElement>('.sidebar');
    if (!sidebar || e.clientX < sidebar.getBoundingClientRect().right - EDGE) return;
    write('panel:sidebar', undefined);
  }
  setPanelWidths();
}

// ---------------------------------------------------------------- install

export function installResizing(): void {
  setPanelWidths();
  window.addEventListener(
    'mousedown',
    (e) => {
      if (e.button !== 0) return;
      if (!startColumnDrag(e) && !startSideDrag(e)) startSidebarDrag(e);
    },
    { capture: true },
  );
  window.addEventListener('dblclick', (e) => {
    resetColumns(e);
    resetPanel(e);
  });
  // Tables appear and change with every view: apply the remembered widths to new ones.
  let scheduled = false;
  new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      applyAll();
    });
  }).observe(document.body, { childList: true, subtree: true, characterData: true });
  applyAll();
}
