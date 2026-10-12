import { describe, expect, it } from 'vitest';
import { changeAuthor, seenVersion, seenWorkingBase, staleText, workingIssue, workingStaleText } from '@/lib/concurrency';
import { DICT } from '@/lib/i18n';

// Concurrent changes from two views of the same record (point 20 of docs/reste-a-faire.md): what a dialog sends back
// of the view it was opened from, when an upload or an approval request must not pass over a working version uploaded
// since (D-12), and who is named as having changed the record.

describe('seenVersion', () => {
  it('reads a positive whole number, from a form field or a number', () => {
    expect(seenVersion('3')).toBe(3);
    expect(seenVersion(' 12 ')).toBe(12);
    expect(seenVersion(7)).toBe(7);
  });

  it('gives null for anything else: the view is then treated as outdated', () => {
    for (const raw of [null, undefined, '', '0', '-1', '1.5', '1e3', 'abc', '03', 0, -2, 1.5, NaN, {}, ['2']]) expect(seenVersion(raw), String(raw)).toBeNull();
  });
});

describe('seenWorkingBase', () => {
  it('reads the revision and the number of its last working version, 0 before the first one', () => {
    expect(seenWorkingBase('41', '2')).toEqual({ revisionId: 41, n: 2 });
    expect(seenWorkingBase('41', '0')).toEqual({ revisionId: 41, n: 0 });
    expect(seenWorkingBase(41, 3)).toEqual({ revisionId: 41, n: 3 });
  });

  it('gives null when either part is missing or malformed', () => {
    for (const [rev, n] of [[null, '1'], ['41', null], ['', '1'], ['0', '1'], ['41', '-1'], ['41', '1.5'], ['x', '1'], ['41', '']] as const) {
      expect(seenWorkingBase(rev, n), `${rev}/${n}`).toBeNull();
    }
  });
});

describe('workingIssue', () => {
  const rev = { id: 41 };

  it('lets an upload through when its base is the last working version of the revision drafted', () => {
    expect(workingIssue({ revisionId: 41, n: 2 }, rev, { n: 2 })).toBeNull();
    expect(workingIssue({ revisionId: 41, n: 0 }, rev, null)).toBeNull();
  });

  it('says « newer » when a working version was uploaded since: the dialog names it', () => {
    expect(workingIssue({ revisionId: 41, n: 2 }, rev, { n: 3 })).toBe('newer');
    expect(workingIssue({ revisionId: 41, n: 0 }, rev, { n: 1 })).toBe('newer');
  });

  it('says « stale » for a view of another revision, no base, or a version the revision does not have', () => {
    expect(workingIssue({ revisionId: 40, n: 2 }, rev, { n: 2 })).toBe('stale');
    expect(workingIssue(null, rev, { n: 2 })).toBe('stale');
    expect(workingIssue(null, rev, null)).toBe('stale');
    expect(workingIssue({ revisionId: 41, n: 3 }, rev, { n: 2 })).toBe('stale');
  });
});

describe('changeAuthor: who made the last change, among the entries of its transaction', () => {
  const system = (u: string) => u === 'codex' || u === 'vigie';

  it('names nobody when the change wrote no journal entry', () => {
    expect(changeAuthor([], 'PRO-QUA-0001', system)).toBeNull();
  });

  it('names the author of the entry about the document', () => {
    expect(changeAuthor([{ userId: 'owner', docId: 'PRO-QUA-0001' }], 'PRO-QUA-0001', system)).toBe('owner');
  });

  it('prefers a person to Codex or Vigie: a final approval puts the revision in force in the approver’s transaction', () => {
    // Newest first: the approval, then the entry into force Codex wrote for it.
    expect(changeAuthor([{ userId: 'codex', docId: 'PRO-QUA-0001' }, { userId: 'approver', docId: 'PRO-QUA-0001' }], 'PRO-QUA-0001', system)).toBe('approver');
    expect(changeAuthor([{ userId: 'approver', docId: 'PRO-QUA-0001' }, { userId: 'codex', docId: 'PRO-QUA-0001' }], 'PRO-QUA-0001', system)).toBe('approver');
    // Codex or Vigie alone (an entry into force on its effective date, a decision received) is named.
    expect(changeAuthor([{ userId: 'vigie', docId: 'PRO-QUA-0001' }, { userId: 'codex', docId: 'PRO-QUA-0001' }], 'PRO-QUA-0001', system)).toBe('vigie');
  });

  it('prefers an entry about the document to one about another document, then the newest', () => {
    expect(changeAuthor([{ userId: 'manager', docId: 'PRO-QUA-0002' }, { userId: 'codex', docId: 'PRO-QUA-0001' }], 'PRO-QUA-0001', system)).toBe('codex');
    expect(changeAuthor([{ userId: 'manager', docId: 'PRO-QUA-0002' }, { userId: 'owner', docId: null }], 'PRO-QUA-0001', system)).toBe('manager');
    expect(changeAuthor([{ userId: 'manager', docId: 'PRO-QUA-0001' }, { userId: 'owner', docId: 'PRO-QUA-0001' }], 'PRO-QUA-0001', system)).toBe('manager');
  });
});

describe('messages', () => {
  it('names who changed the record and asks to reload it, in both languages', () => {
    expect(staleText(DICT.fr, 'Claire Bardet')).toBe('Ce document a été modifié entre-temps par Claire Bardet ; rechargez la fiche.');
    expect(staleText(DICT.en, 'Claire Bardet')).toBe('This document was changed in the meantime by Claire Bardet; reload the record.');
    expect(staleText(DICT.fr, null)).toBe('Ce document a été modifié entre-temps ; rechargez la fiche.');
    expect(staleText(DICT.en, null)).toBe('This document was changed in the meantime; reload the record.');
  });

  it('names the working version uploaded since and its author', () => {
    expect(workingStaleText(DICT.fr, 'A.3', 'Gabriel Comte')).toBe('La version de travail A.3 a été déposée entre-temps par Gabriel Comte ; rechargez la fiche pour partir de cette version.');
    expect(workingStaleText(DICT.en, 'A.3', 'Gabriel Comte')).toBe('Working version A.3 was uploaded in the meantime by Gabriel Comte; reload the record to start from that version.');
  });

  it('asks to see that version before requesting approval of the revision', () => {
    expect(workingStaleText(DICT.fr, 'C.3', 'Lucas Fabre', 'validate')).toBe('La version de travail C.3 a été déposée entre-temps par Lucas Fabre ; rechargez la fiche pour la voir avant de demander la validation.');
    expect(workingStaleText(DICT.en, 'C.3', 'Lucas Fabre', 'validate')).toBe('Working version C.3 was uploaded in the meantime by Lucas Fabre; reload the record to see it before requesting approval.');
  });
});
