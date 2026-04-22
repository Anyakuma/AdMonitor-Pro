import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.admonitor.pro',
  appName: 'AdMonitor Pro',
  webDir: 'dist',
  //windowsAndroidStudioPath: 'C:\\Program Files\\Android\\Android Studio\\bin\\studio64.exe',
  server: {
    androidScheme: 'https',
    cleartext: true,
    allowNavigation: ['*']
  },
  plugins: {
    CapacitorHttp: {
      enabled: true,
    },
  },
  android: {
    allowMixedContent: true,
  },
};

export default config;