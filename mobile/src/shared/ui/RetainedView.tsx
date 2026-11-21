import { Activity, useEffect, useState, type PropsWithChildren } from 'react';
import { View } from 'react-native';

/**
 * Keeps what it holds alive while it is not showing. `shown` keeps it drawn without making it the
 * active one: a screen sliding out, or the one a slide moves over. It stays hidden from screen
 * readers unless `active`.
 */
export function RetainedView({
  active,
  shown = active,
  children,
}: PropsWithChildren<{ active: boolean; shown?: boolean }>) {
  const [visited, setVisited] = useState(shown);
  useEffect(() => {
    if (shown) {
      setVisited(true);
    }
  }, [shown]);
  return (
    <Activity mode={shown ? 'visible' : 'hidden'}>
      {(shown || visited) && (
        <View
          style={{ flex: 1, minHeight: 0 }}
          accessibilityElementsHidden={!active}
          importantForAccessibility={active ? 'auto' : 'no-hide-descendants'}
          aria-hidden={!active}
        >
          {children}
        </View>
      )}
    </Activity>
  );
}
