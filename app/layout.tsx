import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "next-themes";
import { MotionConfig } from "motion/react";
import { ServiceWorkerRegistration } from "@/components/service-worker-registration";
import { HealthConnectProvider } from "@/components/health-connect-provider";
import { MobileAuthHandler } from "@/components/mobile-auth-handler";
import { SyncProvider } from "@/components/sync-provider";
import { TabSwipeNavigator } from "@/components/shell/tab-swipe-navigator";
import { OfflineIndicator } from "@/components/shell/offline-indicator";
import { LocalStoreDeadBanner } from "@/components/shell/local-store-dead-banner";
import { CapacitorNativeInit } from "@/components/capacitor-native-init";
import { LiveHrAmbientProvider } from "@/components/live-hr-ambient-provider";
import { AutoDetectionProvider } from "@/components/auto-detection-provider";
import { DynamicBackground } from "@/components/dynamic-background/dynamic-background";
import { ErrorReporter } from "@/components/error-reporter";
import { NavTimingProbe } from "@/components/perf/nav-timing-probe";
import { BRAND_THEME_STORAGE_KEY, CUSTOM_HUE_STORAGE_KEY } from "@trainingai/shared/brand-themes";
import { UserTimezoneProvider } from "@/components/shell/user-timezone-provider";
import { auth } from "@/auth";
import "./globals.css";

const brandThemeScript = `(function(){
  var html = document.documentElement;
  function oklchToRgb(L, C, H) {
    var hRad = (H * Math.PI) / 180;
    var a = C * Math.cos(hRad);
    var b = C * Math.sin(hRad);
    var l3 = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3);
    var m3 = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3);
    var s3 = Math.pow(L - 0.0894841775 * a - 1.2914855480 * b, 3);
    var lr =  4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3;
    var lg = -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3;
    var lb = -0.0041960863 * l3 - 0.7034186147 * m3 + 1.7076147010 * s3;
    function gamma(x) { return x >= 0.0031308 ? 1.055 * Math.pow(x, 1 / 2.4) - 0.055 : 12.92 * x; }
    return [
      Math.round(Math.max(0, Math.min(255, gamma(lr) * 255))),
      Math.round(Math.max(0, Math.min(255, gamma(lg) * 255))),
      Math.round(Math.max(0, Math.min(255, gamma(lb) * 255))),
    ];
  }
  var hue = localStorage.getItem(${JSON.stringify(CUSTOM_HUE_STORAGE_KEY)});
  if (hue !== null) {
    var h = Number(hue);
    var rgb = oklchToRgb(0.7, 0.2, h);
    html.style.setProperty('--brand', 'oklch(0.7 0.2 ' + h + ')');
    html.style.setProperty('--color-brand', 'oklch(0.7 0.2 ' + h + ')');
    html.style.setProperty('--brand-foreground', 'oklch(0 0 0)');
    html.style.setProperty('--brand-card-bg', 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',0.07)');
    html.style.setProperty('--brand-card-border', 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',0.18)');
    html.style.setProperty('--brand-glow', 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',0.25)');
  } else {
    var key = localStorage.getItem(${JSON.stringify(BRAND_THEME_STORAGE_KEY)});
    if (key && key !== 'green') html.dataset.brand = key;
  }
  try {
    var t = localStorage.getItem('theme');
    var isDark = t === 'dark' || (t !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (isDark) html.classList.add('dark');
  } catch(e) {}
})();`;

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "TrainingAi",
  description: "AI-powered gym session tracker connected to Google Sheets",
  appleWebApp: {
    capable: true,
    title: "TrainingAi",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Lock the scale: the app is a fixed-layout native-feel WebView, not a scrollable
  // document. Without these, an accidental pinch/double-tap (easy to trigger during
  // the Android app-switch gesture) zooms the layout viewport, and the WebView keeps
  // that scale across minimize/reopen until a full relaunch destroys it — the
  // "opens zoomed in, can't be fixed till reopened" bug. user-scalable=no disables
  // that gesture entirely so the view can never get stuck zoomed.
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#09090b",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await auth();
  const userId = session?.user?.id;
  // Read here rather than per-screen: this is the one place that already has the session on the
  // server, so the value is in the first render and cannot flash a wrong zone (Q-148).
  const timezone = session?.user?.timezone;
  return (
    <html lang="en" className="h-full" suppressHydrationWarning>
      <head>
        <link rel="apple-touch-icon" href="/apple-icon?v=2" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      >
        <script dangerouslySetInnerHTML={{ __html: brandThemeScript }} />
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <UserTimezoneProvider timezone={timezone}>
          <MotionConfig reducedMotion="user">
            <DynamicBackground />
            <ErrorReporter />
            <NavTimingProbe />
            <main className="relative z-[1] h-full">{children}</main>
            <Toaster />
            <OfflineIndicator />
            <LocalStoreDeadBanner />
            <ServiceWorkerRegistration />
            <HealthConnectProvider />
            <MobileAuthHandler hasSession={!!userId} />
            <SyncProvider userId={userId} />
            <TabSwipeNavigator />
            <CapacitorNativeInit />
            <AutoDetectionProvider />
            <LiveHrAmbientProvider />
          </MotionConfig>
          </UserTimezoneProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
