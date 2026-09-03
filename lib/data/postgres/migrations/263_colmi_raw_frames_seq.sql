-- Record the ARRIVAL ORDER of Colmi raw frames. LEARNING MODE (PS-8 / PS-21 Stage A).
--
-- The archive exists so a decoder fix can be applied retroactively instead of costing another night
-- of wear — three of this integration's defects were repaired exactly that way. Re-decoding needs
-- the frames in the order the ring sent them, and that order was being discarded: all frames from
-- one sync are inserted in a single statement, so `created_at` and `received_at` are the
-- transaction's timestamp and identical across every row. Measured on the 2026-09-02 21:12 sync:
-- 31 frames, ONE distinct `created_at`, and the heart-rate log packets come back 1,2,16,7,6,4,20…
--
-- Order is load-bearing for the heart-rate log specifically. It arrives as a numbered series whose
-- start time is named once, in packet 1, and `framesToPayload` carries that anchor forward; a
-- header packet resets it, so several days' series in one sync are told apart only by where the
-- headers fall. Replayed out of order the anchor attaches to the wrong run.
--
-- `seq` is the frame's index within the request that carried it, so `(received_at, seq)` is a total
-- order within a sync. Existing rows get 0 and stay unordered — that is honest rather than
-- convenient: their order was never recorded and no backfill can invent it.
ALTER TABLE colmi_raw_frames ADD COLUMN IF NOT EXISTS seq INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS colmi_raw_frames_replay_idx
  ON colmi_raw_frames (user_id, received_at, seq);
