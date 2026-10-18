# Oura Ring v2 API Skill

Comprehensive reference for the Oura Ring v2 API, derived from the official OpenAPI spec v1.42 (v1.34 kept beside it).

## Contents

- `SKILL.md` — curated endpoint reference, field names, types, gotchas, and DB mapping (auto-loaded as context)
- `references/openapi-v1.42.json` — full OpenAPI spec (read on demand when you need schema details not in SKILL.md)
- `references/openapi-v1.34.json` — the previous pin, kept for diffs

## When this skill loads

Any time you're working on:
- Oura API client code (`lib/oura/`)
- Sync routes (`app/api/oura/`)
- DB schema for Oura data (`oura_daily`, `oura_tokens`, `sleep_sessions` Oura columns)
- Webhook handler or webhook registration
- Adding new Oura metrics to the app
