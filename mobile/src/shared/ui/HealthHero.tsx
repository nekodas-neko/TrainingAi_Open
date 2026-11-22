import { useId, type PropsWithChildren, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Stop, Rect } from 'react-native-svg';
import { HealthArtwork } from './HealthArtwork';
import { PageGradient } from './PageGradient';
import { useTheme } from '../theme/ThemeProvider';
import { PageHeader } from './PageHeader';

export type HealthHeroKind = 'sleep' | 'readiness' | 'activity' | 'heart-rate';
export function HealthHero({
  kind,
  title,
  onBack,
  actions,
  children,
}: PropsWithChildren<{
  kind: HealthHeroKind;
  title: string;
  onBack: () => void;
  actions?: ReactNode;
}>) {
  const { theme } = useTheme();
  const id = useId().replace(/:/g, '');
  const gradient = theme.healthHeroGradients[kind][theme.mode];
  // detail-hero.tsx: the score zone sits on a black (white in light) scrim, not on the page colour.
  const scrim = theme.mode === 'light' ? '#ffffff' : '#000000';
  return (
    <View style={{ height: theme.sizes.healthHero, overflow: 'hidden' }}>
      <PageGradient css={gradient} />
      <View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { opacity: theme.mode === 'light' ? 0.4 : 1 }]}
      >
        <HealthArtwork kind={kind} />
      </View>
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <Svg width="100%" height="100%">
          <Defs>
            <LinearGradient id={`${id}fade`} x1="0%" y1="0%" x2="0%" y2="100%">
              <Stop offset="22%" stopColor={scrim} stopOpacity="0" />
              <Stop offset="60%" stopColor={scrim} stopOpacity="0.6" />
              <Stop offset="100%" stopColor={scrim} stopOpacity="0.92" />
            </LinearGradient>
          </Defs>
          <Rect width="100%" height="100%" fill={`url(#${id}fade)`} />
        </Svg>
      </View>
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'flex-end',
          paddingBottom: theme.spacing.xxxl,
        }}
      >
        {children}
      </View>
      <PageHeader mode="hero" title={title} onBack={onBack} actions={actions} />
    </View>
  );
}
