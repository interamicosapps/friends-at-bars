import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.barfest.app',
  appName: 'Bar Fest',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    iosScheme: 'https'
  },
  android: {
    useLegacyBridge: true,
    buildOptions: {
      keystorePath: undefined,
      keystoreAlias: undefined,
    }
  },
  ios: {
    scheme: 'https',
    contentInset: 'automatic'
  },
  plugins: {
    StatusBar: {
      style: 'dark',
      backgroundColor: '#ffffff',
      androidBackgroundColor: '#ffffff',
      iosStyle: 'dark',
    },
  },
};

export default config;

