import { useState } from 'react';
import { View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { tierGlyph } from '@trainingai/shared/collection/sprites';
import type { FaucetKey } from '@trainingai/shared/collection/summary';
import { AppText } from '../../../shared/ui';
import { catArtFor } from '../art';

// The glyph stands in for art that is missing, drawn at the nearest type token to 60% of the sprite.
const glyphVariant = (size: number) =>
  size >= 56 ? 'display' : size >= 40 ? 'title' : size >= 28 ? 'hero' : 'heading';

/**
 * One collection tier: the drawn cat, still, or its glyph if the art is missing or will not draw.
 * Decorative: every place it appears names the tier in text beside it.
 */
export function CatSprite({
  faucet,
  tier,
  size,
}: {
  faucet: FaucetKey;
  tier: number;
  size: number;
}) {
  const [failed, setFailed] = useState(false);
  const xml = catArtFor(faucet, tier);
  if (!xml || failed) {
    return (
      <View
        style={{
          width: size,
          height: size,
          alignItems: 'center',
          justifyContent: 'center',
        }}
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
      >
        <AppText variant={glyphVariant(size)} style={{ textAlign: 'center' }}>
          {tierGlyph(faucet, tier)}
        </AppText>
      </View>
    );
  }
  return (
    <View
      style={{ width: size, height: size }}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    >
      <SvgXml xml={xml} width={size} height={size} onError={() => setFailed(true)} />
    </View>
  );
}
