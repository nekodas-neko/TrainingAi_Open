import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SESSION_ICON_CHOICES } from '@trainingai/shared/session-icons';
import { parseInline, parseMarkdown, safeLinkHref } from '../src/shared/ui/markdown-model.ts';
import { sessionIconOptions } from '../src/features/workouts/components/session-icon-names.ts';

test('bold stays bold and plain text is untouched', () => {
  assert.deepEqual(parseInline('a **b** c'), [
    { type: 'text', text: 'a ' },
    { type: 'bold', children: [{ type: 'text', text: 'b' }] },
    { type: 'text', text: ' c' },
  ]);
});
test('italics with * and _, but not snake_case or a lone asterisk', () => {
  assert.deepEqual(parseInline('*soft* and _soft_'), [
    { type: 'italic', children: [{ type: 'text', text: 'soft' }] },
    { type: 'text', text: ' and ' },
    { type: 'italic', children: [{ type: 'text', text: 'soft' }] },
  ]);
  assert.deepEqual(parseInline('max_heart_rate 5 * 3'), [{ type: 'text', text: 'max_heart_rate 5 * 3' }]);
});
test('bold and italic nest', () => {
  assert.deepEqual(parseInline('**a *b***'), [
    {
      type: 'bold',
      children: [
        { type: 'text', text: 'a ' },
        { type: 'italic', children: [{ type: 'text', text: 'b' }] },
      ],
    },
  ]);
});
test('inline code keeps its contents literal', () => {
  assert.deepEqual(parseInline('use `**x** [a](b)` ok'), [
    { type: 'text', text: 'use ' },
    { type: 'code', text: '**x** [a](b)' },
    { type: 'text', text: ' ok' },
  ]);
});
test('web links become links; other schemes show only their text', () => {
  assert.deepEqual(parseInline('[docs](https://example.com/a?b=1)'), [
    { type: 'link', href: 'https://example.com/a?b=1', children: [{ type: 'text', text: 'docs' }] },
  ]);
  assert.deepEqual(parseInline('[x](javascript:alert(1))'), [{ type: 'text', text: 'x' }]);
  assert.deepEqual(parseInline('[x](intent://a)'), [{ type: 'text', text: 'x' }]);
  assert.equal(safeLinkHref('file:///etc/passwd'), null);
  assert.equal(safeLinkHref('http://example.com'), 'http://example.com/');
});
test('half-streamed tokens stay literal', () => {
  assert.deepEqual(parseInline('**bold [lin'), [{ type: 'text', text: '**bold [lin' }]);
});
test('headings, bullets and numbered lists', () => {
  const blocks = parseMarkdown('## Plan\n- one\n* two\n\n1. first\n2) second\nplain');
  assert.deepEqual(
    blocks.map((b) => b.type),
    ['heading', 'bullet', 'bullet', 'number', 'number', 'paragraph'],
  );
  assert.equal((blocks[4] as { marker: string }).marker, '2.');
});
test('a pipe table with header, alignment row and short rows', () => {
  const [table, after] = parseMarkdown('| Day | Load |\n|:---|---:|\n| Mon | **High** |\n| Tue |\nafter');
  assert.equal(table.type, 'table');
  if (table.type !== 'table') return;
  assert.deepEqual(table.header, [[{ type: 'text', text: 'Day' }], [{ type: 'text', text: 'Load' }]]);
  assert.equal(table.rows.length, 2);
  assert.equal(table.rows[0][1][0].type, 'bold');
  assert.deepEqual(table.rows[1][1], []);
  assert.equal(after.type, 'paragraph');
});
test('a line with a pipe but no separator row is a paragraph', () => {
  assert.deepEqual(parseMarkdown('a | b').map((b) => b.type), ['paragraph']);
});
test('the session icon picker offers all 22 shared icons with labels', () => {
  const options = sessionIconOptions();
  assert.equal(options.length, 22);
  assert.deepEqual(options.map((o) => [o.id, o.label]), SESSION_ICON_CHOICES.map((c) => [c.emoji, c.label]));
  assert.equal(new Set(options.map((o) => o.id)).size, 22);
});
