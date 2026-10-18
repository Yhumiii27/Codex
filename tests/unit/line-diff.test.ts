import { describe, expect, it } from 'vitest';
import { diffLines, editScript, type DiffLine } from '@/lib/line-diff';

// Line differences of the comparison of versions (src/lib/line-diff.ts, point 14 of docs/reste-a-faire.md): Myers'
// shortest edit script, grouped into hunks with their context, bounded.

/** Applies an edit script to `a`: what it gives must be `b`. */
function apply(a: string[], b: string[], ops: ('=' | '-' | '+')[]): string[] {
  const out: string[] = [];
  let i = 0, j = 0;
  for (const op of ops) {
    if (op === '=') {
      expect(a[i]).toBe(b[j]);
      out.push(a[i++]);
      j++;
    } else if (op === '-') i++;
    else out.push(b[j++]);
  }
  expect(i).toBe(a.length);
  return out;
}

/** Length of the longest common subsequence, by dynamic programming: the shortest script keeps exactly that many. */
function lcs(a: string[], b: string[]): number {
  const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
  return dp[a.length][b.length];
}

/** A small pseudo-random generator, so that the cases are the same at every run. */
function rng(seed: number) {
  return () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
}

describe('editScript', () => {
  it('gives a shortest script that turns a into b, on random texts', () => {
    const r = rng(7);
    for (let n = 0; n < 300; n++) {
      const pick = () => Array.from({ length: Math.floor(r() * 14) }, () => 'abcde'[Math.floor(r() * 5)]);
      const a = pick(), b = pick();
      const ops = editScript(a, b, 1000)!;
      expect(apply(a, b, ops)).toEqual(b);
      expect(ops.filter((o) => o === '=').length).toBe(lcs(a, b));
    }
  });

  it('handles empty sides and identical texts', () => {
    expect(editScript([], [], 10)).toEqual([]);
    expect(editScript([], ['x', 'y'], 10)).toEqual(['+', '+']);
    expect(editScript(['x'], [], 10)).toEqual(['-']);
    expect(editScript(['x', 'y'], ['x', 'y'], 0)).toEqual(['=', '=']);
  });

  it('gives up beyond the bound of lines added or removed', () => {
    const a = Array.from({ length: 50 }, (_, i) => `a${i}`);
    const b = Array.from({ length: 50 }, (_, i) => `b${i}`);
    expect(editScript(a, b, 99)).toBeNull();
    expect(editScript(a, b, 100)).toHaveLength(100);
  });
});

describe('diffLines', () => {
  const texts = (lines: DiffLine[]) => lines.map((l) => `${l.op}${l.text}`);

  it('says when the texts are the same', () => {
    expect(diffLines(['un', 'deux'], ['un', 'deux'])).toEqual({ kind: 'same', lines: 2 });
  });

  it('counts additions and removals and numbers the lines on each side', () => {
    const d = diffLines(['a', 'b', 'c'], ['a', 'x', 'c', 'd']);
    expect(d).toMatchObject({ kind: 'diff', added: 2, removed: 1, truncated: false, trailing: 0 });
    if (d.kind !== 'diff') throw new Error();
    expect(d.hunks).toHaveLength(1);
    expect(d.hunks[0].lines).toEqual([
      { op: ' ', text: 'a', a: 1, b: 1 },
      { op: '-', text: 'b', a: 2, b: null },
      { op: '+', text: 'x', a: null, b: 2 },
      { op: ' ', text: 'c', a: 3, b: 3 },
      { op: '+', text: 'd', a: null, b: 4 },
    ]);
  });

  it('keeps two lines of context around each change and says how many identical lines it skips', () => {
    const a = Array.from({ length: 20 }, (_, i) => `l${i}`);
    const b = [...a];
    b[3] = 'changé';
    b[15] = 'aussi';
    const d = diffLines(a, b);
    if (d.kind !== 'diff') throw new Error();
    expect(d.hunks.map((h) => h.skipped)).toEqual([1, 7]);
    expect(texts(d.hunks[0].lines)).toEqual([' l1', ' l2', '-l3', '+changé', ' l4', ' l5']);
    expect(texts(d.hunks[1].lines)).toEqual([' l13', ' l14', '-l15', '+aussi', ' l16', ' l17']);
    expect(d.trailing).toBe(2);
  });

  it('cuts the lines shown at the bound, and says so', () => {
    const a = Array.from({ length: 100 }, (_, i) => `a${i}`);
    const b = Array.from({ length: 100 }, (_, i) => (i % 2 ? `b${i}` : `a${i}`));
    const d = diffLines(a, b, { maxEdits: 1000, context: 0, maxShown: 30 });
    if (d.kind !== 'diff') throw new Error();
    expect(d.hunks.flatMap((h) => h.lines)).toHaveLength(30);
    expect(d).toMatchObject({ added: 50, removed: 50, truncated: true, trailing: 0 });
  });

  it('texts too different are not shown line by line', () => {
    const a = Array.from({ length: 4000 }, (_, i) => `a${i}`);
    const b = Array.from({ length: 4000 }, (_, i) => `b${i}`);
    expect(diffLines(a, b)).toEqual({ kind: 'too_different', added: null, removed: null });
  });
});
