import { describe, expect, it } from 'vitest';
import { checkConfig } from '@/lib/config-check';
import { converterOf, convertible, previewMaxBytes, previewTimeoutMs } from '@/lib/preview-config';

// Configuration of the PDF preview of Office files (src/lib/preview-config.ts, point 15 of docs/reste-a-faire.md): off
// unless one conversion service is named, never both, bounded.

describe('converterOf', () => {
  it('is off unless a service is named', () => {
    expect(converterOf({})).toEqual({ kind: 'off' });
    expect(converterOf({ CODEX_PREVIEW_SOFFICE: ' ', CODEX_PREVIEW_GOTENBERG_URL: '' })).toEqual({ kind: 'off' });
  });

  it('takes LibreOffice by its absolute path only', () => {
    expect(converterOf({ CODEX_PREVIEW_SOFFICE: '/usr/bin/soffice' })).toEqual({ kind: 'soffice', path: '/usr/bin/soffice' });
    expect(converterOf({ CODEX_PREVIEW_SOFFICE: 'soffice' })).toEqual({ kind: 'invalid', reason: 'soffice_path' });
  });

  it('takes Gotenberg by an http(s) address without credentials nor query', () => {
    expect(converterOf({ CODEX_PREVIEW_GOTENBERG_URL: 'http://gotenberg:3000/' })).toEqual({ kind: 'gotenberg', url: 'http://gotenberg:3000' });
    expect(converterOf({ CODEX_PREVIEW_GOTENBERG_URL: 'https://conv.example/gotenberg' })).toEqual({ kind: 'gotenberg', url: 'https://conv.example/gotenberg' });
    for (const bad of ['gotenberg:3000', 'ftp://g', 'http://u:p@g:3000', 'http://g:3000?x=1', 'pas une adresse']) {
      expect(converterOf({ CODEX_PREVIEW_GOTENBERG_URL: bad }), bad).toEqual({ kind: 'invalid', reason: 'gotenberg_url' });
    }
  });

  it('uses neither when both are named', () => {
    expect(converterOf({ CODEX_PREVIEW_SOFFICE: '/usr/bin/soffice', CODEX_PREVIEW_GOTENBERG_URL: 'http://g:3000' })).toEqual({ kind: 'invalid', reason: 'both' });
  });
});

describe('bounds and formats', () => {
  it('reads the time limit and the size limit within their ranges, else the defaults', () => {
    expect(previewTimeoutMs({})).toBe(60_000);
    expect(previewTimeoutMs({ CODEX_PREVIEW_TIMEOUT_S: '120' })).toBe(120_000);
    expect(previewTimeoutMs({ CODEX_PREVIEW_TIMEOUT_S: '2' })).toBe(60_000);
    expect(previewMaxBytes({})).toBe(20 * 1024 * 1024);
    expect(previewMaxBytes({ CODEX_PREVIEW_MAX_MB: '5' })).toBe(5 * 1024 * 1024);
    expect(previewMaxBytes({ CODEX_PREVIEW_MAX_MB: '1000' })).toBe(20 * 1024 * 1024);
  });

  it('converts word processing, spreadsheets and presentations only', () => {
    for (const ext of ['.docx', '.DOC', '.xlsx', '.xls', '.pptx', '.odt', '.ods', '.odp', '.rtf']) expect(convertible(ext), ext).toBe(true);
    for (const ext of ['.pdf', '.txt', '.png', '.dwg', '.zip', '.msg', '']) expect(convertible(ext), ext).toBe(false);
  });

  it('the configuration check warns about a service misnamed or values out of range', () => {
    const codes = (env: Record<string, string>) => checkConfig(env, { production: false }).map((f) => f.code);
    expect(codes({ CODEX_PREVIEW_SOFFICE: '/usr/bin/soffice', CODEX_PREVIEW_GOTENBERG_URL: 'http://g:3000' })).toContain('preview_invalid');
    expect(codes({ CODEX_PREVIEW_GOTENBERG_URL: 'http://user:secret@g:3000' })).toContain('preview_invalid');
    expect(checkConfig({ CODEX_PREVIEW_GOTENBERG_URL: 'http://user:secret@g:3000' }, { production: false }).map((f) => f.message).join()).not.toContain('secret');
    expect(codes({ CODEX_PREVIEW_TIMEOUT_S: 'long', CODEX_PREVIEW_MAX_MB: '0', CODEX_COMPARE_MAX_MB: '900' })).toEqual(expect.arrayContaining(['preview_timeout_invalid', 'preview_max_invalid', 'compare_max_invalid']));
    expect(codes({ CODEX_PREVIEW_SOFFICE: '/usr/bin/soffice' }).filter((c) => c.startsWith('preview'))).toEqual([]);
  });
});
