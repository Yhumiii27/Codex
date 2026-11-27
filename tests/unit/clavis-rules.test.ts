import { describe, expect, it } from 'vitest';
import { seal, unseal } from '@/server/integrations/clavis/auth';
import { authMode, clavisConfig, clavisConfigProblems, initialsOf, roleFromAccess, safeReturnTo, userIdFor } from '@/server/integrations/clavis/rules';

// Sign-in through Clavis (src/server/integrations/clavis/rules.ts): configuration, role read in clavis.pub_acces, new user identifiers.

const ENV = {
  CODEX_AUTH: 'clavis', CODEX_PUBLIC_URL: 'https://codex.example/', CODEX_CLAVIS_URL: 'https://clavis.example',
  CODEX_CLAVIS_CLIENT_SECRET: 's3cret', CODEX_SESSION_SECRET: 'x'.repeat(32),
};

describe('Clavis sign-in configuration', () => {
  it('is demo unless CODEX_AUTH=clavis', () => {
    expect(authMode({})).toBe('demo');
    expect(authMode({ CODEX_AUTH: 'Clavis' })).toBe('clavis');
  });
  it('needs every variable, https addresses and a long secret', () => {
    expect(clavisConfigProblems(ENV)).toEqual({});
    expect(clavisConfig(ENV)).toMatchObject({ issuer: 'https://clavis.example', clientId: 'codex', redirectUri: 'https://codex.example/auth/retour', sessionHours: 10 });
    expect(Object.keys(clavisConfigProblems({ ...ENV, CODEX_CLAVIS_URL: 'http://clavis.example', CODEX_SESSION_SECRET: 'short', CODEX_SESSION_HOURS: '48' })))
      .toEqual(['CODEX_CLAVIS_URL', 'CODEX_SESSION_SECRET', 'CODEX_SESSION_HOURS']);
    expect(() => clavisConfig({ CODEX_AUTH: 'clavis' })).toThrow(/CODEX_PUBLIC_URL/);
    expect(clavisConfigProblems({ ...ENV, CODEX_PUBLIC_URL: 'http://localhost:3100' })).toEqual({});
  });
});

describe('role and identity', () => {
  it('reads the role only when the access opens now, and only a Codex role', () => {
    expect(roleFromAccess({ role: 'gestionnaire', ouvert: true })).toBe('gestionnaire');
    expect(roleFromAccess({ role: 'gestionnaire', ouvert: false })).toBeNull();
    expect(roleFromAccess({ role: 'admin', ouvert: true })).toBeNull();
    expect(roleFromAccess(null)).toBeNull();
  });
  it('makes a unique user id from the e-mail and two initials from the name', () => {
    expect(userIdFor('Hélène.Martin@atrium.example', new Set())).toBe('helene.martin');
    expect(userIdFor('a.b@x.fr', new Set(['a.b', 'a.b-2']))).toBe('a.b-3');
    expect(initialsOf('Claire Bardet')).toBe('CB');
    expect(initialsOf('Marie-Hélène Porquet')).toBe('MP');
    expect(initialsOf('Admin')).toBe('AD');
  });
  it('returns only inside Codex', () => {
    expect(safeReturnTo('/documents/PRO-QUA-0001')).toBe('/documents/PRO-QUA-0001');
    for (const v of ['//evil.example', 'https://evil.example', '/\\evil', '/auth/retour', null]) expect(safeReturnTo(v)).toBe('/');
  });
});

describe('sealed cookies', () => {
  it('open only with the same secret and purpose, before they expire', () => {
    const exp = Math.floor(Date.now() / 1000) + 60;
    const v = seal('k'.repeat(32), 'session', { pid: 'p', exp });
    expect(unseal('k'.repeat(32), 'session', v)).toEqual({ pid: 'p', exp });
    expect(unseal('k'.repeat(32), 'signin', v)).toBeNull();
    expect(unseal('j'.repeat(32), 'session', v)).toBeNull();
    expect(unseal('k'.repeat(32), 'session', v, (exp + 1) * 1000)).toBeNull();
    expect(unseal('k'.repeat(32), 'session', `${v.slice(0, -2)}AA`)).toBeNull();
  });
});
