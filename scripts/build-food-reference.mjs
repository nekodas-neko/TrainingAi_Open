#!/usr/bin/env node
// Builds packages/shared/src/nutrition/food-reference/fdc-sr-legacy.ts, the bundled table of common
// whole foods behind `resolveIngredientDensity` (#3749).
//
//     curl -O https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_json_2018-04.zip
//     unzip FoodData_Central_sr_legacy_food_json_2018-04.zip
//     node scripts/build-food-reference.mjs FoodData_Central_sr_legacy_food_json_2018-04.json
//
// The source is USDA FoodData Central, SR Legacy (April 2018), which is public domain (CC0). Every
// number in the output is read from that file. Nothing here states a number: the list below says
// only WHICH row answers to WHICH names, and the script refuses to write if a row is missing, its
// description is not the one expected, or it lacks any of the four values.
//
// ## Names: exact strings only
//
// The resolver matches a name after case and whitespace folding (`text()` in
// food-item-identity.ts) and nothing looser, so every spelling a row answers to is listed. A food
// whose numbers depend on its state (rice is 130 kcal cooked and 365 dry; chicken breast 120 raw and
// 165 roasted) has NO bare name: "rice" or "chicken breast" stays unmatched, and keeps the model's
// own figure marked as an estimate, rather than the table picking a state for it. Only a name that
// says the state ("cooked white rice", "white rice, cooked", "white rice (cooked)") matches.
//
// Re-running the script on the same file produces the same output byte for byte.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'packages/shared/src/nutrition/food-reference/fdc-sr-legacy.ts')

const DATASET = {
  name: 'USDA FoodData Central, SR Legacy',
  release: '2018-04',
  file: 'FoodData_Central_sr_legacy_food_json_2018-04.json',
  url: 'https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_json_2018-04.zip',
  licence: 'Public domain (CC0 1.0), U.S. Department of Agriculture, Agricultural Research Service',
}

// FDC nutrient ids. Carbohydrate is "by difference", which is what SR Legacy reports and what a
// label's total carbohydrate means.
const NUTRIENT = { kcal: 1008, protein: 1003, fat: 1004, carbs: 1005 }

/** "B, S", "B (S)", "S B" — the three ways a stated preparation is written. */
function stated(base, ...states) {
  return states.flatMap(s => [`${base}, ${s}`, `${base} (${s})`, `${s} ${base}`])
}

// [fdcId, the start of its FDC description, the names it answers to]
const ROWS = [
  // Fruit. Eaten as is, so the plain name is the food.
  [171688, 'Apples, raw, with skin', ['apple', 'apples', 'red apple', 'green apple']],
  [169118, 'Pears, raw', ['pear', 'pears']],
  [169097, 'Oranges, raw, all commercial varieties', ['orange', 'oranges']],
  [167762, 'Strawberries, raw', ['strawberry', 'strawberries', 'fresh strawberries']],
  [171711, 'Blueberries, raw', ['blueberry', 'blueberries', 'fresh blueberries']],
  [167755, 'Raspberries, raw', ['raspberry', 'raspberries', 'fresh raspberries']],
  [173946, 'Blackberries, raw', ['blackberry', 'blackberries']],
  [174683, 'Grapes, red or green', ['grapes', 'red grapes', 'green grapes']],
  [169910, 'Mangos, raw', ['mango', 'mangoes', 'mangos']],
  [169124, 'Pineapple, raw, all varieties', ['pineapple', 'fresh pineapple']],
  [168153, 'Kiwifruit, green, raw', ['kiwi', 'kiwifruit', 'kiwi fruit']],
  [167765, 'Watermelon, raw', ['watermelon']],
  [169092, 'Melons, cantaloupe, raw', ['cantaloupe', 'rockmelon']],
  [171705, 'Avocados, raw, all commercial varieties', ['avocado', 'avocados']],
  [169928, 'Peaches, yellow, raw', ['peach', 'peaches']],
  [169105, 'Tangerines, (mandarin oranges), raw', ['mandarin', 'mandarins', 'tangerine', 'tangerines']],
  [171719, 'Cherries, sweet, raw', ['cherries', 'cherry']],
  [169949, 'Plums, raw', ['plum', 'plums']],
  [171697, 'Apricots, raw', ['apricot', 'apricots']],
  [173021, 'Figs, raw', ['fig', 'figs', 'fresh figs']],
  [174673, 'Grapefruit, raw, pink and red, all areas', ['grapefruit', 'pink grapefruit']],
  [173944, 'Bananas, raw', ['banana', 'bananas']],
  [168191, 'Dates, medjool', ['medjool dates', 'medjool date', 'dates']],
  [167747, 'Lemon juice, raw', ['lemon juice', 'fresh lemon juice']],

  // Vegetables. Raw rows take the plain name only where cooking barely moves the numbers per
  // 100 g; potatoes, sweet potato and peas, which do move, are named by state.
  [170379, 'Broccoli, raw', ['broccoli', 'raw broccoli', 'broccoli florets']],
  [169967, 'Broccoli, cooked, boiled, drained, without salt', [...stated('broccoli', 'steamed', 'boiled', 'cooked')]],
  [168462, 'Spinach, raw', ['spinach', 'baby spinach', 'fresh spinach', 'raw spinach', 'spinach leaves']],
  [168463, 'Spinach, cooked, boiled, drained, without salt', [...stated('spinach', 'cooked', 'wilted', 'boiled')]],
  [170393, 'Carrots, raw', ['carrot', 'carrots', 'raw carrot', 'grated carrot']],
  [170394, 'Carrots, cooked, boiled, drained, without salt', [...stated('carrots', 'boiled', 'steamed', 'cooked'), ...stated('carrot', 'boiled', 'steamed', 'cooked')]],
  [170457, 'Tomatoes, red, ripe, raw, year round average', ['tomato', 'tomatoes', 'cherry tomatoes', 'cherry tomato', 'fresh tomato']],
  [170051, 'Tomatoes, red, ripe, canned, packed in tomato juice', ['canned tomatoes', 'tinned tomatoes', 'diced tomatoes, canned', 'canned diced tomatoes', 'chopped tomatoes, canned']],
  [168409, 'Cucumber, with peel, raw', ['cucumber', 'cucumbers']],
  [169247, 'Lettuce, cos or romaine, raw', ['cos lettuce', 'romaine lettuce', 'romaine']],
  [169248, 'Lettuce, iceberg', ['iceberg lettuce', 'lettuce']],
  [169387, 'Arugula, raw', ['rocket', 'arugula']],
  [170000, 'Onions, raw', ['onion', 'onions', 'brown onion', 'white onion', 'red onion']],
  [170001, 'Onions, cooked, boiled, drained, without salt', [...stated('onion', 'cooked', 'sauteed', 'sautéed')]],
  [169230, 'Garlic, raw', ['garlic', 'garlic clove', 'garlic cloves', 'minced garlic']],
  [170108, 'Peppers, sweet, red, raw', ['red capsicum', 'red bell pepper', 'capsicum']],
  [170427, 'Peppers, sweet, green, raw', ['green capsicum', 'green bell pepper']],
  [169251, 'Mushrooms, white, raw', ['mushrooms', 'mushroom', 'button mushrooms', 'white mushrooms']],
  [169252, 'Mushrooms, white, cooked, boiled, drained, without salt', [...stated('mushrooms', 'cooked', 'sauteed', 'sautéed')]],
  [169291, 'Squash, summer, zucchini, includes skin, raw', ['zucchini', 'courgette']],
  [169986, 'Cauliflower, raw', ['cauliflower']],
  [169975, 'Cabbage, raw', ['cabbage', 'green cabbage', 'white cabbage']],
  [168421, 'Kale, raw', ['kale']],
  [170017, 'Peas, green, frozen, cooked, boiled, drained, without salt', ['frozen peas, cooked', 'green peas, cooked', ...stated('peas', 'cooked', 'boiled', 'steamed')]],
  [169998, 'Corn, sweet, yellow, raw', ['sweet corn', 'corn kernels']],
  [168482, 'Sweet potato, raw, unprepared', [...stated('sweet potato', 'raw')]],
  [168483, 'Sweet potato, cooked, baked in skin, flesh, without salt', [...stated('sweet potato', 'baked', 'roasted', 'cooked')]],
  [170026, 'Potatoes, flesh and skin, raw', [...stated('potato', 'raw'), ...stated('potatoes', 'raw')]],
  [170438, 'Potatoes, boiled, cooked in skin, flesh, without salt', [...stated('potato', 'boiled', 'cooked'), ...stated('potatoes', 'boiled', 'cooked')]],
  [170093, 'Potatoes, baked, flesh and skin, without salt', [...stated('potato', 'baked'), ...stated('potatoes', 'baked'), 'jacket potato']],
  [169961, 'Beans, snap, green, raw', ['green beans', 'string beans']],
  [168389, 'Asparagus, raw', ['asparagus']],
  [169988, 'Celery, raw', ['celery', 'celery sticks']],
  [169145, 'Beets, raw', ['beetroot', 'beets', 'beet']],
  [168448, 'Pumpkin, raw', [...stated('pumpkin', 'raw'), 'pumpkin']],
  [169228, 'Eggplant, raw', ['eggplant', 'aubergine']],
  [170383, 'Brussels sprouts, raw', ['brussels sprouts', 'brussel sprouts']],

  // Meat and fish, always by state: raw and cooked differ by a third or more per 100 g.
  [171077, 'Chicken, broiler or fryers, breast, skinless, boneless, meat only, raw', [...stated('chicken breast', 'raw'), 'raw skinless chicken breast']],
  [171477, 'Chicken, broilers or fryers, breast, meat only, cooked, roasted', [...stated('chicken breast', 'cooked', 'grilled', 'roasted', 'baked')]],
  [172388, 'Chicken, broilers or fryers, thigh, meat only, cooked, roasted', [...stated('chicken thigh', 'cooked', 'roasted', 'grilled', 'baked'), ...stated('chicken thighs', 'cooked', 'roasted', 'grilled', 'baked')]],
  [171790, 'Beef, ground, 95% lean meat / 5% fat, raw', ['95% lean beef mince, raw', 'extra lean beef mince, raw', '95% lean ground beef, raw']],
  [174030, 'Beef, ground, 90% lean meat / 10% fat, raw', ['90% lean beef mince, raw', 'lean beef mince, raw', '90% lean ground beef, raw']],
  [171796, 'Beef, ground, 85% lean meat / 15% fat, raw', ['85% lean beef mince, raw', '85% lean ground beef, raw']],
  [174763, 'Beef, top sirloin, steak, separable lean only, trimmed to 1/8" fat, choice, raw', [...stated('sirloin steak', 'raw'), ...stated('lean beef steak', 'raw')]],
  [173118, 'Beef, top sirloin, steak, separable lean only, trimmed to 1/8" fat, choice, cooked, broiled', [...stated('sirloin steak', 'cooked', 'grilled'), ...stated('lean beef steak', 'cooked', 'grilled')]],
  [174370, 'Lamb, ground, raw', [...stated('lamb mince', 'raw'), ...stated('ground lamb', 'raw')]],
  [172544, 'Lamb, ground, cooked, broiled', [...stated('lamb mince', 'cooked'), ...stated('ground lamb', 'cooked')]],
  [168249, 'Pork, fresh, loin, tenderloin, separable lean only, raw', [...stated('pork tenderloin', 'raw'), ...stated('pork fillet', 'raw')]],
  [168250, 'Pork, fresh, loin, tenderloin, separable lean only, cooked, roasted', [...stated('pork tenderloin', 'cooked', 'roasted'), ...stated('pork fillet', 'cooked', 'roasted')]],
  [171505, 'Turkey, Ground, raw', [...stated('turkey mince', 'raw'), ...stated('ground turkey', 'raw')]],
  [171506, 'Turkey, Ground, cooked', [...stated('turkey mince', 'cooked'), ...stated('ground turkey', 'cooked')]],
  [168277, 'Pork, cured, bacon, unprepared', [...stated('bacon', 'raw', 'uncooked')]],
  [175167, 'Fish, salmon, Atlantic, farmed, raw', [...stated('salmon', 'raw'), ...stated('salmon fillet', 'raw'), ...stated('atlantic salmon', 'raw')]],
  [175168, 'Fish, salmon, Atlantic, farmed, cooked, dry heat', [...stated('salmon', 'cooked', 'baked', 'grilled', 'pan-fried'), ...stated('salmon fillet', 'cooked', 'baked', 'grilled', 'pan-fried')]],
  [173690, 'Fish, salmon, pink, canned, total can contents', ['canned salmon', 'tinned salmon', 'pink salmon, canned']],
  [173709, 'Fish, tuna, light, canned in water, drained solids', ['tuna in water', 'canned tuna in water', 'tinned tuna in springwater', 'tuna in springwater', 'canned tuna, drained', 'tinned tuna in water']],
  [175159, 'Fish, tuna, fresh, yellowfin, raw', [...stated('tuna steak', 'raw'), ...stated('yellowfin tuna', 'raw')]],
  [171955, 'Fish, cod, Atlantic, raw', [...stated('cod', 'raw'), ...stated('cod fillet', 'raw')]],
  [171956, 'Fish, cod, Atlantic, cooked, dry heat', [...stated('cod', 'cooked', 'baked'), ...stated('cod fillet', 'cooked', 'baked')]],
  [175176, 'Fish, tilapia, raw', [...stated('tilapia', 'raw')]],
  [175177, 'Fish, tilapia, cooked, dry heat', [...stated('tilapia', 'cooked', 'baked')]],
  [175179, 'Crustaceans, shrimp, raw', [...stated('prawns', 'raw'), ...stated('shrimp', 'raw')]],
  [175180, 'Crustaceans, shrimp, cooked', [...stated('prawns', 'cooked'), ...stated('shrimp', 'cooked')]],

  // Eggs. Raw, poached and boiled are within 10 kcal per 100 g of each other; fried and scrambled
  // carry the fat they were cooked in, so those are named by state.
  [171287, 'Egg, whole, raw, fresh', ['egg', 'eggs', 'whole egg', 'whole eggs', 'large egg', 'large eggs', ...stated('egg', 'raw'), ...stated('eggs', 'raw')]],
  [173424, 'Egg, whole, cooked, hard-boiled', [...stated('egg', 'boiled', 'hard-boiled'), ...stated('eggs', 'boiled', 'hard-boiled'), 'hard boiled egg', 'hard boiled eggs']],
  [172186, 'Egg, whole, cooked, poached', [...stated('egg', 'poached'), ...stated('eggs', 'poached')]],
  [172187, 'Egg, whole, cooked, scrambled', ['scrambled eggs', 'scrambled egg']],
  [173423, 'Egg, whole, cooked, fried', ['fried egg', 'fried eggs']],
  [172183, 'Egg, white, raw, fresh', ['egg white', 'egg whites', 'liquid egg whites']],

  // Dairy.
  [171265, 'Milk, whole, 3.25% milkfat, with added vitamin D', ['whole milk', 'full cream milk', 'full-cream milk', 'full fat milk']],
  [171267, 'Milk, reduced fat, fluid, 2% milkfat, with added vitamin A and vitamin D', ['reduced fat milk', '2% milk', 'lite milk', 'light milk']],
  [170872, 'Milk, lowfat, fluid, 1% milkfat, with added vitamin A and vitamin D', ['low fat milk', 'low-fat milk', '1% milk']],
  [171269, 'Milk, nonfat, fluid, with added vitamin A and vitamin D (fat free or skim)', ['skim milk', 'skimmed milk', 'fat free milk', 'nonfat milk']],
  [170880, 'Milk, chocolate, fluid, commercial, reduced fat, with added vitamin A and vitamin D', ['chocolate milk', 'reduced fat chocolate milk']],
  [174832, 'Beverages, almond milk, unsweetened, shelf stable', ['unsweetened almond milk', 'almond milk, unsweetened']],
  [175215, 'Soymilk (all flavors), unsweetened, with added calcium, vitamins A and D', ['unsweetened soy milk', 'soy milk, unsweetened']],
  [170894, 'Yogurt, Greek, plain, nonfat', ['nonfat greek yogurt', 'non-fat greek yogurt', 'fat free greek yogurt', 'nonfat greek yoghurt', 'non-fat greek yoghurt', 'fat free greek yoghurt', 'plain nonfat greek yogurt']],
  [170903, 'Yogurt, Greek, plain, lowfat', ['low fat greek yogurt', 'low-fat greek yogurt', 'low fat greek yoghurt', 'low-fat greek yoghurt']],
  [171304, 'Yogurt, Greek, plain, whole milk', ['full fat greek yogurt', 'full-fat greek yogurt', 'full fat greek yoghurt', 'full-fat greek yoghurt', 'whole milk greek yogurt']],
  [171284, 'Yogurt, plain, whole milk', ['plain yogurt', 'plain yoghurt', 'natural yoghurt', 'natural yogurt']],
  [170886, 'Yogurt, plain, low fat', ['low fat plain yogurt', 'low fat natural yoghurt', 'low-fat natural yoghurt']],
  [170888, 'Yogurt, vanilla, low fat.', ['vanilla yogurt', 'vanilla yoghurt', 'low fat vanilla yogurt', 'low fat vanilla yoghurt']],
  [173414, 'Cheese, cheddar', ['cheddar', 'cheddar cheese', 'tasty cheese']],
  [171292, 'Cheese, cheddar, reduced fat', ['reduced fat cheddar', 'light cheddar', 'reduced fat cheese']],
  [170845, 'Cheese, mozzarella, whole milk', ['mozzarella', 'mozzarella cheese', 'fresh mozzarella']],
  [170847, 'Cheese, mozzarella, part skim milk', ['part skim mozzarella', 'light mozzarella', 'reduced fat mozzarella']],
  [171247, 'Cheese, parmesan, grated', ['parmesan', 'parmesan cheese', 'grated parmesan']],
  [173420, 'Cheese, feta', ['feta', 'feta cheese']],
  [172179, 'Cheese, cottage, creamed, large or small curd', ['cottage cheese']],
  [172182, 'Cheese, cottage, lowfat, 2% milkfat', ['low fat cottage cheese', 'low-fat cottage cheese', 'light cottage cheese']],
  [170851, 'Cheese, ricotta, whole milk', ['ricotta', 'ricotta cheese']],
  [173418, 'Cheese, cream', ['cream cheese']],
  [171251, 'Cheese, swiss', ['swiss cheese']],
  [173430, 'Butter, without salt', ['unsalted butter']],
  [173410, 'Butter, salted', ['butter', 'salted butter']],
  [170859, 'Cream, fluid, heavy whipping', ['heavy cream', 'thickened cream', 'whipping cream', 'double cream']],
  [167575, 'Ice creams, vanilla', ['vanilla ice cream']],

  // Grains and starches, by state: dry and cooked differ about threefold.
  [168877, 'Rice, white, long-grain, regular, raw, enriched', [...stated('white rice', 'raw', 'uncooked', 'dry'), ...stated('rice', 'raw', 'uncooked', 'dry')]],
  [169753, 'Rice, white, long-grain, regular, cooked, enriched, with salt', [...stated('white rice', 'cooked', 'steamed', 'boiled'), ...stated('rice', 'cooked', 'steamed', 'boiled'), ...stated('long grain rice', 'cooked'), ...stated('jasmine rice', 'cooked', 'steamed'), ...stated('basmati rice', 'cooked', 'steamed')]],
  [169703, 'Rice, brown, long-grain, raw', [...stated('brown rice', 'raw', 'uncooked', 'dry')]],
  [169704, 'Rice, brown, long-grain, cooked', [...stated('brown rice', 'cooked', 'steamed', 'boiled')]],
  [168874, 'Quinoa, uncooked', [...stated('quinoa', 'raw', 'uncooked', 'dry')]],
  [168917, 'Quinoa, cooked', [...stated('quinoa', 'cooked')]],
  [169736, 'Pasta, dry, enriched', [...stated('pasta', 'dry', 'uncooked', 'raw'), ...stated('spaghetti', 'dry', 'uncooked'), ...stated('penne', 'dry', 'uncooked')]],
  [169737, 'Pasta, cooked, enriched, without added salt', [...stated('pasta', 'cooked', 'boiled'), ...stated('spaghetti', 'cooked'), ...stated('penne', 'cooked')]],
  [169731, 'Noodles, egg, dry, enriched', [...stated('egg noodles', 'dry', 'uncooked')]],
  [168919, 'Noodles, egg, cooked, enriched, with added salt', [...stated('egg noodles', 'cooked')]],
  [168914, 'Rice noodles, cooked', [...stated('rice noodles', 'cooked')]],
  [169699, 'Couscous, dry', [...stated('couscous', 'dry', 'uncooked')]],
  [169700, 'Couscous, cooked', [...stated('couscous', 'cooked')]],
  [170287, 'Bulgur, cooked', [...stated('bulgur', 'cooked'), ...stated('bulgur wheat', 'cooked')]],
  [173904, 'Cereals, oats, regular and quick, not fortified, dry', ['rolled oats', 'oats', 'quick oats', 'oatmeal, dry', ...stated('rolled oats', 'dry', 'uncooked', 'raw'), ...stated('oats', 'dry', 'uncooked', 'raw')]],
  [173905, 'Cereals, oats, regular and quick, unenriched, cooked with water', ['porridge made with water', ...stated('oats', 'cooked with water'), ...stated('oatmeal', 'cooked with water')]],
  [171646, 'Cereals ready-to-eat, granola, homemade', ['granola', 'homemade granola']],
  [168894, 'Wheat flour, white, all-purpose, enriched, bleached', ['plain flour', 'all-purpose flour', 'all purpose flour', 'white flour']],
  [172688, 'Bread, whole-wheat, commercially prepared', ['wholemeal bread', 'whole wheat bread', 'whole-wheat bread', 'wholemeal toast']],
  [174924, 'Bread, white, commercially prepared', ['white bread', 'white toast']],
  [168013, 'Bread, multi-grain', ['multigrain bread', 'multi-grain bread', 'grain bread']],
  [172684, 'Bread, rye', ['rye bread']],
  [174915, 'Bread, pita, white, enriched', ['pita bread', 'pita', 'white pita']],
  [174899, 'Bagels, plain, enriched, with calcium propionate', ['bagel', 'plain bagel']],
  [175037, 'Tortillas, ready-to-bake or -fry, flour, refrigerated', ['flour tortilla', 'flour tortillas']],
  [175036, 'Tortillas, ready-to-bake or -fry, corn', ['corn tortilla', 'corn tortillas']],
  [170250, 'Snacks, rice cakes, brown rice, plain, unsalted', ['rice cake', 'rice cakes', 'plain rice cakes']],
  [167959, 'Snacks, popcorn, air-popped', ['air-popped popcorn', 'air popped popcorn', 'plain popcorn']],

  // Legumes and soy.
  [173735, 'Beans, black, mature seeds, cooked, boiled, without salt', [...stated('black beans', 'cooked', 'boiled')]],
  [173801, 'Chickpeas (garbanzo beans, bengal gram), mature seeds, canned, drained, rinsed in tap water', ['canned chickpeas', 'tinned chickpeas', 'chickpeas, drained', 'chickpeas, canned, drained']],
  [172421, 'Lentils, mature seeds, cooked, boiled, without salt', [...stated('lentils', 'cooked', 'boiled'), 'cooked brown lentils', 'cooked green lentils']],
  [175194, 'Beans, kidney, red, mature seeds, cooked, boiled, without salt', [...stated('kidney beans', 'cooked'), ...stated('red kidney beans', 'cooked')]],
  [175182, 'Beans, baked, canned, plain or vegetarian', ['baked beans', 'canned baked beans']],
  [168411, 'Edamame, frozen, prepared', ['edamame', 'edamame beans', 'shelled edamame']],
  [172475, 'Tofu, raw, firm, prepared with calcium sulfate', ['firm tofu', 'tofu, firm', 'extra firm tofu']],
  [174289, 'Hummus, commercial', ['hummus', 'houmous']],

  // Nuts and seeds.
  [170567, 'Nuts, almonds', ['almonds', 'almond', 'raw almonds']],
  [170187, 'Nuts, walnuts, english', ['walnuts', 'walnut']],
  [170162, 'Nuts, cashew nuts, raw', ['cashews', 'cashew nuts', 'raw cashews']],
  [170182, 'Nuts, pecans', ['pecans', 'pecan nuts']],
  [170178, 'Nuts, macadamia nuts, raw', ['macadamias', 'macadamia nuts', 'macadamia']],
  [170184, 'Nuts, pistachio nuts, raw', ['pistachios', 'pistachio nuts']],
  [170569, 'Nuts, brazilnuts, dried, unblanched', ['brazil nuts', 'brazil nut']],
  [172430, 'Peanuts, all types, raw', ['peanuts', 'raw peanuts']],
  [173806, 'Peanuts, all types, dry-roasted, without salt', ['dry roasted peanuts', 'roasted peanuts, unsalted']],
  [172470, 'Peanut butter, smooth style, without salt', ['peanut butter', 'smooth peanut butter', 'natural peanut butter']],
  [170554, 'Seeds, chia seeds, dried', ['chia seeds', 'chia']],
  [169414, 'Seeds, flaxseed', ['flaxseed', 'flaxseeds', 'linseed', 'linseeds', 'ground flaxseed']],
  [170556, 'Seeds, pumpkin and squash seed kernels, dried', ['pumpkin seeds', 'pepitas']],
  [170562, 'Seeds, sunflower seed kernels, dried', ['sunflower seeds']],
  [170150, 'Seeds, sesame seeds, whole, dried', ['sesame seeds']],
  [170173, 'Nuts, coconut milk, canned', ['coconut milk', 'canned coconut milk']],

  // Oils, sweeteners and a few everyday extras.
  [171413, 'Oil, olive, salad or cooking', ['olive oil', 'extra virgin olive oil', 'extra-virgin olive oil', 'evoo']],
  [172336, 'Oil, canola', ['canola oil', 'rapeseed oil']],
  [171412, 'Oil, coconut', ['coconut oil']],
  [171016, 'Oil, sesame, salad or cooking', ['sesame oil']],
  [169640, 'Honey', ['honey']],
  [169661, 'Syrups, maple', ['maple syrup', 'pure maple syrup']],
  [169655, 'Sugars, granulated', ['sugar', 'white sugar', 'granulated sugar', 'caster sugar']],
  [169641, 'Jams and preserves', ['jam', 'fruit jam', 'strawberry jam']],
  [170273, 'Chocolate, dark, 70-85% cacao solids', ['dark chocolate', '70% dark chocolate', '85% dark chocolate']],
  [171890, 'Beverages, coffee, brewed, prepared with tap water', ['black coffee', 'brewed coffee', 'filter coffee']],
  [171891, 'Beverages, coffee, brewed, espresso, restaurant-prepared', ['espresso', 'espresso shot']],
  [168556, 'Catsup', ['ketchup', 'tomato ketchup', 'tomato sauce (ketchup)']],
  [174277, 'Soy sauce made from soy and wheat (shoyu)', ['soy sauce']],
  [171192, 'Sauce, pasta, spaghetti/marinara, ready-to-serve', ['marinara sauce', 'pasta sauce', 'passata-based pasta sauce']],
]

const file = process.argv[2]
if (!file) {
  console.error('Usage: node scripts/build-food-reference.mjs <path to FoodData_Central_sr_legacy_food_json_2018-04.json>')
  process.exit(2)
}

const foods = JSON.parse(fs.readFileSync(file, 'utf8')).SRLegacyFoods
if (!Array.isArray(foods)) throw new Error('Not an SR Legacy JSON file: no SRLegacyFoods array')
const byId = new Map(foods.map(f => [f.fdcId, f]))

const fold = s => s.trim().toLowerCase().replace(/\s+/g, ' ')
const seenNames = new Map()
const out = []
const problems = []

for (const [fdcId, expected, names] of ROWS) {
  const food = byId.get(fdcId)
  if (!food) { problems.push(`${fdcId}: not in the file`); continue }
  if (!food.description.startsWith(expected)) {
    problems.push(`${fdcId}: description is "${food.description}", expected it to start "${expected}"`)
    continue
  }
  const amount = id => food.foodNutrients.find(n => n.nutrient?.id === id)?.amount
  const values = {
    kcal: amount(NUTRIENT.kcal), proteinG: amount(NUTRIENT.protein),
    carbsG: amount(NUTRIENT.carbs), fatG: amount(NUTRIENT.fat),
  }
  for (const [k, v] of Object.entries(values)) {
    if (typeof v !== 'number' || !Number.isFinite(v)) problems.push(`${fdcId}: no ${k}`)
  }
  const folded = [...new Set(names.map(fold))]
  for (const n of folded) {
    if (seenNames.has(n)) problems.push(`"${n}" is listed for both ${seenNames.get(n)} and ${fdcId}`)
    seenNames.set(n, fdcId)
  }
  out.push({ fdcId, description: food.description, names: folded, ...values })
}

if (problems.length) {
  console.error(problems.join('\n'))
  process.exit(1)
}

const body = `// GENERATED by scripts/build-food-reference.mjs from ${DATASET.file}. Do not edit by hand:
// change the script and re-run it against the same download.
//
// Source: ${DATASET.name}, release ${DATASET.release} (${DATASET.url}).
// Licence: ${DATASET.licence}.
// Values are per 100 g of the food as described: energy (kcal, nutrient 1008), protein (1003),
// carbohydrate by difference (1005), total fat (1004).

import type { FoodReferenceDataset, FoodReferenceRow } from './types'

export const FDC_SR_LEGACY: FoodReferenceDataset = ${JSON.stringify({ name: DATASET.name, release: DATASET.release, url: DATASET.url, licence: DATASET.licence }, null, 2)}

export const FDC_SR_LEGACY_ROWS: readonly FoodReferenceRow[] = [
${out.map(r => `  ${JSON.stringify(r)},`).join('\n')}
]
`
fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, body)
console.log(`Wrote ${out.length} rows, ${seenNames.size} names, to ${path.relative(ROOT, OUT)}`)
