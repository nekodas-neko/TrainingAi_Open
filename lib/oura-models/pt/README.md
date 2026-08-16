# Oura model `.pt` originals — parked off-repo

The **decrypted original TorchScript** for all 31 extracted models — the definitive executable
ground truth — is deliberately **NOT committed here** (52 MB; keeping it in git history is a
permanent one-way cost). This directory holds only this note.

## Why they're not in the repo

`../constants/` + `../weights/` preserve every model's **weights** (rebuildable), and
`../goldens/` holds captured `(input → output)` parity vectors for the models we've run. The only
thing the raw `.pt` adds is the ability to generate a *fresh* forward golden for a model we haven't
run yet — an occasional need, not worth 52 MB of permanent history.

## Where they are

- **Primary (intended): the project storage bucket** — `s3://<AWS_S3_BUCKET_NAME>/oura-model-pt-originals/`
  (Tigris / S3-compatible; endpoint `AWS_ENDPOINT_URL`). Pull with the AWS creds when a port needs a
  fresh golden. *(Upload pending — the session that captured the goldens lacked `AWS_SECRET_ACCESS_KEY`.)*
- **Interim backup: git branch** `docs/preserve-pt-originals-and-goldens` on origin carries the 31
  `.pt` files (an unmerged branch, so they never enter `main` history). Delete this branch once the
  bucket upload is confirmed.

## Regenerating a golden

Fetch the model's `.pt` (bucket or the backup branch), then:
```
python3 scripts/oura-models/capture-goldens.py     # writes ../goldens/<model>.golden.npz
```
See `../goldens/MANIFEST.json` for which models are already captured vs. which need a hand-built
validator-passing input (build one during the port; the schema is in `../constants/specs/<model>.spec.json`).

**Do NOT regenerate from a re-onboarded ring** — the reverse-engineered protocol is stable only
against the frozen firmware (CLAUDE.md Oura Direct-BLE rules).
