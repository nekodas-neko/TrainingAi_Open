import { useTheme } from "../../../shared/theme/ThemeProvider";

/** A category's accent. "Workouts" takes the brand colour (its text step); an unlisted category does too. */
export function useCategoryColor(category: string) {
  const { theme } = useTheme();
  const colors: Record<string, string> = theme.rewards.categories;
  return colors[category] ?? theme.colors.brandText;
}
