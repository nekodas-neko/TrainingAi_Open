import { Badge } from './Badge';
import { ListRow } from './ListRow';
import type { ReactNode } from 'react';

export function FeatureRow({
  title,
  subtitle,
  onPress,
  leading,
  divider,
}: {
  title: string;
  subtitle?: string;
  onPress?: () => void;
  leading?: ReactNode;
  divider?: boolean;
}) {
  return (
    <ListRow
      title={title}
      subtitle={subtitle}
      onPress={onPress}
      leading={leading}
      divider={divider}
      trailing={!onPress ? <Badge label="Coming soon" /> : undefined}
    />
  );
}
