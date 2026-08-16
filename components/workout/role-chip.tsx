import { roleLabel, roleColor } from "@trainingai/shared/workout/intensity-zone";

/**
 * Colour-coded exercise-category chip (Main / Secondary / Accessory). Each role has its own
 * colour so the category reads at a glance. Renders nothing when the role is unknown.
 */
export function RoleChip({ role, className }: { role: string | undefined | null; className?: string }) {
  const label = roleLabel(role);
  const color = roleColor(role);
  if (!label || !color) return null;
  return (
    <span
      className={`inline-block flex-none rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white ${className ?? ""}`}
      style={{ background: color }}
    >
      {label}
    </span>
  );
}
