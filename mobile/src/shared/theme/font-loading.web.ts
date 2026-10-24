import { useFonts } from 'expo-font';
import { geistFaces } from './fonts';

// The web build is a dev surface and has no native embedding, so it loads the same faces.
const files = {
  [geistFaces['400']]: require('@expo-google-fonts/geist/400Regular/Geist_400Regular.ttf'),
  [geistFaces['500']]: require('@expo-google-fonts/geist/500Medium/Geist_500Medium.ttf'),
  [geistFaces['600']]: require('@expo-google-fonts/geist/600SemiBold/Geist_600SemiBold.ttf'),
  [geistFaces['700']]: require('@expo-google-fonts/geist/700Bold/Geist_700Bold.ttf'),
  [geistFaces['800']]: require('@expo-google-fonts/geist/800ExtraBold/Geist_800ExtraBold.ttf'),
  [geistFaces['900']]: require('@expo-google-fonts/geist/900Black/Geist_900Black.ttf'),
};

export function useGeistFonts(): void {
  useFonts(files);
}
