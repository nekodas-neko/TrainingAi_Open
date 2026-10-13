import { Activity, useEffect, useState, type PropsWithChildren } from 'react';
import { View } from 'react-native';

export function RetainedView({ active, children }: PropsWithChildren<{ active: boolean }>) {
  const [visited, setVisited] = useState(active);
  useEffect(() => {
    if (active) {
      setVisited(true);
    }
  }, [active]);
  return (
    <Activity mode={active ? 'visible' : 'hidden'}>
      {(active || visited) && (
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
