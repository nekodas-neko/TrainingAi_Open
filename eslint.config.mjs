import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      // The BLE rollup worker's esbuild output (scripts/build-rollup-worker.mjs). Bundled
      // third-party code, not source — linting it reports drizzle's and pg's own violations as
      // if they were ours, including a false timezone hit that reads exactly like a real one.
      ".rollup-worker/**",
      // Gradle's generated output lives at android/app/build/, not the top-level build/**
      // above (that pattern only matches at the repo root) — without this, a session that
      // runs a native Android build starts linting compiled Capacitor bridge JS as source.
      "android/**",
      "next-env.d.ts",
      ".agents/**",
      // Build/tooling scripts, not shipped product code — the timezone no-restricted-syntax
      // rule below does not cover this directory by design.
      "scripts/**",
    ],
  },
  {
    rules: {
      // Q-282: an accessibility check DOES exist in CI — `eslint-plugin-jsx-a11y` rides in via
      // `next/core-web-vitals` and runs in the Lint job. It was reporting at **warning**, so
      // `pnpm lint` exited 0 with violations present and a new one would land silently. That is
      // exactly how this repo's other counts drifted while nobody was looking: the hex-literal
      // total grew by 41 in five days precisely because it was prose rather than a gate.
      //
      // **The whole app is at zero today** (measured across `app/`, `components/` and `lib/`), so
      // promoting these costs nothing now and freezes the ground — a shrink-only baseline whose
      // baseline is empty, which is the strongest form of the pattern this repo already uses.
      //
      // Scoped to the rules that are unambiguous and statically decidable. This does NOT close
      // Q-282: a linter cannot measure **touch-target size** or **contrast**, which are the two
      // things that entry actually names, and both need a rendered page.
      "jsx-a11y/alt-text": "error",
      "jsx-a11y/anchor-has-content": "error",
      "jsx-a11y/aria-props": "error",
      "jsx-a11y/aria-proptypes": "error",
      "jsx-a11y/aria-unsupported-elements": "error",
      "jsx-a11y/role-has-required-aria-props": "error",
      "jsx-a11y/role-supports-aria-props": "error",
      "no-console": ["error", { allow: ["warn", "error", "info"] }],
      "@typescript-eslint/no-explicit-any": "warn",
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.property.name=/^(slice|substring)$/][callee.object.callee.property.name='toISOString']",
          message:
            "Use todayInTz() from @/lib/date-utils instead — .toISOString().slice()/.substring() returns UTC, which is wrong before 10am AEST.",
        },
        {
          selector:
            "MemberExpression[property.value=0][object.callee.property.name='split'][object.callee.object.callee.property.name='toISOString']",
          message:
            "Use todayInTz() from @/lib/date-utils instead — .toISOString().split('T') returns UTC, which is wrong before 10am AEST.",
        },
        {
          // Narrowed to a direct `new Date().toJSON()` chain (not a bare identifier) —
          // matching any `.toJSON()` call flagged unrelated APIs like PushSubscription.toJSON().
          selector:
            "CallExpression[callee.property.name='toJSON'][callee.object.type='NewExpression'][callee.object.callee.name='Date']",
          message:
            "Use todayInTz() from @/lib/date-utils instead — Date.toJSON() is the UTC ISO string, wrong before 10am AEST.",
        },
        {
          selector:
            "CallExpression[callee.property.name='toLocaleDateString'] > Literal.arguments:matches([value='sv'], [value='en-CA'])",
          message:
            "Use todayInTz() / shiftDateStr() from @/lib/date-utils instead — toLocaleDateString('sv'/'en-CA') on a bare Date is a UTC date string, wrong before 10am AEST.",
        },
      ],
    },
  },
];

export default eslintConfig;
