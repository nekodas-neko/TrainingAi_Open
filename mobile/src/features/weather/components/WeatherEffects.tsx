import { useEffect, useId, useMemo, useRef } from 'react';
import { Animated, Easing, Platform, StyleSheet, View } from 'react-native';
import Svg, { Defs, RadialGradient, Stop, Ellipse, Circle, Line } from 'react-native-svg';
import type { WeatherSnapshot } from '../data/models';
import type { Theme } from '../../../shared/theme/theme';
import { backgroundParticles } from '../data/background';

function useEffectClock(duration: number, animate: boolean) {
  const value = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    value.setValue(0);
    if (!animate) return;
    const loop = Animated.loop(
      Animated.timing(value, {
        toValue: 1,
        duration,
        easing: Easing.linear,
        useNativeDriver: Platform.OS !== 'web',
        isInteraction: false,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [value, duration, animate]);
  return value;
}
function Clouds({
  width,
  height,
  count,
  animate,
  opacity,
}: {
  width: number;
  height: number;
  count: number;
  animate: boolean;
  opacity: number;
}) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const progress = useEffectClock(120000, animate);
  const clouds = useMemo(
    () => backgroundParticles(count, width * 1.15, height * 0.3),
    [count, width, height],
  );
  return (
    <Animated.View
      style={[
        StyleSheet.absoluteFill,
        {
          opacity,
          transform: [
            {
              translateX: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [-width * 0.1, width * 0.1],
              }),
            },
          ],
        },
      ]}
    >
      <Svg width={width} height={height}>
        <Defs>
          <RadialGradient id={id}>
            <Stop offset="0" stopColor="#ffffff" stopOpacity=".9" />
            <Stop offset="1" stopColor="#ffffff" stopOpacity="0" />
          </RadialGradient>
        </Defs>
        {clouds.map((cloud, index) => (
          <Ellipse
            key={index}
            cx={cloud.x}
            cy={cloud.y + height * 0.05}
            rx={width * (0.25 + cloud.size * 0.04)}
            ry={height * 0.045}
            fill={`url(#${id})`}
            opacity={cloud.opacity}
          />
        ))}
      </Svg>
    </Animated.View>
  );
}
function Falling({
  width,
  height,
  snow,
  animate,
  theme,
}: {
  width: number;
  height: number;
  snow: boolean;
  animate: boolean;
  theme: Theme;
}) {
  const progress = useEffectClock(snow ? 12000 : 1300, animate);
  const particles = useMemo(
    () => backgroundParticles(snow ? 25 : 36, width, height),
    [snow, width, height],
  );
  return (
    <Animated.View
      style={{
        position: 'absolute',
        width,
        height: height * 2,
        opacity: snow ? theme.backgrounds.particles.snow : theme.backgrounds.particles.rain,
        transform: [
          {
            translateY: animate
              ? progress.interpolate({ inputRange: [0, 1], outputRange: [-height, 0] })
              : 0,
          },
        ],
      }}
    >
      <Svg width={width} height={height * 2}>
        {[0, 1].flatMap((tile) =>
          particles.map((particle, index) =>
            snow ? (
              <Circle
                key={`${tile}:${index}`}
                cx={particle.x}
                cy={particle.y + tile * height}
                r={particle.size}
                opacity={particle.opacity}
                fill={theme.backgrounds.particles.color}
              />
            ) : (
              <Line
                key={`${tile}:${index}`}
                x1={particle.x}
                y1={particle.y + tile * height}
                x2={particle.x - 6}
                y2={particle.y + tile * height + 40 + particle.size * 10}
                stroke={theme.backgrounds.particles.color}
                strokeWidth={1}
                opacity={particle.opacity}
              />
            ),
          ),
        )}
      </Svg>
    </Animated.View>
  );
}
function Stars({
  width,
  height,
  animate,
  opacity,
  color,
}: {
  width: number;
  height: number;
  animate: boolean;
  opacity: number;
  color: string;
}) {
  const progress = useEffectClock(4000, animate);
  const stars = useMemo(() => backgroundParticles(18, width, height * 0.55), [width, height]);
  return (
    <View style={[StyleSheet.absoluteFill, { opacity }]}>
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          {
            opacity: animate
              ? progress.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 0.3, 1] })
              : 1,
          },
        ]}
      >
        <Svg width={width} height={height}>
          {stars.map((star, index) => (
            <Circle
              key={index}
              cx={star.x}
              cy={star.y}
              r={star.size / 2}
              fill={color}
              opacity={star.opacity}
            />
          ))}
        </Svg>
      </Animated.View>
    </View>
  );
}
function Fog({
  width,
  height,
  animate,
  opacity,
}: {
  width: number;
  height: number;
  animate: boolean;
  opacity: number;
}) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const progress = useEffectClock(60000, animate);
  return (
    <Animated.View
      style={[
        StyleSheet.absoluteFill,
        {
          opacity,
          transform: [
            {
              translateX: progress.interpolate({
                inputRange: [0, 0.5, 1],
                outputRange: [-width * 0.1, width * 0.1, -width * 0.1],
              }),
            },
          ],
        },
      ]}
    >
      <Svg width={width} height={height}>
        <Defs>
          <RadialGradient id={id}>
            <Stop offset="0" stopColor="#dde1eb" stopOpacity=".8" />
            <Stop offset="1" stopColor="#dde1eb" stopOpacity="0" />
          </RadialGradient>
        </Defs>
        {[0.65, 0.8].map((y) => (
          <Ellipse
            key={y}
            cx={width / 2}
            cy={height * y}
            rx={width * 0.8}
            ry={height * 0.085}
            fill={`url(#${id})`}
          />
        ))}
      </Svg>
    </Animated.View>
  );
}
function Lightning({ animate, opacity }: { animate: boolean; opacity: number }) {
  const progress = useEffectClock(16000, animate);
  if (!animate) return null;
  return (
    <Animated.View
      style={[
        StyleSheet.absoluteFill,
        {
          backgroundColor: '#ffffff',
          opacity: progress.interpolate({
            inputRange: [0, 0.88, 0.9, 0.92, 1],
            outputRange: [0, 0, opacity, 0, 0],
          }),
        },
      ]}
    />
  );
}
export function WeatherEffects({
  width,
  height,
  condition,
  starOpacity,
  animate,
  theme,
}: {
  width: number;
  height: number;
  condition: WeatherSnapshot['condition'];
  starOpacity: number;
  animate: boolean;
  theme: Theme;
}) {
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]}>
      {condition === 'clear' && starOpacity > 0 && (
        <Stars
          width={width}
          height={height}
          animate={animate}
          opacity={starOpacity}
          color={theme.backgrounds.particles.color}
        />
      )}
      {['cloudy', 'rain', 'snow', 'thunderstorm'].includes(condition) && (
        <Clouds
          width={width}
          height={height}
          count={
            condition === 'thunderstorm'
              ? 6
              : condition === 'rain'
                ? 5
                : condition === 'snow'
                  ? 3
                  : 4
          }
          animate={animate}
          opacity={theme.backgrounds.particles.cloud}
        />
      )}
      {['rain', 'snow', 'thunderstorm'].includes(condition) && (
        <Falling
          width={width}
          height={height}
          snow={condition === 'snow'}
          animate={animate}
          theme={theme}
        />
      )}
      {condition === 'fog' && (
        <Fog
          width={width}
          height={height}
          animate={animate}
          opacity={theme.backgrounds.particles.fog}
        />
      )}
      {condition === 'thunderstorm' && (
        <Lightning animate={animate} opacity={theme.backgrounds.particles.flash} />
      )}
    </View>
  );
}
