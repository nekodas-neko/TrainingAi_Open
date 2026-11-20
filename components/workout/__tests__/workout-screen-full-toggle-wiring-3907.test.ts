/**
 * #3907(3): `full-toggle-sends-override-3877.test.tsx` drives the toggle's hook and the payload
 * helper, but not the screen between them. This pins that wiring in `workout-screen.tsx`, read with
 * the TypeScript parser: the log's intensity fields come from `sessionIntensityForLog`, fed the
 * `deload` and `overrideFull` that `useDeloadChoice` returns, and are spread onto the log payload.
 * Rendering the screen would need its 48 imports mocked and a set tapped through; a break in any of
 * these three links is what sent a planned deload's Full session to the server as a deload (#3877).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'

const file = join(process.cwd(), 'components/workout-screen.tsx')
const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)

function find<T extends ts.Node>(node: ts.Node, test: (n: ts.Node) => n is T, out: T[] = []): T[] {
  if (test(node)) out.push(node)
  node.forEachChild(c => { find(c, test, out) })
  return out
}
const callsTo = (name: string) => find(source, (n): n is ts.CallExpression =>
  ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === name)
/** The names bound by `const { a, b: c } = <call>`, keyed by property. */
function destructuredFrom(call: ts.CallExpression): Map<string, string> {
  const decl = call.parent
  if (!ts.isVariableDeclaration(decl) || !ts.isObjectBindingPattern(decl.name)) return new Map()
  return new Map(decl.name.elements.map(e => [
    (e.propertyName && ts.isIdentifier(e.propertyName) ? e.propertyName : e.name as ts.Identifier).text,
    (e.name as ts.Identifier).text,
  ]))
}
/** Property → the identifier it is given, for an object literal argument (`{ a, b: c }`). */
function argProps(call: ts.CallExpression): Map<string, string> {
  const arg = call.arguments[0]
  if (!arg || !ts.isObjectLiteralExpression(arg)) return new Map()
  const out = new Map<string, string>()
  for (const p of arg.properties) {
    if (ts.isShorthandPropertyAssignment(p)) out.set(p.name.text, p.name.text)
    else if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name)) out.set(p.name.text, p.initializer.getText(source))
  }
  return out
}

describe('WorkoutScreen wires the Full toggle into the log payload (#3907)', () => {
  const [choice] = callsTo('useDeloadChoice')
  const [intensity] = callsTo('sessionIntensityForLog')

  it('takes the toggle state from useDeloadChoice', () => {
    expect(choice, 'useDeloadChoice is called once').toBeTruthy()
    const bound = destructuredFrom(choice)
    expect(bound.get('deload')).toBe('deload')
    expect(bound.get('overrideFull')).toBe('overrideFull')
  })

  it('hands that state to sessionIntensityForLog', () => {
    expect(callsTo('sessionIntensityForLog')).toHaveLength(1)
    const props = argProps(intensity)
    const bound = destructuredFrom(choice)
    expect(props.get('deload')).toBe(bound.get('deload'))
    expect(props.get('overrideFull')).toBe(bound.get('overrideFull'))
  })

  it('spreads its fields onto the log payload', () => {
    const fieldsName = destructuredFrom(intensity).get('fields')
    expect(fieldsName).toBeTruthy()
    const payload = find(source, (n): n is ts.VariableDeclaration =>
      ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === 'logPayload')[0]
    expect(payload?.initializer && ts.isObjectLiteralExpression(payload.initializer)).toBe(true)
    const spreads = (payload!.initializer as ts.ObjectLiteralExpression).properties
      .filter(ts.isSpreadAssignment).map(s => s.expression.getText(source))
    expect(spreads).toContain(fieldsName)
  })
})
