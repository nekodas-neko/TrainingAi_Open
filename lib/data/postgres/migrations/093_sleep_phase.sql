-- Add sleep_phase_5_min column to store Oura's 5-minute interval sleep stage string
-- Each character = 5 min: 1=deep, 2=light, 3=REM, 4=awake
ALTER TABLE sleep_sessions ADD COLUMN IF NOT EXISTS sleep_phase_5_min TEXT;
