import { describe, expect, it } from 'vitest';
import { errorRef, failureText } from '@/lib/errors';
import { DICT } from '@/lib/i18n';

// What the user is shown of an unexpected error (lib/errors.ts, point 44 of docs/reste-a-faire.md): the reference the
// technical log carries, never the message.

describe('errorRef', () => {
  it('is the digest Next.js gives the browser, when it is a plain token', () => {
    expect(errorRef(Object.assign(new Error('x'), { digest: '2794035829' }))).toBe('2794035829');
    expect(errorRef(Object.assign(new Error('x'), { digest: '0b5c2c55-8f7e-4b9f-9d3c-1d6c3b0c7a11' }))).toBe('0b5c2c55-8f7e-4b9f-9d3c-1d6c3b0c7a11');
  });

  it('is null for an error of the browser, a digest that is no token, or no error at all', () => {
    expect(errorRef(new Error('relation "documents" does not exist'))).toBeNull();
    expect(errorRef(Object.assign(new Error('x'), { digest: 'a b<script>' }))).toBeNull();
    expect(errorRef(Object.assign(new Error('x'), { digest: 42 }))).toBeNull();
    expect(errorRef(null)).toBeNull();
    expect(errorRef('boom')).toBeNull();
  });
});

describe('failureText', () => {
  it('adds the reference in the user’s language, never the message', () => {
    const err = Object.assign(new Error('Failed query: select * from documents'), { digest: 'abc-1' });
    expect(failureText(DICT.fr, err)).toBe('Une erreur est survenue · Réf. abc-1');
    expect(failureText(DICT.en, err)).toBe('Something went wrong · Ref. abc-1');
    expect(failureText(DICT.fr, new Error('disk full'))).toBe('Une erreur est survenue');
  });
});
