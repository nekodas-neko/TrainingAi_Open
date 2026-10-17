import { sessionPaletteIndex } from '@trainingai/shared/session-palette';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { useWorkoutContext } from './WorkoutProvider';

// One colour per session type, by the program's own position, so the calendar, the weekly load bars
// and their legends all agree.
export function useSessionColors() {
  const { theme } = useTheme();
  const { catalog } = useWorkoutContext();
  const sessions = catalog?.program?.sessions ?? [];
  return {
    sessions,
    color: (name: string) =>
      theme.sessions[sessionPaletteIndex(name, sessions) % theme.sessions.length].foreground,
  };
}
