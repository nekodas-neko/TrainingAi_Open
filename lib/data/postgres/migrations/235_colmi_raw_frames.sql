-- Every frame the Colmi ring sends, as hex, before any decoding.
--
-- The Oura pipeline learned this and wrote it into the project's rules: `oura_raw_samples.body_hex`
-- is the archival source of truth, never pruned, because a decoder added later can only back-fill
-- by re-decoding stored bytes. The Colmi pipeline shipped without an equivalent and it cost four
-- release cycles in one day: three decoder diagnoses made by reasoning about row counts, two of
-- them wrong, none checkable against the bytes.
--
-- The live case: 119 of 140 heart-rate samples per sync are rejected as implausible on the way in
-- and discarded. Whether those are sensor noise or a byte-offset error is unanswerable without the
-- frames, and every day spent answering it is a day of history that cannot be recovered.
--
-- Size is not a concern: ~66 frames per sync at ~40 bytes of hex is under 3 KB, so even ten syncs a
-- day is ~30 KB. `oura_raw_samples` reached 563 MB by holding 20 Hz sample streams; this holds
-- sync-time control frames.
CREATE TABLE IF NOT EXISTS colmi_raw_frames (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- When the phone received it. Not the ring's clock: these frames are the input to working out
  -- what the ring's clock even means, so anchoring on it would be circular.
  received_at timestamptz NOT NULL DEFAULT now(),
  -- 'v1' is the 16-byte command channel, 'v2' the reassembled big-data channel.
  channel     text NOT NULL,
  -- The command byte (v1) or big-data type (v2), lifted out so a query can filter without
  -- re-parsing every row's hex.
  tag         integer,
  hex         text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- A re-sync re-sends the same history, so dedup on content rather than accumulating copies. Two
-- genuinely identical frames a second apart are indistinguishable and losing one costs nothing.
CREATE UNIQUE INDEX IF NOT EXISTS colmi_raw_frames_unique
  ON colmi_raw_frames (user_id, channel, hex);

CREATE INDEX IF NOT EXISTS colmi_raw_frames_user_received
  ON colmi_raw_frames (user_id, received_at DESC);
