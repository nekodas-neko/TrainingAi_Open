import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { test } from 'node:test';
import ts from 'typescript';

function invalidText(source: string, filename: string) {
  const file = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const errors: string[] = [];
  function primitive(expression: ts.Expression): boolean {
    if (
      ts.isStringLiteral(expression) ||
      ts.isNumericLiteral(expression) ||
      ts.isNoSubstitutionTemplateLiteral(expression)
    ) {
      return expression.text !== '';
    }
    if (ts.isParenthesizedExpression(expression)) {
      return primitive(expression.expression);
    }
    if (ts.isConditionalExpression(expression)) {
      return primitive(expression.whenTrue) || primitive(expression.whenFalse);
    }
    if (
      ts.isBinaryExpression(expression) &&
      expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
    ) {
      return (
        primitive(expression.right) ||
        (ts.isPropertyAccessExpression(expression.left) &&
          expression.left.name.text === 'length')
      );
    }
    return false;
  }
  function visit(node: ts.Node, insideText = false) {
    if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
      const text = ts.isJsxElement(node)
        ? ['Text', 'AppText', 'GroupTitle'].includes(node.openingElement.tagName.getText(file))
        : insideText;
      for (const child of node.children) {
        const invalid =
          !text &&
          ((ts.isJsxText(child) && !!child.text.trim()) ||
            (ts.isJsxExpression(child) && !!child.expression && primitive(child.expression)));
        if (invalid) {
          errors.push(
            `${filename}:${file.getLineAndCharacterOfPosition(child.getStart(file)).line + 1}`,
          );
        }
        visit(child, text);
      }
      return;
    }
    ts.forEachChild(node, (child) => visit(child, insideText));
  }
  visit(file);
  return errors;
}

test('native text guard catches whitespace, bare labels and zero-valued conditions', () => {
  assert.equal(
    invalidText("<View>{' '}Calendar{items.length && <Card />}</View>", 'fixture.tsx').length,
    3,
  );
  assert.deepEqual(
    invalidText(
      "<View><AppText>Calendar{' '}<>{0}</></AppText>{items.length > 0 && <Card />}</View>",
      'fixture.tsx',
    ),
    [],
  );
});

test('native JSX keeps literal text inside Text components', async () => {
  const root = new URL('../src/', import.meta.url);
  const files = await readdir(root, { recursive: true });
  const errors = (
    await Promise.all(
      files
        .filter((file) => file.endsWith('.tsx'))
        .map(async (file) =>
          invalidText(await readFile(new URL(file.replaceAll('\\', '/'), root), 'utf8'), file),
        ),
    )
  ).flat();
  assert.deepEqual(errors, [], `Text outside native Text components:\n${errors.join('\n')}`);
});
