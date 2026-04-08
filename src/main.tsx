import {Component, StrictMode, type ReactNode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { initializeDB } from './lib/storage/db';

class FatalErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  declare props: { children: ReactNode };
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('[App] Fatal render error:', error);
  }

  handleReload = async () => {
    try {
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((registration) => registration.unregister()));
      }
      const cacheKeys = await caches.keys();
      await Promise.all(cacheKeys.map((key) => caches.delete(key)));
    } catch (error) {
      console.warn('[App] Failed to fully reset PWA state:', error);
    }

    window.location.reload();
  };

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-[#0f1117] text-zinc-100 flex items-center justify-center p-6">
          <div className="max-w-md w-full rounded-2xl border border-red-500/20 bg-zinc-900 p-6 space-y-4">
            <div>
              <h1 className="text-lg font-semibold text-red-400">App failed to load</h1>
              <p className="mt-2 text-sm text-zinc-400">
                This is usually caused by a stale cached build after deployment. Clear the cached app and reload.
              </p>
            </div>
            <button
              onClick={this.handleReload}
              className="w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-700 transition-colors"
            >
              Clear cached app and reload
            </button>
            <p className="text-xs text-zinc-500">{this.state.error.message}</p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// Register Service Worker for PWA support
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js')
      .then((registration) => {
        console.log('[PWA] Service Worker registered successfully');
        
        // Check for updates periodically
        setInterval(() => {
          registration.update();
        }, 60000); // Check every minute

        // Listen for updates
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                // New service worker available - notify user
                console.log('[PWA] New app version available');
                // Post message to new worker to activate
                newWorker.postMessage({ type: 'SKIP_WAITING' });
                // Show update available notification (optional)
                // You could emit an event or update app state here
              }
            });
          }
        });
      })
      .catch((error) => {
        console.warn('[PWA] Service Worker registration failed:', error);
      });

    // Listen for controller change (update applied)
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      console.log('[PWA] Service Worker controller changed - new version activated');
      // Could show notification or restart app
    });
  });
}

// Initialize IndexedDB for offline storage
initializeDB().catch((error) => {
  console.warn('[PWA] IndexedDB initialization failed:', error);
  // App continues to work without IndexedDB (uses localStorage fallback)
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <FatalErrorBoundary>
      <App />
    </FatalErrorBoundary>
  </StrictMode>,
);
