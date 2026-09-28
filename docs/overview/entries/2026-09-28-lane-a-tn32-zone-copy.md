# 2026-09-28 — TN-32: run copy states the zones the engine actually uses

The Norwegian 4×4 rationale promised "85–95% max HR". The engine prescribes zones 4–5 on Karvonen
bands, which is 80–100% of heart-rate reserve and about 20 bpm higher for the owner. The copy now
says what the engine does, and the two framework code comments that quoted %HRmax say reserve. The
second zone-name table in `session-picker.ts` is now derived from `HR_ZONE_META`. A test fails on
any framework rationale that quotes a %-of-max figure; reverting the copy fails it. The Heart Rate
page's profile-free grading and red 60–100 bpm are Lane B's, and the entry is re-laned there. No
threshold moved.
