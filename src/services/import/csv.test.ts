import { describe, expect, it } from 'vitest';
import { normaliseHeader, parseCsv } from './csv';

describe('parseCsv', () => {
  it('reads a simple table', () => {
    const rows = parseCsv('a,b\n1,2\n');
    expect(rows.map((r) => r.cells)).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('keeps commas inside quoted fields', () => {
    const rows = parseCsv('roaster,notes\n"Onyx","chocolate, citrus, plum"');
    expect(rows[1]?.cells).toEqual(['Onyx', 'chocolate, citrus, plum']);
  });

  it('keeps newlines inside quoted fields and still counts lines', () => {
    const rows = parseCsv('a,b\n"multi\nline",second\nx,y');
    expect(rows[1]?.cells).toEqual(['multi\nline', 'second']);
    // The row after an embedded newline must report its real line number,
    // otherwise every error message below it points at the wrong place.
    expect(rows[2]?.line).toBe(4);
  });

  it('unescapes doubled quotes', () => {
    const rows = parseCsv('a\n"she said ""hi"""');
    expect(rows[1]?.cells).toEqual(['she said "hi"']);
  });

  it('handles CRLF line endings', () => {
    const rows = parseCsv('a,b\r\n1,2\r\n');
    expect(rows.map((r) => r.cells)).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('strips a UTF-8 BOM so the first header still matches', () => {
    const rows = parseCsv('\uFEFFroaster,coffee\nOnyx,Geometry');
    expect(rows[0]?.cells[0]).toBe('roaster');
  });

  it('drops blank and commented rows', () => {
    const rows = parseCsv('# a note\na,b\n\n1,2\n,\n');
    expect(rows.map((r) => r.cells)).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('reads a final row with no trailing newline', () => {
    const rows = parseCsv('a,b\n1,2');
    expect(rows).toHaveLength(2);
    expect(rows[1]?.cells).toEqual(['1', '2']);
  });

  it('preserves empty trailing cells', () => {
    const rows = parseCsv('a,b,c\n1,,');
    expect(rows[1]?.cells).toEqual(['1', '', '']);
  });
});

describe('normaliseHeader', () => {
  it('collapses spacing, case and punctuation', () => {
    expect(normaliseHeader('Brew Method')).toBe('brewmethod');
    expect(normaliseHeader('brew_method')).toBe('brewmethod');
    expect(normaliseHeader('  BREW-METHOD ')).toBe('brewmethod');
  });
});
