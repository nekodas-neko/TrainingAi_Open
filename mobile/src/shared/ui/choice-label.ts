/** What a screen reader says for a chip: its label, then the flag's words, then "suggested". */
export function choiceSpokenLabel(
  option: { label: string; marked?: boolean; flagged?: boolean },
  flagLabel?: string,
): string | undefined {
  if (!option.marked && !option.flagged) return undefined;
  return [
    option.label,
    ...(option.flagged && flagLabel ? [flagLabel] : []),
    ...(option.marked ? ['suggested'] : []),
  ].join(', ');
}
