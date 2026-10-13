import {
  createContext,
  useContext,
  useRef,
  type PropsWithChildren,
  type ReactNode,
} from 'react';
import { ScrollView, RefreshControl, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { HealthHero, type HealthHeroKind } from './HealthHero';
const AnchorContext = createContext<(node: View | null) => void>(() => {});
export function useHealthAnchor() {
  return useContext(AnchorContext);
}
export function HealthDetailLayout({
  title,
  kind,
  onBack,
  hero,
  actions,
  refreshing = false,
  onRefresh,
  children,
}: PropsWithChildren<{
  title: string;
  kind: HealthHeroKind;
  onBack: () => void;
  hero: ReactNode;
  actions?: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
}>) {
  const { theme } = useTheme();
  const scroll = useRef<ScrollView>(null);
  const content = useRef<View>(null);
  return (
    <AnchorContext.Provider
      value={(node) => {
        if (node && content.current) {
          node.measureLayout(
            content.current,
            (_, y) => scroll.current?.scrollTo({ y, animated: true }),
            () => {},
          );
        }
      }}
    >
      <ScrollView
        ref={scroll}
        style={{ flex: 1 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          onRefresh ? (
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={theme.colors.brand}
            />
          ) : undefined
        }
      >
        <View ref={content} collapsable={false}>
          <HealthHero kind={kind} title={title} onBack={onBack} actions={actions}>
            {hero}
          </HealthHero>
          <View style={{ padding: theme.spacing.lg, gap: theme.spacing.xl }}>{children}</View>
        </View>
      </ScrollView>
    </AnchorContext.Provider>
  );
}
