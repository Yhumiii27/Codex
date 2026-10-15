import { describe, expect, it } from 'vitest';
import { defaultDepartment } from '@/lib/departments';
import { inUse, isOrgKind, lastActiveIssue, markInactive, newDocDepartment, NO_USAGE, offered, orgLabels, parseOrgForm } from '@/lib/org-rules';
import { LABEL_MAX } from '@/lib/registry-rules';

// Pure rules of Administration › Organisation (point 62 of docs/reste-a-faire.md): labels, what an inactive department
// or site still appears in, the department a new document gets, one department active at least.

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
}

describe('orgLabels and parseOrgForm', () => {
  it('require the French label, take it for an empty English one, refuse a label too long', () => {
    expect(orgLabels('  Qualité ', '')).toEqual({ ok: true, value: { labelFr: 'Qualité', labelEn: 'Qualité' } });
    expect(orgLabels('Qualité', 'Quality')).toEqual({ ok: true, value: { labelFr: 'Qualité', labelEn: 'Quality' } });
    expect(orgLabels(' ', 'Quality')).toEqual({ ok: false, key: 'reg_label_required', field: 'labelFr' });
    expect(orgLabels(undefined, null)).toEqual({ ok: false, key: 'reg_label_required', field: 'labelFr' });
    expect(orgLabels('x'.repeat(LABEL_MAX + 1), '')).toEqual({ ok: false, key: 'reg_text_too_long', field: 'labelFr' });
    expect(orgLabels('Qualité', 'x'.repeat(LABEL_MAX + 1))).toEqual({ ok: false, key: 'reg_text_too_long', field: 'labelEn' });
  });

  it('read the state, active unless the form says off, and never a code', () => {
    expect(parseOrgForm(form({ code: 'QAL', labelFr: 'Qualité', labelEn: 'Quality' }))).toEqual({ ok: true, value: { labelFr: 'Qualité', labelEn: 'Quality', active: true } });
    expect(parseOrgForm(form({ labelFr: 'Qualité', active: 'off' }))).toEqual({ ok: true, value: { labelFr: 'Qualité', labelEn: 'Qualité', active: false } });
    expect(parseOrgForm(form({ labelFr: '' }))).toMatchObject({ ok: false, key: 'reg_label_required' });
  });

  it('know the two kinds only', () => {
    expect(isOrgKind('department') && isOrgKind('site')).toBe(true);
    expect(isOrgKind('town') || isOrgKind(undefined)).toBe(false);
  });
});

describe('inUse', () => {
  it('is any reference at all', () => {
    expect(inUse(undefined)).toBe(false);
    expect(inUse(NO_USAGE)).toBe(false);
    for (const k of Object.keys(NO_USAGE)) expect(inUse({ ...NO_USAGE, [k]: 1 }), k).toBe(true);
  });
});

describe('offered, markInactive and newDocDepartment', () => {
  const values = [{ key: 'DIR', active: true }, { key: 'QUA', active: false }, { key: 'ING', active: true }];

  it('offer the active values, and the inactive one already set where it is set', () => {
    expect(offered(values).map((x) => x.key)).toEqual(['DIR', 'ING']);
    expect(offered(values, 'QUA').map((x) => x.key)).toEqual(['DIR', 'QUA', 'ING']);
    expect(offered(values, null).map((x) => x.key)).toEqual(['DIR', 'ING']);
  });

  it('mark an inactive value where every one is still listed (a department’s holders, its page picker)', () => {
    const listed = [{ key: 'DIR', label: 'Direction', active: true }, { key: 'QUA', label: 'Qualité', active: false }];
    expect(markInactive(listed, 'inactif')).toEqual([{ key: 'DIR', label: 'Direction', active: true }, { key: 'QUA', label: 'Qualité (inactif)', active: false }]);
    expect(listed[1].label).toBe('Qualité');
  });

  it('give a new document the user’s department while active, else the first active one', () => {
    expect(newDocDepartment('ING', values)).toBe('ING');
    expect(newDocDepartment('QUA', values)).toBe('DIR');
    expect(newDocDepartment(null, values)).toBe('DIR');
    expect(newDocDepartment('ING', [{ key: 'ING', active: false }])).toBe('');
  });

  it('open /departements on the user’s department even inactive (its page stays), else the first active one', () => {
    const depts = [{ code: 'DIR', active: false }, { code: 'QUA', active: false }, { code: 'ING', active: true }];
    expect(defaultDepartment('QUA', depts)).toBe('QUA');
    expect(defaultDepartment(null, depts)).toBe('ING');
    expect(defaultDepartment(null, [{ code: 'DIR', active: false }])).toBe('DIR');
  });
});

describe('lastActiveIssue', () => {
  const depts = [{ code: 'DIR', active: true }, { code: 'QUA', active: false }];
  it('keeps one department active at least', () => {
    expect(lastActiveIssue(depts, 'DIR', false)).toBe('org_last_department');
    expect(lastActiveIssue(depts, 'DIR', null)).toBe('org_last_department');
    expect(lastActiveIssue([...depts, { code: 'ING', active: true }], 'DIR', false)).toBeNull();
  });
  it('lets a department be renamed, brought back, or deleted while inactive', () => {
    expect(lastActiveIssue(depts, 'DIR', true)).toBeNull();
    expect(lastActiveIssue(depts, 'QUA', true)).toBeNull();
    expect(lastActiveIssue(depts, 'QUA', null)).toBeNull();
  });
});
