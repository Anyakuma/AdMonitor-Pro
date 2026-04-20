import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.admonitor.pro',
  appName: 'AdMonitor Pro',
  webDir: 'dist',
  // windowsAndroidStudioPath: 'C:\\Program Files\\Android\\Android Studio\\bin\\studio64.exe',
  plugins: {
    CapacitorHttp: {
      enabled: true,
    },
  },
};

export default config;