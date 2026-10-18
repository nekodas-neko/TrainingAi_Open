import { CameraView,useCameraPermissions } from 'expo-camera';
import { useEffect,useRef } from 'react';
import { Platform,View } from 'react-native';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { AppButton,AppText } from '../../shared/ui';
import { createScanGate } from './scan-gate';
export function BarcodeScanner({
  onCode,
  active = true,
}: {
  onCode: (code: string) => void;
  active?: boolean;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const gate = useRef(createScanGate());
  // Re-arm on mount and each time the sheet opens, whether or not it unmounts its content.
  useEffect(() => {
    if (active) gate.current.reset();
  }, [active]);
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
            if (gate.current.take()) {
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
