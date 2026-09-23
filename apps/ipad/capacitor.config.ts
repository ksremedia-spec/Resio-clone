import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Native shell configuration for R. P. Valois & Co. The web bundle is packaged
 * into the iOS app; the server address comes from VITE_API_URL at build time and
 * can be changed on the sign-in screen (see src/api/client.ts).
 */
const config: CapacitorConfig = {
  appId: 'com.rpvalois.buildline',
  appName: 'RPV Buildline',
  webDir: 'dist',
  ios: { contentInset: 'automatic', scheme: 'Buildline', limitsNavigationsToAppBoundDomains: false },
  plugins: {
    Keyboard: { resize: 'native', resizeOnFullScreen: true },
    StatusBar: { style: 'DEFAULT' },
  },
};

export default config;
