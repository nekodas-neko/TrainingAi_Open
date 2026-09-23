# 2026-09-23 — Sweep 2 planned as stations: one visit, many entries

**Branch:** `device/sweep-2-plan` · **Agent:** Device Verification · **Docs only.**

The owner asked what could be combined into a larger device pass. Re-reading the queue against sweep
1's table: of the checks the phone alone can settle, **~45 automatable and 8 write checks** group into
**eight stations** — one screen and at most one write cycle each — in `docs/device-sweep-2-plan.md`.
The largest is Nutrition: about sixteen entries share one visit and one food + one saved-meal
log/delete. About 3 h 45 min in all. Everything that needs a morning before check-in, the owner
changing phone settings, hardware, a declined write or a design judgement is listed as out of the
pass, with what each needs.

**Queue hygiene in the same PR.** RV-137, RV-138, RV-140, RV-141, RV-142 and RV-133 were fully measured
in sweep 1 and RV-139 all but its byte half (invisible through the service worker), so all seven
leave the queue; their numbers are in `2026-09-23-device-sweep-1.md` and on Q-51 and BF-22. The one
result with no other home — **every tab tap is a 68–118 ms long task** — is filed as **DV-12** (Lane B).
The removal refused any entry whose span held a `## ` line, the shape that split BF-165 in sweep 2.
