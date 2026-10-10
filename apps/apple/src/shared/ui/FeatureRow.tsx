import { Badge } from './Badge';
import { ListRow } from './ListRow';

export function FeatureRow({
  title,
  subtitle,
  onPress,
}: {
  title: string;
  subtitle?: string;
  onPress?: () => void;
}) {
  return (
    <ListRow
      title={title}
      subtitle={subtitle}
      onPress={onPress}
      trailing={!onPress ? <Badge label="Coming soon" /> : undefined}
    />
  );
}
