# 2026-09-28 — LB-177: probe-database tests work on the Unix-socket URL

Two migration tests create a throwaway database: LA-143's, and LA-61's from earlier today. Both
built its URL with `new URL(DATABASE_URL)` and a `pathname` rewrite. `setup.sh` writes a Unix-socket
URL (`postgresql://u:p@/db?host=/tmp&port=5433`) whose empty host makes `new URL` throw. The file
then failed while its tests read as skipped, so `pnpm test` exited 1 with nothing failing.

`withDatabase(url, name)` in `migration-test-lock.ts` swaps only the path segment after the `@`,
so it handles both forms. Both files use it now, and they RUN on the socket form rather than
skipping. This was checked with the socket-shaped URL `@/db?host=localhost&port=5434`: the old code
threw `Invalid URL` and the new code passes 10 of 10. `lb177-with-database.test.ts` pins the helper
and fails if any test in that directory sets `url.pathname` again.

LA-159's held branch (#1847) has a third copy. It will pick this up when it next merges `main`.
