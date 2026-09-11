# 2026-09-11 — BF-110's own telemetry separates the blank resumes perfectly

**Branch:** `chore/or-108-bf110-viewport-lead` · one backlog entry amended. No product code.

## What the breadcrumbs say

BF-110 already ships a `bf110 resume dom-intact` breadcrumb carrying the viewport and the DOM child
count. Nobody had read them together. Sixteen samples in `error_events`, **zero overlap**:

| viewport height | DOM children | samples |
|---|---|---|
| **667** | **1–2** (blank) | 8 |
| **826** | **7–8** (rendered) | 8 |

The S25's real CSS viewport is 826. **384×667 is the classic fallback viewport** a WebView reports
before it has been told the real size.

## Why that changes the hypothesis

BF-110 has been diagnosed as a Samsung WebView **compositor** failure — the renderer dying, painting
nothing. The separation says something different and cheaper: the WebView resumed at a fallback
viewport and **the app rendered almost nothing into it**. One is a native-layer problem, the other is
a question about when the app decides to render.

## The competing reading, recorded beside it

667 may simply be measured **before** the WebView has resized — a timing artefact rather than a stuck
state. The data cannot separate the two.

**What settles it, and it is one line of telemetry:** log the viewport a second time ~500 ms into the
same resume. Still 667 → genuinely stuck, and the fix is native. Reads 826 → measured too early, and
the fix is in the render gate. Both readings are in the entry so nobody spends a day in the wrong
layer.

## Not done

The second breadcrumb is not added here — BF-110 is Lane B's and `Gate: device`; this entry records
what the existing data proves and what would settle it. No fix is proposed, because which fix is
right depends on the answer.

**Surfaces not exercised:** none apply — one backlog entry; no runtime code, no device path, no
schema. `pnpm check:rules` **Ran 73 of 73**.
