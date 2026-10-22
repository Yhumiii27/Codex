// Line-by-line differences between two texts (comparison of versions, point 14 of docs/reste-a-faire.md): Myers' O(ND)
// algorithm, the one of diff and git, on lines already normalised by lib/text-extract.ts. Bounded: beyond `maxEdits`
// lines added or removed, it stops and says the texts differ too much to be shown line by line; the lines shown are cut
// at `maxShown`. Pure; no 'server-only' (tests/unit/line-diff.test.ts).

export type DiffOp = ' ' | '+' | '-';
/** One line shown: kept (' '), added in the newer text ('+') or removed from the older ('-'), with its line numbers. */
export type DiffLine = { op: DiffOp; text: string; a: number | null; b: number | null };
/** Lines around a change: `skipped` lines kept unchanged before it, not shown. */
export type Hunk = { skipped: number; lines: DiffLine[] };

export type LineDiff =
  | { kind: 'same'; lines: number }
  | { kind: 'diff'; added: number; removed: number; hunks: Hunk[]; trailing: number; truncated: boolean }
  | { kind: 'too_different'; added: null; removed: null };

export type DiffLimits = { maxEdits: number; context: number; maxShown: number };
export const DIFF_LIMITS: DiffLimits = { maxEdits: 3_000, context: 2, maxShown: 2_000 };

/**
 * The edit script from `a` (older) to `b` (newer): for each step, '=' (same line), '-' (line of a removed), '+' (line of
 * b added). Null when more than `maxEdits` lines are added or removed.
 */
export function editScript(a: readonly string[], b: readonly string[], maxEdits: number): ('=' | '-' | '+')[] | null {
  // Lines as numbers: comparing them is then cheap.
  const ids = new Map<string, number>();
  const id = (l: string) => {
    let n = ids.get(l);
    if (n === undefined) ids.set(l, (n = ids.size));
    return n;
  };
  const A = Int32Array.from(a, id);
  const B = Int32Array.from(b, id);
  // Common start and end, outside the search.
  let pre = 0;
  while (pre < A.length && pre < B.length && A[pre] === B[pre]) pre++;
  let suf = 0;
  while (suf < A.length - pre && suf < B.length - pre && A[A.length - 1 - suf] === B[B.length - 1 - suf]) suf++;
  const x0 = A.subarray(pre, A.length - suf);
  const y0 = B.subarray(pre, B.length - suf);
  const N = x0.length, M = y0.length;
  const mid = middle(x0, y0, N, M, maxEdits);
  if (!mid) return null;
  return [...Array<'='>(pre).fill('='), ...mid, ...Array<'='>(suf).fill('=')];
}

function middle(A: Int32Array, B: Int32Array, N: number, M: number, maxEdits: number): ('=' | '-' | '+')[] | null {
  if (N === 0) return Array<'+'>(M).fill('+');
  if (M === 0) return Array<'-'>(N).fill('-');
  const limit = Math.min(N + M, maxEdits);
  // trace[d][k + d]: furthest x on diagonal k after d edits.
  const trace: Int32Array[] = [];
  let prev = new Int32Array(1);
  let found = -1;
  for (let d = 0; d <= limit && found < 0; d++) {
    const v = new Int32Array(2 * d + 1);
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (d === 0) x = 0;
      else if (k === -d || (k !== d && prev[k - 1 + d - 1] < prev[k + 1 + d - 1])) x = prev[k + 1 + d - 1];
      else x = prev[k - 1 + d - 1] + 1;
      let y = x - k;
      while (x < N && y < M && A[x] === B[y]) {
        x++;
        y++;
      }
      v[k + d] = x;
      if (x >= N && y >= M) {
        found = d;
        break;
      }
    }
    trace.push(v);
    prev = v;
  }
  if (found < 0) return null;
  const ops: ('=' | '-' | '+')[] = [];
  let x = N, y = M;
  for (let d = found; d > 0; d--) {
    const p = trace[d - 1];
    const k = x - y;
    const down = k === -d || (k !== d && p[k - 1 + d - 1] < p[k + 1 + d - 1]);
    const pk = down ? k + 1 : k - 1;
    const px = p[pk + d - 1];
    const py = px - pk;
    while (x > px && y > py) {
      ops.push('=');
      x--;
      y--;
    }
    if (down) {
      ops.push('+');
      y--;
    } else {
      ops.push('-');
      x--;
    }
  }
  while (x > 0 && y > 0) {
    ops.push('=');
    x--;
    y--;
  }
  return ops.reverse();
}

/** Differences between `a` (older) and `b` (newer), grouped into hunks with `context` unchanged lines around them. */
export function diffLines(a: readonly string[], b: readonly string[], limits: DiffLimits = DIFF_LIMITS): LineDiff {
  const ops = editScript(a, b, limits.maxEdits);
  if (!ops) return { kind: 'too_different', added: null, removed: null };
  const all: DiffLine[] = [];
  let i = 0, j = 0, added = 0, removed = 0;
  for (const op of ops) {
    if (op === '=') all.push({ op: ' ', text: a[i], a: ++i, b: ++j });
    else if (op === '-') {
      all.push({ op: '-', text: a[i], a: ++i, b: null });
      removed++;
    } else {
      all.push({ op: '+', text: b[j], a: null, b: ++j });
      added++;
    }
  }
  if (!added && !removed) return { kind: 'same', lines: a.length };
  // Lines to show: each change and `context` lines on each side.
  const show = new Uint8Array(all.length);
  all.forEach((l, n) => {
    if (l.op === ' ') return;
    for (let m = Math.max(0, n - limits.context); m <= Math.min(all.length - 1, n + limits.context); m++) show[m] = 1;
  });
  const hunks: Hunk[] = [];
  let skipped = 0, shown = 0, truncated = false, n = 0;
  for (; n < all.length; n++) {
    if (!show[n]) {
      skipped++;
      continue;
    }
    if (shown >= limits.maxShown) {
      truncated = true;
      break;
    }
    if (skipped || !hunks.length || !show[n - 1]) hunks.push({ skipped, lines: [] });
    skipped = 0;
    hunks[hunks.length - 1].lines.push(all[n]);
    shown++;
  }
  return { kind: 'diff', added, removed, hunks, trailing: truncated ? 0 : skipped, truncated };
}
