// Tests for splitHighlight pure function in Highlight component.

import { describe, it, expect } from 'vitest';
import { splitHighlight } from '../src/frontend/resources/Highlight';

describe('splitHighlight: empty input', () => {
  it('returns single non-match segment for empty text', () => {
    expect(splitHighlight('', 'foo')).toEqual([]);
  });

  it('returns single non-match segment for empty query', () => {
    expect(splitHighlight('hello', '')).toEqual([{ text: 'hello', match: false }]);
  });

  it('returns single non-match for whitespace-only query', () => {
    expect(splitHighlight('hello', '   ')).toEqual([{ text: 'hello', match: false }]);
  });
});

describe('splitHighlight: no match', () => {
  it('returns single non-match when query not in text', () => {
    expect(splitHighlight('hello world', 'xyz')).toEqual([{ text: 'hello world', match: false }]);
  });
});

describe('splitHighlight: single match', () => {
  it('highlights a single match in the middle', () => {
    expect(splitHighlight('hello world', 'lo wo')).toEqual([
      { text: 'hel', match: false },
      { text: 'lo wo', match: true },
      { text: 'rld', match: false },
    ]);
  });

  it('highlights match at start', () => {
    expect(splitHighlight('hello world', 'hello')).toEqual([
      { text: 'hello', match: true },
      { text: ' world', match: false },
    ]);
  });

  it('highlights match at end', () => {
    expect(splitHighlight('hello world', 'world')).toEqual([
      { text: 'hello ', match: false },
      { text: 'world', match: true },
    ]);
  });
});

describe('splitHighlight: multiple matches', () => {
  it('highlights all occurrences', () => {
    expect(splitHighlight('abc abc abc', 'abc')).toEqual([
      { text: 'abc', match: true },
      { text: ' ', match: false },
      { text: 'abc', match: true },
      { text: ' ', match: false },
      { text: 'abc', match: true },
    ]);
  });

  it('handles overlapping (greedy left-to-right)', () => {
    // 'aaaa' with 'aa' → 'aa', 'aa' (not 'aa', 'aa', 'aa')
    expect(splitHighlight('aaaa', 'aa')).toEqual([
      { text: 'aa', match: true },
      { text: 'aa', match: true },
    ]);
  });
});

describe('splitHighlight: case insensitivity', () => {
  it('matches regardless of case but preserves original casing', () => {
    const segments = splitHighlight('Hello World', 'hello');
    expect(segments).toEqual([
      { text: 'Hello', match: true },
      { text: ' World', match: false },
    ]);
  });

  it('matches query regardless of case', () => {
    expect(splitHighlight('FOO bar', 'foo')).toEqual([
      { text: 'FOO', match: true },
      { text: ' bar', match: false },
    ]);
  });
});

describe('splitHighlight: special characters', () => {
  it('treats query as literal (no regex)', () => {
    expect(splitHighlight('1+1=2', '+')).toEqual([
      { text: '1', match: false },
      { text: '+', match: true },
      { text: '1=2', match: false },
    ]);
  });

  it('handles chinese characters', () => {
    expect(splitHighlight('底妆教程', '教程')).toEqual([
      { text: '底妆', match: false },
      { text: '教程', match: true },
    ]);
  });
});
