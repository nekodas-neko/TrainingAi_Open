import { CameraView,useCameraPermissions } from 'expo-camera';
import { useRef } from 'react';
import { Platform,View } from 'react-native';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { AppButton,AppText } from '../../shared/ui';
export function BarcodeScanner({ onCode }: { onCode: (code: string) => void }) {
  const [permission, requestPermission] = useCameraPermissions();
  const scanned = useRef(false);
  const { theme } = useTheme();
  return (
    <View
      style={{
        height: theme.sizes.chartHeight * 3,
        justifyContent: 'center',
        overflow: 'hidden',
        borderRadius: theme.radii.card,
      }}
    >
      {Platform.OS === 'web' ? (
        <AppText tone="muted">
          Use camera scanning on the phone, or enter a barcode below.
        </AppText>
      ) : permission?.granted ? (
        <CameraView
          style={{ flex: 1 }}
          facing="back"
          barcodeScannerSettings={{
            barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'qr'],
          }}
          onBarcodeScanned={(event) => {
            if (!scanned.current) {
              scanned.current = true;
              onCode(event.data);
            }
          }}
        />
      ) : (
        <AppButton title="Allow camera access" onPress={() => void requestPermission()} />
      )}
    </View>
  );
}
