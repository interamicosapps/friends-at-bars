import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.ohiostate.nightlifemap',
  appName: 'Ohio State Nightlife Map',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    iosScheme: 'https'
  },
  android: {
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

