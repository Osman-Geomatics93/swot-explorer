import '@/lib/zodConfig'; // must run first: stops Zod probing eval (blocked by the extension CSP)
import { startDownloadEngine } from '@/downloads/engine';
import { startMonitor } from '@/monitor/monitor';

export default defineBackground(() => {
  // Clicking the toolbar icon opens the side panel.
  browser.runtime.onInstalled.addListener(() => {
    void browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  });

  startDownloadEngine();
  startMonitor();
});
