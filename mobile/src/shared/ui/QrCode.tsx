import { useMemo } from 'react';
import Svg, { Path, Rect } from 'react-native-svg';
import QRCode from 'qrcode';
import { useTheme } from '../theme/ThemeProvider';
export function QrCode({ value, label }: { value: string; label: string }) {
  const { theme } = useTheme();
  const code = useMemo(() => QRCode.create(value, { errorCorrectionLevel: 'M' }), [value]);
  const side = code.modules.size;
  let path = '';
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      if (code.modules.get(y, x)) {
        path += `M${x + 4} ${y + 4}h1v1h-1z`;
      }
    }
  }
  return (
    <Svg
      accessibilityLabel={label}
      width={theme.sizes.mealLabel}
      height={theme.sizes.mealLabel}
      viewBox={`0 0 ${side + 8} ${side + 8}`}
    >
      <Rect width={side + 8} height={side + 8} fill="#fff" />
      <Path d={path} fill="#000" />
    </Svg>
  );
}
