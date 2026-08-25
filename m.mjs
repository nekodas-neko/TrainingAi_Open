import { chromium } from '@playwright/test'
import { readFileSync } from 'fs'
const state = JSON.parse(readFileSync('e2e/.auth/seed-user.json','utf8'))
const theme = process.env.THEME || 'light'
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const ctx = await b.newContext({ viewport:{width:412,height:915}, hasTouch:true, serviceWorkers:'block', storageState: state })
const p = await ctx.newPage()
const errs=[]; p.on('pageerror', e=>errs.push(String(e).slice(0,200)))
await p.addInitScript(t => localStorage.setItem('theme', t), theme)
await p.goto('http://localhost:3100/nutrition', { waitUntil:'domcontentloaded', timeout:180000 })
await p.waitForSelector('text=SUPPLEMENTS', { timeout: 150000 })
await p.waitForTimeout(5000)
const m = await p.evaluate(() => {
  const sc = document.querySelector('.scrollbar-hide')
  let gap = 0
  const walk = el => { for (const k of el.children) { const cs = getComputedStyle(k); gap += parseFloat(cs.marginTop||0)+parseFloat(cs.marginBottom||0); walk(k) } }
  walk(sc)
  return { scrollHeight: sc.scrollHeight, gaps: Math.round(gap) }
})
const t = await p.locator('body').innerText()
const checks = {
  'ScreenHeader + date nav': /Food diary & macros/.test(t) && /Today/.test(t),
  'CalorieBalanceBar': /ENERGY BALANCE/.test(t),
  'MacroRing': /Daily goal/.test(t) && /Protein/.test(t),
  'NutritionActionRow': /Log Food/.test(t) && /Saved Meals/.test(t),
  'MealPlan card/section': /meal plan/i.test(t),
  'TdeeAdaptationCard': /maintenance|Why two numbers/i.test(t),
  'MealCard x meal types': (t.match(/Add food/g) || []).length >= 3,
  'FoodLoggingComplete': /finished logging/i.test(t),
  'WeeklyNutritionChart': /7-DAY NUTRITION/.test(t),
  'SupplementsSection': /SUPPLEMENTS/.test(t),
  'End of Day': /End of Day/.test(t),
}
console.log(process.env.LABEL, theme, JSON.stringify(m), '| gaps', Math.round(m.gaps/m.scrollHeight*100)+'%')
console.log('  checklist:', Object.values(checks).filter(Boolean).length, 'of', Object.keys(checks).length,
  '| missing:', Object.entries(checks).filter(([,v])=>!v).map(([k])=>k).join(', ') || 'none')
console.log('  macro %:', t.split('\n').filter(l=>/^\d+%$/.test(l.trim())).join(' '), '| errors:', errs.length)
await p.screenshot({ path: `/tmp/grouped-${theme}.png` })
await b.close()
