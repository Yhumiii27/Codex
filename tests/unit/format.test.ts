import { afterEach, describe, expect, it, vi } from 'vitest';
import { addDays, addYears, clip, daysBetween, fmtClock, fmtDate, fmtDateTime, fmtSize, fmtWhen, loc, nowStamp, parisStamp, parisToUtc, parseIsoDay, todayIso } from '@/lib/format';

// Dates are calendar days "YYYY-MM-DD"; timestamps are written in Paris time (the group's time zone).

afterEach(() => {
  vi.useRealTimers();
});

/** Freezes the clock at the UTC instant `iso`. */
const at = (iso: string) => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(iso));
};

describe('fmtDate, fmtWhen, loc', () => {
  it('writes a day as in the mockup', () => {
    expect(fmtDate('2026-10-05', 'fr')).toBe('05/10/2026');
    expect(fmtDate('2026-10-05', 'en')).toBe('5 Oct 2026');
    expect(fmtDate('2026-10-05 09:45:00', 'fr')).toBe('05/10/2026');
    expect(fmtDate(null, 'fr')).toBe('—');
    expect(fmtDate(undefined, 'en')).toBe('—');
  });

  it('writes a journal timestamp as day/month and time', () => {
    expect(fmtWhen('2026-10-05 09:45:00')).toBe('05/10 09:45');
    expect(fmtWhen('2026-10-05T09:45:00')).toBe('05/10 09:45');
  });

  it('keeps the year in a timestamp listed with others from any year', () => {
    expect(fmtDateTime('2025-10-06 14:20:00', 'fr')).toBe('06/10/2025 14:20');
    expect(fmtDateTime('2026-10-06T14:20:00', 'fr')).toBe('06/10/2026 14:20');
    expect(fmtDateTime('2026-10-06 14:20:00', 'en')).toBe('6 Oct 2026 14:20');
    expect(fmtDateTime('2026-10-06', 'fr')).toBe('06/10/2026');
  });

  it('picks the text of the interface language', () => {
    expect(loc({ fr: 'Procédure', en: 'Procedure' }, 'fr')).toBe('Procédure');
    expect(loc({ fr: 'Procédure', en: 'Procedure' }, 'en')).toBe('Procedure');
    expect(loc('Texte saisi', 'en')).toBe('Texte saisi');
    expect(loc(null, 'fr')).toBe('');
  });
});

describe('fmtSize', () => {
  it('writes sizes in the units and decimal mark of each language', () => {
    expect(fmtSize(512, 'fr')).toBe('512 o');
    expect(fmtSize(512, 'en')).toBe('512 B');
    expect(fmtSize(1536, 'fr')).toBe('1,5 Ko');
    expect(fmtSize(1536, 'en')).toBe('1.5 KB');
    expect(fmtSize(5 * 1024 * 1024, 'fr')).toBe('5,0 Mo');
    expect(fmtSize(3 * 1024 ** 4, 'en')).toBe('3072.0 GB');
    expect(fmtSize(null, 'fr')).toBe('—');
  });
});

describe('calendar arithmetic', () => {
  it('addDays crosses months, years and leap days, forwards and backwards', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-03-28', 2)).toBe('2026-03-30');
    expect(addDays('2026-10-05 23:30:00', 0)).toBe('2026-10-05');
  });

  it('addYears keeps the day, and 29 February falls back to the 28th', () => {
    expect(addYears('2026-10-05', 10)).toBe('2036-10-05');
    expect(addYears('2028-02-29', 1)).toBe('2029-02-28');
    expect(addYears('2028-02-29', 4)).toBe('2032-02-29');
    expect(addYears('2026-10-05', 0)).toBe('2026-10-05');
  });

  it('daysBetween counts calendar days, across a change of daylight saving time', () => {
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2);
    expect(daysBetween('2026-10-24', '2026-10-26')).toBe(2);
    expect(daysBetween('2026-10-10', '2026-10-05')).toBe(-5);
    expect(daysBetween('2026-10-05', '2026-10-05')).toBe(0);
  });

  it('parseIsoDay accepts real calendar days only', () => {
    expect(parseIsoDay('2026-02-28')).toBe('2026-02-28');
    expect(parseIsoDay('2028-02-29')).toBe('2028-02-29');
    expect(parseIsoDay('2026-10-05T09:00:00Z')).toBe('2026-10-05');
    expect(parseIsoDay('2026-10-05 09:00')).toBe('2026-10-05');
    for (const v of ['2026-02-30', '2027-02-29', '2026-13-01', '2026-1-5', '05/10/2026', '2026-10-05x', '', null, undefined]) expect(parseIsoDay(v), String(v)).toBeNull();
  });
});

describe('Paris time', () => {
  it('nowStamp writes the current instant in Paris time, summer and winter', () => {
    at('2026-10-05T07:45:00Z');
    expect(nowStamp()).toBe('2026-10-05 09:45:00');
    at('2026-01-15T12:00:00Z');
    expect(nowStamp()).toBe('2026-01-15 13:00:00');
  });

  it('todayIso is the Paris day, which starts before midnight UTC', () => {
    at('2026-10-05T22:30:00Z');
    expect(todayIso()).toBe('2026-10-06');
    at('2026-10-05T21:59:59Z');
    expect(todayIso()).toBe('2026-10-05');
  });

  it('fmtClock shows the time alone for today, the day and time otherwise', () => {
    at('2026-10-05T12:00:00Z');
    expect(fmtClock('2026-10-05 09:45:00')).toBe('09:45');
    expect(fmtClock('2026-10-04 09:45:00')).toBe('04/10 09:45');
  });

  it('fmtClock takes today as the Paris day, already the next one before midnight UTC', () => {
    at('2026-10-05T22:30:00Z');
    expect(fmtClock('2026-10-06 00:15:00')).toBe('00:15');
    expect(fmtClock('2026-10-05 23:00:00')).toBe('05/10 23:00');
  });

  it('parisStamp converts a UTC instant as Postgres or ISO writes it', () => {
    expect(parisStamp('2026-10-05 07:45:00.123+00')).toBe('2026-10-05 09:45:00');
    expect(parisStamp('2026-10-05T07:45:00Z')).toBe('2026-10-05 09:45:00');
    expect(parisStamp('2026-12-31 23:30:00+00')).toBe('2027-01-01 00:30:00');
  });

  it('parisToUtc converts Paris time back to UTC, on both sides of the changes of time', () => {
    expect(parisToUtc('2026-10-05 09:45:00')).toBe('2026-10-05T07:45:00.000Z');
    expect(parisToUtc('2026-01-15 09:00:00')).toBe('2026-01-15T08:00:00.000Z');
    expect(parisToUtc('2026-03-29 01:30:00')).toBe('2026-03-29T00:30:00.000Z');
    expect(parisToUtc('2026-03-29 03:30:00')).toBe('2026-03-29T01:30:00.000Z');
    expect(parisToUtc('2026-10-25 01:30:00')).toBe('2026-10-24T23:30:00.000Z');
    expect(parisToUtc('2026-10-25 03:30:00')).toBe('2026-10-25T02:30:00.000Z');
  });

  it('parisStamp and parisToUtc are inverse of each other outside the ambiguous hours', () => {
    for (const local of ['2026-01-01 00:00:00', '2026-06-30 23:59:59', '2026-10-05 09:45:00', '2027-02-28 12:00:00']) {
      expect(parisStamp(parisToUtc(local)), local).toBe(local);
    }
  });
});

describe('clip (a reason quoted in « À traiter »)', () => {
  it('keeps a short text, on one line', () => {
    expect(clip('Plan de contrôle', 140)).toBe('Plan de contrôle');
    expect(clip('  Tableau 3 faux.\n\nRevoir   la section 2.  ', 140)).toBe('Tableau 3 faux. Revoir la section 2.');
  });

  it('cuts a long text to its length, ellipsis included', () => {
    const cut = clip('x'.repeat(2000), 140);
    expect(cut).toHaveLength(140);
    expect(cut.endsWith('…')).toBe(true);
    expect(clip('abcdef', 6)).toBe('abcdef');
    expect(clip('abcd efgh', 6)).toBe('abcd…');
  });
});
