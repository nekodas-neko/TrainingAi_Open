export const DATASET_BASE = "https://raw.githubusercontent.com/nekodas-neko/exercises-dataset/main";
const DATASET_JSON_URL = `${DATASET_BASE}/data/exercises.json`;

export interface DatasetExercise {
  name: string;
  gif_url: string;
  image: string;
  instruction_steps?: { en?: string[] };
  instructions?: { en?: string };
}

let datasetIndex: Map<string, DatasetExercise> | null = null;
let datasetLoadPromise: Promise<void> | null = null;

const ABBREVS: Record<string, string> = {
  db: "dumbbell", dbs: "dumbbells", bb: "barbell",
  ohp: "overhead press", rdl: "romanian deadlift",
  ez: "ez bar", kg: "", lbs: "",
  // Typo corrections
  dumbell: "dumbbell", dumbells: "dumbbells",
  romainian: "romanian", romanian: "romanian",
};

// Direct URL overrides for custom GIFs added manually to the forked repo.
// Key = normalized exercise name, value = { gifUrl, imageUrl }
export const DIRECT_URL_OVERRIDES: Record<string, { gifUrl: string; imageUrl: string | null }> = {
  "landmine press": {
    gifUrl: `${DATASET_BASE}/videos/landminepress.gif`,
    imageUrl: null,
  },
  "hip thrust": {
    gifUrl: `${DATASET_BASE}/videos/barbell-hip-thrust.gif`,
    imageUrl: null,
  },
  "barbell hip thrust": {
    gifUrl: `${DATASET_BASE}/videos/barbell-hip-thrust.gif`,
    imageUrl: null,
  },
  "single leg hip thrust": {
    gifUrl: `${DATASET_BASE}/videos/single-leg-hip-thrusts.gif`,
    imageUrl: null,
  },
  "single leg barbell hip thrust": {
    gifUrl: `${DATASET_BASE}/videos/single-leg-hip-thrusts.gif`,
    imageUrl: null,
  },
};

// Manual overrides: normalized incoming name → better search term
export const MANUAL_OVERRIDES: Record<string, string> = {
  // Custom exercise names
  "tricep cable combo":      "cable tricep pushdown",
  "cable chest dips":        "cable crossover",
  "cable fly":               "cable crossover",
  // Generic muscle-group names → a representative exercise
  "abs":                     "crunch",
  "core":                    "crunch",
  // Cable row variants
  "single arm cable row":    "cable one arm row",
  "one arm cable row":       "cable one arm row",
  // Chin-up variants
  "chin up":                 "pull up",
  "chin ups":                "pull up",
  "chin down":               "lat pulldown",
  "chin downs":              "lat pulldown",
  // Preacher curl — dataset may not have dumbbell-specific variant
  "dumbbell preacher curl":  "preacher curl",

  // Original library exercises — dataset often uses different casing or prefixes
  "incline bench press":           "incline barbell bench press",
  "decline bench press":           "decline barbell bench press",
  "chest fly":                     "dumbbell fly",
  "pec deck":                      "chest fly",
  "close grip bench":              "close grip bench press",
  "tricep pushdown":               "cable tricep pushdown",
  "dumbbell curl":                 "dumbbell biceps curl",
  "barbell curl":                  "barbell bicep curl",
  "cable row":                     "seated cable row",
  "seated row":                    "seated cable row",
  "cable pulldown":                "lat pulldown",
  "cable curls":                   "cable curl",
  // Hyphens are stripped by normalizeExerciseName, so keys here use the normalised form.
  // "T-Bar Row" → "tbar row", "Bent-Over Barbell Row" → "bentover barbell row"
  "tbar row":                      "t bar row",
  "bentover barbell row":          "barbell bent over row",
  "adductor machine":              "hip adduction",
  "dumbbell shoulder press":       "seated dumbbell shoulder press",
  // Glute bridge — not a hip thrust, needs its own dataset match
  "barbell glute bridge":          "glute bridge",
  "bodyweight glute bridge":       "glute bridge",

  // Equipment-specific variants added in migration 032.
  // Self-referential entries are intentionally omitted — the contains-match in
  // findBestMatch (step 3/4) handles them: "barbell shrug" contains "shrug" etc.
  "barbell squat":                      "barbell full squat",
  "barbell front squat":                "front squat",
  "barbell good morning":               "good morning",
  "dumbbell hammer curl":               "hammer curl",
  "barbell overhead press":             "overhead press",
  "dumbbell overhead press":            "dumbbell shoulder press",
  "dumbbell lateral raise":             "lateral raise",
  "dumbbell front raise":               "front raise",
  "dumbbell reverse fly":               "reverse fly",
  "barbell upright row":                "upright row",
  "barbell skull crusher":              "skull crusher",
  "dumbbell skull crusher":             "barbell lying triceps extension skull crusher",
  "cable overhead tricep extension":    "cable overhead triceps extension rope attachment",
  "dumbbell overhead tricep extension": "cable overhead triceps extension rope attachment",
  "barbell romanian deadlift":          "romanian deadlift",
  "barbell bulgarian split squat":      "bulgarian split squat",
  "dumbbell bulgarian split squat":     "dumbbell split squat",
  "machine calf raise":                 "calf raise",
  "barbell calf raise":                 "standing calf raise",
  "barbell wrist curl":                 "wrist curl",
  "barbell preacher curl":              "preacher curl",

  // Landmine press — not in dataset, no good substitute, show placeholder
  // "left knee" / "right knee" — data artifacts, intentionally unmatched

  // New exercises added in migration 081
  "chestsupported dumbbell row":    "incline dumbbell row",
  "machine row":                    "lever seated row",
  "pendlay row":                    "pendlay row",
  "straight arm pulldown":          "straight arm pulldown",
  "close grip lat pulldown":        "close grip pulldown",
  "ez bar curl":                    "ez bar curl",
  "concentration curl":             "concentration curl",
  "cable hammer curl":              "cable hammer curl",
  "incline dumbbell curl":          "incline dumbbell biceps curl",
  "machine curl":                   "machine preacher curl",
  "machine tricep extension":       "lever triceps extension",
  "dumbbell tricep kickback":       "dumbbell kickback",
  "rope pushdown":                  "cable rope push down",
  "goblet squat":                   "goblet squat",
  "walking lunge":                  "walking lunge",
  "dumbbell lunge":                 "dumbbell lunge",
  "barbell lunge":                  "barbell lunge",
  "step up":                        "dumbbell step up",
  "smith machine squat":            "smith machine squat",
  "sumo deadlift":                  "barbell sumo deadlift",
  "trap bar deadlift":              "trap bar deadlift",
  "nordic hamstring curl":          "nordic curl",
  "gluteham raise":                 "glute ham raise",
  "single leg romanian deadlift":   "dumbbell one leg deadlift",
  "reverse hyperextension":         "reverse hyperextension",
  "cable kickback":                 "cable glute kickback",
  "hip abduction machine":          "hip adduction",
  "seated calf raise":              "seated calf raise",
  "russian twist":                  "russian twist",
  "cable crunch":                   "cable crunch",
  "hanging leg raise":              "hanging leg raise",
  "dead bug":                       "dead bug",
  "decline crunch":                 "decline crunch",
  "bicycle crunch":                 "bicycle crunch",
  "machine lateral raise":          "lateral raise machine",
  "machine rear delt fly":          "rear delt machine fly",
  "barbell front raise":            "barbell front raise",
  "landmine lateral raise":         "cable lateral raise",
  "reverse curl":                   "reverse barbell curl",
  "kettlebell swing":               "kettlebell swing",
  "kettlebell goblet squat":        "goblet squat",
  "farmers walk":                   "farmer walk",
  "dumbbell pullover":              "dumbbell pullover",
  "incline dumbbell fly":           "dumbbell incline fly",
  "cable chest press":              "cable chest press",
  "incline dumbbell press":         "incline dumbbell press",
  "dumbbell bench press":           "dumbbell bench press",

  // New exercises added in migration 082
  "decline dumbbell press":         "dumbbell decline press",
  "machine chest press":            "lever chest press",
  "weighted dip":                   "dip",
  "inverted row":                   "inverted row",
  "rack pull":                      "rack pull",
  "machine shoulder press":         "lever shoulder press",
  "pike push up":                   "pike push up",
  "side plank":                     "side plank",
  "pallof press":                   "pallof press",
  "mountain climbers":              "mountain climber",
  "v up":                           "v up",
  "toe touch crunch":               "lying toe touch",
  "donkey kick":                    "donkey kickback",
  "fire hydrant":                   "fire hydrant",
  "diamond push up":                "diamond push up",
  "machine shrug":                  "lever shrug",
  "wrist extension":                "wrist extension",
  "barbell box squat":              "box squat",
};

export function normalizeExerciseName(name: string): string {
  let n = name.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
  n = n.split(" ").map(w => ABBREVS[w] ?? w).join(" ").replace(/\s+/g, " ").trim();
  // Strip common plural suffixes on the last word (thrusts→thrust, raises→raise, rows→row)
  n = n.replace(/\b(thrust|raise|row|curl|press|pull|push|fly|kick|crunch|squat|lunge|dip|step|swing|lift|extension|rotation)s\b/g, "$1");
  return n;
}

function words(norm: string): string[] {
  return norm.split(" ").filter(w => w.length > 1);
}

function jaccardScore(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  const intersection = [...setA].filter(w => setB.has(w)).length;
  const union = new Set([...setA, ...setB]).size;
  return union > 0 ? intersection / union : 0;
}

export function findDirectUrl(name: string): { gifUrl: string; imageUrl: string | null } | null {
  return DIRECT_URL_OVERRIDES[normalizeExerciseName(name)] ?? null;
}

export function findBestMatch(name: string): DatasetExercise | null {
  if (!datasetIndex) return null;

  const norm = normalizeExerciseName(name);

  const override = MANUAL_OVERRIDES[norm];
  if (override && override !== norm) {
    const overrideResult = findBestMatch(override);
    if (overrideResult) return overrideResult;
  }

  if (datasetIndex.has(norm)) return datasetIndex.get(norm)!;

  // Step 3: find the most specific (shortest) dataset key that contains our full name.
  // Using shortest-first avoids returning a longer/unrelated exercise that merely
  // contains the search term (e.g. "squat" matching "band bulgarian split squat" first).
  let best3: DatasetExercise | null = null;
  let best3KeyLen = Infinity;
  for (const [key, entry] of datasetIndex) {
    if (key.includes(norm) && key.length < best3KeyLen) {
      best3 = entry;
      best3KeyLen = key.length;
    }
  }
  if (best3) return best3;

  const ourWordCount = norm.split(" ").length;
  for (const [key, entry] of datasetIndex) {
    const keyWordCount = key.split(" ").length;
    if (norm.includes(key) && keyWordCount >= Math.ceil(ourWordCount / 2)) return entry;
  }

  const ourWords = words(norm);
  let bestScore = 0.5;
  let bestEntry: DatasetExercise | null = null;
  for (const [key, entry] of datasetIndex) {
    const score = jaccardScore(ourWords, words(key));
    if (score > bestScore) { bestScore = score; bestEntry = entry; }
  }
  return bestEntry;
}

export async function loadDataset(): Promise<void> {
  if (datasetIndex) return;
  if (!datasetLoadPromise) {
    datasetLoadPromise = (async () => {
      try {
        const res = await fetch(DATASET_JSON_URL, { signal: AbortSignal.timeout(15_000) });
        if (!res.ok) return;
        const exercises: DatasetExercise[] = await res.json();
        datasetIndex = new Map(exercises.map(ex => [normalizeExerciseName(ex.name), ex]));
      } catch (err) {
        console.error("[exercise-gif] dataset load failed:", String(err).slice(0, 100));
      }
    })();
  }
  await datasetLoadPromise;
}
