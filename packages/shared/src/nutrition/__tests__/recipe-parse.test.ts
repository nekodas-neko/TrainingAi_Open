import { describe, it, expect } from 'vitest'
import { extractRecipeJsonLd, extractReadableText, parseRecipeYield, sliceAroundIngredients } from '../recipe-parse'

function ld(obj: unknown, extra = '') {
  return `<html><head>${extra}<script type="application/ld+json">${JSON.stringify(obj)}</script></head><body><p>page</p></body></html>`
}

describe('extractRecipeJsonLd', () => {
  it('reads a plain Recipe node', () => {
    const html = ld({
      '@context': 'https://schema.org',
      '@type': 'Recipe',
      name: 'Chicken &amp; Rice',
      recipeIngredient: ['300 g chicken breast', '1 cup rice', '1 tbsp olive oil'],
      recipeYield: '4 servings',
    })
    expect(extractRecipeJsonLd(html)).toEqual({
      name: 'Chicken & Rice',
      ingredients: ['300 g chicken breast', '1 cup rice', '1 tbsp olive oil'],
      yield: 4,
    })
  })

  it('finds the Recipe inside an @graph', () => {
    const html = ld({
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'WebSite', name: 'Some Blog' },
        { '@type': ['Recipe', 'Thing'], name: 'Soup', recipeIngredient: ['2 carrots'], recipeYield: 2 },
      ],
    })
    expect(extractRecipeJsonLd(html)?.name).toBe('Soup')
    expect(extractRecipeJsonLd(html)?.yield).toBe(2)
  })

  it('skips a malformed block rather than losing the good one after it', () => {
    const html = `<script type="application/ld+json">{ not json </script>` +
      ld({ '@type': 'Recipe', name: 'Second', recipeIngredient: ['1 egg'] })
    expect(extractRecipeJsonLd(html)?.name).toBe('Second')
  })

  it('returns null when the page carries no Recipe', () => {
    expect(extractRecipeJsonLd(ld({ '@type': 'Article', name: 'Not a recipe' }))).toBeNull()
    expect(extractRecipeJsonLd('<html><body>nothing</body></html>')).toBeNull()
  })

  it('ignores a Recipe node with no ingredients — there is nothing to estimate from', () => {
    expect(extractRecipeJsonLd(ld({ '@type': 'Recipe', name: 'Empty', recipeIngredient: [] }))).toBeNull()
  })

  it('strips tags and control characters out of ingredient lines', () => {
    const html = ld({ '@type': 'Recipe', name: 'X', recipeIngredient: ['<b>2</b> eggs', '  1  cup   milk  '] })
    expect(extractRecipeJsonLd(html)?.ingredients).toEqual(['2 eggs', '1 cup milk'])
  })
})

describe('parseRecipeYield', () => {
  it('reads the common shapes', () => {
    expect(parseRecipeYield(4)).toBe(4)
    expect(parseRecipeYield('4')).toBe(4)
    expect(parseRecipeYield('Serves 6')).toBe(6)
    expect(parseRecipeYield(['4 servings', '4'])).toBe(4)
  })

  it('returns null rather than guessing, so the caller can ask', () => {
    // A missing or unusable yield must not silently become 1 — that is a 4x calorie error
    // that looks entirely plausible.
    expect(parseRecipeYield(undefined)).toBeNull()
    expect(parseRecipeYield('a loaf')).toBeNull()
    expect(parseRecipeYield('200 servings')).toBeNull()
  })
})

describe('extractReadableText', () => {
  it('drops script and style bodies', () => {
    const html = '<html><head><style>.a{color:red}</style></head><body>' +
      '<script>alert("ignore me")</script><p>2 eggs</p><p>1 cup flour</p></body></html>'
    const text = extractReadableText(html)
    expect(text).toContain('2 eggs')
    expect(text).toContain('1 cup flour')
    expect(text).not.toContain('alert')
    expect(text).not.toContain('color:red')
  })

  it('decodes entities and collapses whitespace', () => {
    expect(extractReadableText('<p>Salt &amp; pepper&#8212;to taste</p>')).toBe('Salt & pepper—to taste')
  })
})

describe('extractReadableText — page chrome', () => {
  it('drops nav, header, footer and aside so the fallback text is not mostly menus', () => {
    const html = '<html><body><nav>Home Recipes Login</nav><header>Site Name</header>' +
      '<main><h2>Ingredients</h2><p>2 eggs</p></main>' +
      '<aside>You may also like</aside><footer>Copyright</footer></body></html>'
    const text = extractReadableText(html)
    expect(text).toContain('2 eggs')
    for (const chrome of ['Home Recipes Login', 'Site Name', 'You may also like', 'Copyright']) {
      expect(text).not.toContain(chrome)
    }
  })
})

describe('sliceAroundIngredients', () => {
  it('starts at the Ingredients heading rather than the top of the page', () => {
    const text = 'Some long preamble about the author holiday story\nIngredients\n2 eggs\n1 cup flour\nMethod'
    expect(sliceAroundIngredients(text, 200)).toBe('Ingredients\n2 eggs\n1 cup flour\nMethod')
  })

  it('falls back to the head of the text when there is no heading', () => {
    expect(sliceAroundIngredients('no heading here at all', 200)).toBe('no heading here at all')
  })

  it('honours the character cap', () => {
    expect(sliceAroundIngredients('Ingredients\n' + 'x'.repeat(500), 30)).toHaveLength(30)
  })
})
