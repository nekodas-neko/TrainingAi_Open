import { useEffect, useState } from 'react';
import { AppState, StyleSheet, View, useWindowDimensions } from 'react-native';
import { BackdropFade } from '../../../shared/ui/BackdropFade';
import { useReducedMotion } from '../../../shared/ui/useReducedMotion';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { useWeather } from '../WeatherProvider';
import { backgroundScene, backgroundPhase, type BackgroundSection } from '../data/background';
import { BackgroundScene } from './BackgroundScene';
import { WeatherEffects } from './WeatherEffects';

export function DynamicBackground({
  section,
  detail,
  healthDetail,
}: {
  section: BackgroundSection;
  detail: string | null;
  healthDetail: string | null;
}) {
  const { settings, snapshot } = useWeather(),
    { theme } = useTheme();
  const window = useWindowDimensions();
  const [size, setSize] = useState({ width: window.width, height: window.height });
  const [now, setNow] = useState(Date.now);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const reduced = useReducedMotion();
  const scene = backgroundScene(settings, section, detail, healthDetail);
  useEffect(() => {
    const listener = AppState.addEventListener('change', (state) => {
      setForeground(state === 'active');
      if (state === 'active') setNow(Date.now());
    });
    return () => listener.remove();
  }, []);
  useEffect(() => {
    if (scene !== 'sky' || !foreground) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, [scene, foreground]);
  if (!scene) return null;
  const { width, height } = size;
  const phase = backgroundPhase(snapshot, now, theme.backgrounds.sky);
  const condition = snapshot?.condition ?? 'clear';
  const animate = settings.backgroundAnimated && !reduced && foreground;
  const key = `${scene}:${theme.mode}:${condition}:${Math.floor(now / 60000)}:${width}:${height}`;
  return (
    <View
      pointerEvents="none"
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]}
      onLayout={({ nativeEvent }) => {
        const { width, height } = nativeEvent.layout;
        setSize((old) =>
          old.width === width && old.height === height ? old : { width, height },
        );
      }}
    >
      <BackdropFade contentKey={key} animate={animate}>
        <BackgroundScene
          width={width}
          height={height}
          scene={scene}
          phase={phase}
          condition={condition}
          theme={theme}
        />
      </BackdropFade>
      {scene === 'sky' && (
        <WeatherEffects
          width={width}
          height={height}
          condition={condition}
          starOpacity={phase.starOpacity}
          animate={animate}
          theme={theme}
        />
      )}
      <View style={StyleSheet.absoluteFill}>
        <BackgroundScene
          width={width}
          height={height}
          scene={scene}
          phase={phase}
          condition={condition}
          theme={theme}
          scrimOnly
        />
      </View>
    </View>
  );
}
