# 2026-09-13 — the app-shell pass: two "fixed" entries were fighting over the same 384 pixels

**Branch:** `chore/or-111-app-shell-pass` · backlog only. No product code.

## The finding worth the whole sitting

**BF-96 and BF-139 are one defect, and each has now been declared fixed once and failed once.**

- BF-96 requires the weather pill to stay on **one line**.
- BF-139 requires **three chips whole** at the right edge.

Both shipped. Both failed in the same sitting, with the same symptom — *"Day is cut off"* and
*"Its now squished the day of the week"*. The header row is a **fixed width budget and nothing in it
was defending the date**; each entry bought its own element room out of the only slack available.

They are now `Batch: header-row-width`, batched on the verification per this file's rule: one look at
the longest real date (`Wednesday 30 September`, 22 characters) **with `· UV n` present** settles
both, and fixing either alone re-breaks the other.

## Three more failures

- **BF-100** — *"Checked on more - and still doesnt work"*. Its **second** failure. **RV-36 passed in
  the same sitting**, which narrows rather than contradicts: scroll restoration largely works, and
  `/more` specifically does not. RV-36 also carries a second, separate requirement the owner named —
  **back from a tab with nothing to pop should land on Home, not exit.**
- **BF-95** — *"Still requires a little pause."* Reads like a near-miss and is not: the entry's bar
  was the confirmation appearing on the **first** press, so a shorter pause is the same defect. The
  note says so explicitly, to stop the next session tuning a constant down instead of fixing the
  sequencing.
- **BF-111** — failed with no note. The entry is flagged to **ask for the screenshot first**, because
  its difficulty is *which number is wrong where*, and a bare fail cannot say which of the three
  states broke.

## Six verified, with their complaints kept

BF-82, Q-531, Q-93, RV-37, RV-36, BF-145. Two passed *with* a complaint, and both are recorded as
complaints rather than converted into fixes: the More page is *"still not as organised as I would
like"* and the device consoles *"could be labeled better"*. **A pass with a grumble is not a defect,
and turning it into one invents work the owner did not ask for.**

## Two checks left the device queue

- **BF-86** — *"this is something i wont be able to test."* The re-prompt needs a morning already
  answered and then reset. Leaves on RV-35's terms: ships on code and a test, and **a fix needs a
  test that fails before and passes after.**
- **PS-35b** gained a **scope rule**, not an answer: *"Let's not do any testing for the web ui app;
  only the apk."* Its ① (the PWA `start_url`) is real but unobservable on the APK, which never reads
  the manifest. ②③④ stay — they run inside the WebView. **The general rule: a check only
  reproducible in a browser does not go in front of the owner.** That is `CLAUDE.md`'s Canonical
  Runtime policy with its checklist consequence made explicit.

## Result

Device debt **43 → 37**.

**Surfaces not exercised:** none apply — backlog only. `pnpm check:rules` **Ran 74 of 74**.
