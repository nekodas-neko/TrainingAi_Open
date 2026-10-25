import { Badge } from './Badge';
import { ListRow } from './ListRow';
import type { ReactNode } from 'react';

export function FeatureRow({
  title,
  subtitle,
  onPress,
  leading,
  divider,
  density,
}: {
  title: string;
  subtitle?: string;
  onPress?: () => void;
  leading?: ReactNode;
  divider?: boolean;
  density?: 'normal' | 'snug' | 'compact';
}) {
  return (
    <ListRow
      title={title}
      subtitle={subtitle}
      onPress={onPress}
      leading={leading}
      divider={divider}
      density={density}
      trailing={!onPress ? <Badge label="Coming soon" /> : undefined}
    />
  );
}
