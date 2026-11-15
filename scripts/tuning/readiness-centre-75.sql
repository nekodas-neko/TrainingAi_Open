-- #3778 — what moving the readiness centre to 75 does to the owner's STORED days. READ-ONLY, counts
-- only, owner-scoped through the claude_ro view. Same arithmetic as
-- scripts/tuning/readiness-centre-replay-report.ts (`projectCentreShift`):
--   projected = clamp(round(stored + Σ w × (new sub-score − stored sub-score)))
-- over resting HR, HRV balance and sleep balance; the new sub-score is the v18 curve applied to the
-- stored z, the re-centred stored sub-score on a row with no stored input, or 75 when unscored.
-- Two statements: the summary, then each decision cut. Rewrites nothing.

-- 1. Summary: how many days, how many move, by how much, and how many change band label.
WITH k(key, w, sgn) AS (
  VALUES ('restingHeartRate', 0.15 / 0.90, -1.0), ('hrvBalance', 0.15 / 0.90, 1.0), ('sleepBalance', 0.10 / 0.90, 1.0)
), c AS (
  SELECT d.day, d.readiness_score::numeric AS stored, k.w, k.sgn,
         (d.readiness_contributors -> k.key ->> 'score')::numeric AS s,
         ((d.readiness_contributors -> k.key ->> 'input') IS NOT NULL
           OR (d.readiness_contributors -> k.key) @> '{"input": null}'::jsonb) AS has_input,
         (d.readiness_contributors -> k.key ->> 'input')::numeric AS z
    FROM claude_ro.oura_daily_derived d CROSS JOIN k
   WHERE d.readiness_score IS NOT NULL
     AND jsonb_typeof(d.readiness_contributors -> k.key) = 'object'
     AND jsonb_typeof(d.readiness_contributors -> k.key -> 'score') = 'number'
), r AS (
  SELECT *, 50 + sgn * z * (50 / 1.5) AS raw FROM c
), t AS (
  SELECT *, CASE WHEN raw > 80 THEN 100 - 20 / (1 + (raw - 80) / 20)
                 WHEN raw < 20 THEN 20 / (1 + (20 - raw) / 20)
                 ELSE raw END AS shaped FROM r
), n AS (
  SELECT day, stored, w, s,
         CASE WHEN NOT has_input THEN CASE WHEN s >= 50 THEN 75 + (s - 50) * 0.5 ELSE 75 - (50 - s) * 1.5 END
              WHEN z IS NULL THEN 75
              ELSE CASE WHEN shaped >= 50 THEN 75 + (shaped - 50) * 0.5 ELSE 75 - (50 - shaped) * 1.5 END
         END AS next FROM t
), p AS (
  SELECT day, stored,
         least(100, greatest(0, round(stored + sum(w * (least(100, greatest(0, round(next))) - s))))) AS projected
    FROM n GROUP BY day, stored
), b AS (
  SELECT *, projected - stored AS move,
         CASE WHEN stored >= 70 THEN 'High' WHEN stored >= 50 THEN 'Moderate' ELSE 'Low' END AS band_before,
         CASE WHEN projected >= 70 THEN 'High' WHEN projected >= 50 THEN 'Moderate' ELSE 'Low' END AS band_after
    FROM p
)
SELECT count(*) AS days,
       sum(CASE WHEN move <> 0 THEN 1 ELSE 0 END) AS days_score_moves,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY move) AS median_move,
       max(move) AS max_move,
       min(move) AS min_move,
       sum(CASE WHEN band_before <> band_after THEN 1 ELSE 0 END) AS days_band_changes,
       sum(CASE WHEN band_before = 'Low' AND band_after = 'Moderate' THEN 1 ELSE 0 END) AS low_to_moderate,
       sum(CASE WHEN band_before = 'Moderate' AND band_after = 'High' THEN 1 ELSE 0 END) AS moderate_to_high,
       sum(CASE WHEN band_before = 'Low' AND band_after = 'High' THEN 1 ELSE 0 END) AS low_to_high,
       sum(CASE WHEN band_before = 'High' THEN 1 ELSE 0 END) AS high_before,
       sum(CASE WHEN band_after = 'High' THEN 1 ELSE 0 END) AS high_after,
       sum(CASE WHEN band_before = 'Low' THEN 1 ELSE 0 END) AS low_before,
       sum(CASE WHEN band_after = 'Low' THEN 1 ELSE 0 END) AS low_after,
       min(day) AS first_day, max(day) AS last_day
  FROM b;

-- 2. Each decision cut: days it fired on before and after, days that stopped or started, and the
--    cut that would fire on exactly as many days as before. Must match readiness-decision-thresholds.ts.
WITH k(key, w, sgn) AS (
  VALUES ('restingHeartRate', 0.15 / 0.90, -1.0), ('hrvBalance', 0.15 / 0.90, 1.0), ('sleepBalance', 0.10 / 0.90, 1.0)
), c AS (
  SELECT d.day, d.readiness_score::numeric AS stored, k.w, k.sgn,
         (d.readiness_contributors -> k.key ->> 'score')::numeric AS s,
         ((d.readiness_contributors -> k.key ->> 'input') IS NOT NULL
           OR (d.readiness_contributors -> k.key) @> '{"input": null}'::jsonb) AS has_input,
         (d.readiness_contributors -> k.key ->> 'input')::numeric AS z
    FROM claude_ro.oura_daily_derived d CROSS JOIN k
   WHERE d.readiness_score IS NOT NULL
     AND jsonb_typeof(d.readiness_contributors -> k.key) = 'object'
     AND jsonb_typeof(d.readiness_contributors -> k.key -> 'score') = 'number'
), r AS (
  SELECT *, 50 + sgn * z * (50 / 1.5) AS raw FROM c
), t AS (
  SELECT *, CASE WHEN raw > 80 THEN 100 - 20 / (1 + (raw - 80) / 20)
                 WHEN raw < 20 THEN 20 / (1 + (20 - raw) / 20)
                 ELSE raw END AS shaped FROM r
), n AS (
  SELECT day, stored, w, s,
         CASE WHEN NOT has_input THEN CASE WHEN s >= 50 THEN 75 + (s - 50) * 0.5 ELSE 75 - (50 - s) * 1.5 END
              WHEN z IS NULL THEN 75
              ELSE CASE WHEN shaped >= 50 THEN 75 + (shaped - 50) * 0.5 ELSE 75 - (50 - shaped) * 1.5 END
         END AS next FROM t
), p AS (
  SELECT day, stored,
         least(100, greatest(0, round(stored + sum(w * (least(100, greatest(0, round(next))) - s))))) AS projected
    FROM n GROUP BY day, stored
), cut(ord, name, side, before, after) AS (
  VALUES (1, 'rest-day: recovered', 'atLeast', 75, 80),
         (2, 'rest-day: rest fully', 'below', 60, 67),
         (3, 'session pick: low readiness', 'below', 60, 67),
         (4, 'deload grade: soft', 'atLeast', 70, 76),
         (5, 'deload grade: recommended', 'atLeast', 50, 56),
         (6, 'AI prompt: rest day', 'below', 40, 45),
         (7, 'early-deload card', 'below', 45, 51),
         (8, 'running gate: rest', 'below', 50, 57),
         (9, 'running gate: soften', 'below', 65, 72),
         (10, 'training stress: low readiness', 'below', 60, 67)
), f AS (
  SELECT cut.ord, cut.name, cut.side, cut.before, cut.after,
         CASE WHEN cut.side = 'below' THEN p.stored < cut.before ELSE p.stored >= cut.before END AS was,
         CASE WHEN cut.side = 'below' THEN p.projected < cut.after ELSE p.projected >= cut.after END AS now
    FROM cut CROSS JOIN p
), agg AS (
  SELECT ord, name, side, before, after,
         sum(CASE WHEN was THEN 1 ELSE 0 END) AS fired_before,
         sum(CASE WHEN now THEN 1 ELSE 0 END) AS fired_after,
         sum(CASE WHEN was AND NOT now THEN 1 ELSE 0 END) AS stopped_firing,
         sum(CASE WHEN now AND NOT was THEN 1 ELSE 0 END) AS started_firing
    FROM f GROUP BY ord, name, side, before, after
), v AS (
  SELECT agg.ord, g.v,
         sum(CASE WHEN (agg.side = 'below' AND p.projected < g.v) OR (agg.side = 'atLeast' AND p.projected >= g.v) THEN 1 ELSE 0 END) AS fires
    FROM agg CROSS JOIN generate_series(0, 101) AS g(v) CROSS JOIN p
   GROUP BY agg.ord, g.v
)
SELECT agg.name, agg.side, agg.before, agg.after, agg.fired_before, agg.fired_after, agg.stopped_firing, agg.started_firing,
       CASE WHEN agg.side = 'below'
            THEN (SELECT min(v.v) FROM v WHERE v.ord = agg.ord AND v.fires >= agg.fired_before)
            ELSE (SELECT max(v.v) FROM v WHERE v.ord = agg.ord AND v.fires >= agg.fired_before) END AS rate_preserving_cut
  FROM agg ORDER BY agg.ord;
