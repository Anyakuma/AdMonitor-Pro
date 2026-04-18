import { app, BrowserWindow, session } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 850,
    title: "AdMonitor Pro",
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  // Automatically grant microphone permissions without popup
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'media') {
      callback(true);
    } else {
      callback(false);
    }
  });

  if (process.env.NODE_ENV === 'development') {
    // In dev, point to Vite's local dev server
    win.loadURL('http://localhost:5173');
  } else {
    // In prod, point to built static files
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});