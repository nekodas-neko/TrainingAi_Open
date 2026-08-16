// What is left of the Oura Cloud v2 response shapes after the integration was removed
// (owner, 2026-08-13). Twenty-two interfaces described endpoints this app no longer calls;
// `oura_workouts` is the one table whose rows still come from a Cloud-shaped payload, and it
// is read-only history now — nothing writes it since the direct-BLE re-key.
//
// New field names for the BLE pipeline do NOT belong here: they come from the `open_oura` Rust
// source and the `oura-native-ble` skill, never from Oura's public API docs.

// GET /v2/usercollection/workout — the shape the stored `oura_workouts` rows were built from.
export interface OuraWorkout {
  id: string
  day: string                              // YYYY-MM-DD
  activity: string                         // e.g. 'walking', 'running', 'weight_training'
  start_datetime: string                   // ISO 8601
  end_datetime: string                     // ISO 8601
  calories: number | null
  distance: number | null                  // metres
  intensity: 'easy' | 'moderate' | 'hard' | null
  label: string | null
  source: string | null                    // 'manual' | 'confirmed' | 'workout_heart_rate'
}
