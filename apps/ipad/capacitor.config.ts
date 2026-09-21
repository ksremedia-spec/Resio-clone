import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Native shell configuration. The web bundle is packaged into the iOS app;
 * the API origin comes from VITE_API_URL at build time (see src/api/client.ts).
 */
const config: CapacitorConfig = {
  appId: 'app.buildline.ipad',
  appName: 'Buildline',
  webDir: 'dist',
  ios: { contentInset: 'automatic', scheme: 'Buildline', limitsNavigationsToAppBoundDomains: false },
  plugins: {
    Keyboard: { resize: 'native', resizeOnFullScreen: true },
    StatusBar: { style: 'DEFAULT' },
  },
};

export default config;
