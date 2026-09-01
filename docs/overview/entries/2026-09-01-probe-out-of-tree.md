# 2026-09-01 · Lane A — the test that wrote into `lib/` now writes into a temp repo (LB-44)

Branch `lane-a/probe-out-of-tree`. Two files, no migration, no schema change.

## A flake that pointed at the wrong file

A full-suite run on an unrelated branch came back `1 failed | 553 passed`, and the failure named
`lib/media/__tests__/no-data-url-fetch.test.ts`:

```
ENOENT: no such file or directory, open 'lib/zz-dead-repo-methods-probe.ts'
```

That path is written and deleted by `scripts/__tests__/dead-repo-methods.test.ts`, which proves
`sourceFileList()` sees untracked files by making one. `no-data-url-fetch` walks `app`, `components`
and `lib` at module scope and reads every file it finds — so in a parallel worker it listed the
probe, the other test deleted it, and the read threw. Both files pass alone.

**The cost is not the failure, it is the shape of it.** It surfaces in a file the branch never
touched, with a message that reads like a missing source file, so the first move is to search the
diff for something that was never there.

## The entry's suggested fix did not match the code

LB-44 proposed pointing the probe at a private directory, on the basis that *"`sourceFileList()`
takes the directory it lists"*. It does not — it shells out to `git ls-files` with no path argument
and inherits the process's working directory. Re-reading the function before building the fix is what
caught that, and it changed the fix rather than the goal.

Three other shapes were considered and rejected:

- **Somewhere in the tree the walkers skip.** Every non-ignored path is fair game for some walker, and
  a gitignored one would not be listed by `--exclude-standard` — which is the property under test.
- **A name the readers exclude.** That is a change to every reader, and each new one has to know.
- **Assert on the command string instead.** A source-level check cannot see behaviour, which is the
  whole reason this test creates a real file.

## A throwaway git repo proves the same property

`sourceFileList(cwd?)` takes an optional working directory, used by the test and by nothing else. The
test `git init`s a temp directory and puts three files in it — one tracked, one untracked, one
gitignored — and asserts the first two are listed and the third is not.

**That is a stronger test than the one it replaces.** The old version asserted only that an untracked
file appears; this one pins both halves of `--cached --others --exclude-standard`, so dropping either
flag now fails. Verified by dropping each:

| mutation | result |
|---|---|
| `--others` removed | 1 failed — the untracked file is no longer listed |
| `--exclude-standard` removed | 2 failed — the gitignored file leaks in |
| the `cwd` argument ignored | 1 failed — the probe repo is not what gets listed |

## It was the only one

Every other test that writes files already uses `mkdtempSync` under `os.tmpdir()` —
`doc-size-baselines`, `repository-user-scoping-check`, `required-models`, `sw/manifest`. Grepped
rather than assumed: this was the last `writeFileSync` into the working tree, and there are now none.
