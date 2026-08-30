-- BF-41 / BF-2: DEXA storage, written from a real report rather than a description.
--
-- The entry's own rule: *"Do not design the field lists before seeing a real report … a schema
-- invented from a description will silently drop the field that turns out to matter."* Every column
-- below appears on the Hologic Horizon A printout recorded, de-identified, in
-- `docs/clinical-baseline-2026-08-27.md`. **Keep every field** is BF-43's decision, so the indices
-- and the reference populations are stored even though nothing reads them yet.
--
-- Typed columns rather than JSONB, following `measured_rmr` (migrations 225/226) — the template this
-- entry names. BF-2's calibration and BF-33's precedence rule both do arithmetic on named columns,
-- and a blob makes exactly that hard.
--
-- **No source document is stored.** BF-41 recommends against it outright: extract, confirm, save the
-- fields, discard the file. It removes the largest PII surface in the feature, and a stored pathology
-- or DEXA PDF is a liability under the Play Store's health-data review rather than an asset. The
-- report carries a name, a date of birth and a patient reference; none of that has a column here, and
-- none should be added.
CREATE TABLE IF NOT EXISTS dexa_scans (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scanned_on               date NOT NULL,

  -- Instrument and analysis. Two scans are only comparable on the same machine and analysis
  -- version; a provider upgrade shifts values, which is the `model_version` trap CLAUDE.md
  -- documents for scores wearing different clothes.
  manufacturer             text,
  model                    text,
  serial_number            text,
  scan_type                text,
  analysis_version         text,
  provider_scan_id         text,

  -- The subject as the scan measured them, not as the app knows them today.
  height_cm                double precision,
  weight_kg                double precision,
  age_years                integer,
  bmi                      double precision,

  -- Bone
  total_bmd                double precision,   -- g/cm2
  t_score                  double precision,
  z_score                  double precision,
  total_bmc_g              double precision,
  bmd_precision_cv_pct     double precision,

  -- Body composition. Masses in GRAMS, as the report prints them — converting on the way in would
  -- make the stored number something the printout does not say.
  fat_g                    double precision,
  lean_g                   double precision,
  lean_plus_bmc_g          double precision,   -- FFM; what BF-33's Cunningham comparison needs
  total_mass_g             double precision,
  pct_fat                  double precision,   -- BF-2's calibration pairs this with the scale
  pct_fat_young_normal     integer,            -- percentile, not a percentage
  pct_fat_age_matched      integer,
  android_pct_fat          double precision,
  gynoid_pct_fat           double precision,

  -- Adipose indices
  fat_mass_height2         double precision,   -- kg/m2
  android_gynoid_ratio     double precision,
  pct_fat_trunk_legs       double precision,
  trunk_limb_fat_mass_ratio double precision,
  vat_mass_g               double precision,
  vat_volume_cm3           double precision,
  vat_area_cm2             double precision,

  -- Lean indices
  lean_height2             double precision,   -- kg/m2
  appendicular_lean_height2 double precision,

  -- Which population the T/Z scores and the body-comp percentiles were read against. Stored because
  -- a score without its reference is not comparable to anything.
  bone_reference           text,
  body_comp_reference      text,

  -- Provenance, per BF-41: 'manual' typed by hand, 'extracted' read off a document and confirmed.
  -- Never a model's unconfirmed output — the confirm step is what makes it one of these two.
  source                   text NOT NULL DEFAULT 'manual',
  notes                    text,

  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

-- One scan per person per day. Nobody has two DEXA scans in a day, and making it unique is what lets
-- a re-entry (or a replayed extraction) update in place instead of duplicating — the same idempotent
-- shape `measured_rmr` uses.
CREATE UNIQUE INDEX IF NOT EXISTS idx_dexa_scans_user_date ON dexa_scans (user_id, scanned_on);

-- The per-region rows the printout carries — 12 on the owner's (L/R arm, L/R ribs, T spine, L spine,
-- pelvis, L/R leg, subtotal, head, total), though the prose in `docs/clinical-baseline-2026-08-27.md`
-- says 11 above a list of 12; the count is the provider's and is not something to encode. A child
-- table because a region set is N ROWS and not N columns — the same reasoning BF-41 gives for a blood panel's analytes, and the reason adding a
-- twelfth region later is a data change rather than a migration.
--
-- NOTE `subtotal` and `total` are AGGREGATES the report prints alongside the regions, not further
-- body parts. Anything summing this table must exclude them.
CREATE TABLE IF NOT EXISTS dexa_scan_regions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id    uuid NOT NULL REFERENCES dexa_scans(id) ON DELETE CASCADE,
  region     text NOT NULL,
  bmd        double precision,   -- g/cm2
  bmc_g      double precision,
  area_cm2   double precision
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_dexa_scan_regions_scan_region
  ON dexa_scan_regions (scan_id, region);
