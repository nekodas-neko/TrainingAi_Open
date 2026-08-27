# 2026-08-27 — RMR, DEXA and blood are one intake shape

**Branch:** `feat/clinical-import-intake` · docs-only · BugFix Intake

## The request

The owner is about to send RMR, DEXA and blood results together: *"ideally you can see what we are
getting and create an endpoint or so to record these down- then the ability to upload the documents
and have it auto scan. I will scrub it of my PII first. but there is a lot of fields/details."*

## Three entries already existed, at three different stages

| Result | Entry | State |
|---|---|---|
| **RMR** | BF-33 | **engine shipped** — `measured_rmr` (migrations 225/226), `POST /api/measured-rmr`, bounds, `ffm_kg_at_test`. No UI. |
| **DEXA** | BF-2 | filed, planning item |
| **Blood panel** | BF-1 | filed, crop-before-upload already decided by the owner |

Nothing said they are the same shape. **BF-41** is that statement, and it does not replace them — it
stops the second one built from re-deriving the first one's pipeline.

## The split that matters

**Typed storage per result; one shared pipeline in front of it.**

Storage stays typed because **BF-2's calibration and BF-33's precedence rule both do arithmetic on
named columns** — a JSONB blob makes exactly that hard. `measured_rmr` is already the right template.
A blood panel gets a parent plus a **child analyte table**, because a panel is N rows and not N
columns.

The pipeline — pick a document → crop → extract with `generateObject` → **confirm the parsed fields**
→ save — is built once and parameterised by result type. `app/api/nutrition/scan/route.ts` is the
working reference, as BF-1 already says.

## Two things the entry insists on

**Do not design the field lists before seeing a real report.** This repo's own rule about external
field names — read the pinned source, never memory — applies to a DEXA printout and a pathology panel
as much as to an API. A schema invented from a description silently drops the field that turns out to
matter. The owner is sending real scrubbed reports; the schemas get written from those.

**Two different redactions, and conflating them is the security bug.** The owner scrubbing a file
before pasting it into a chat is not the same as the app's crop-before-upload step — that one is
still required, because the extraction call sends the document to Google and BF-1 already records
that *"redacting after extraction is too late"*. BF-1 decided this for blood panels; BF-41 makes it
the rule for every document type, DEXA included, since those reports carry name, date of birth and a
patient reference too.

## One recommendation with a reversal cost

**Do not store the source document.** Extract, confirm, save the fields, discard the file. The only
`bytea` column in the whole schema today is `oura_raw_packed.blob`, so a document store would be new
— and with the app's Play Store ambition (health data plus a declared-use-case review) a stored
pathology PDF is a liability rather than an asset. If one must be kept, that is its own decision with
its own entry, not a side effect of this one.

## Sequencing

BF-33's UI first — the table exists, so it is the smallest end-to-end slice and it proves the confirm
step on real numbers. Then DEXA, which that UI widens into and which unblocks the scale calibration.
Then blood, the largest field set.
