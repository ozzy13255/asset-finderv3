
  // Asset Finder PWA update controller. The service worker can install a new version
  // in the background, but an already-open iPhone standalone window keeps its current
  // document. Detect controller changes and refresh the open app automatically.
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', async () => {
      const hadController = !!navigator.serviceWorker.controller;
      let refreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!hadController || refreshing) return;
        refreshing = true;
        window.location.reload();
      });
      try {
        const reg = await navigator.serviceWorker.register('./sw.js?v=3.11.0', {scope: './', updateViaCache: 'none'});
        const checkForUpdate = () => reg.update().catch(() => {});
        checkForUpdate();
        setInterval(checkForUpdate, 60000);
        document.addEventListener('visibilitychange', () => { if (!document.hidden) checkForUpdate(); });
        window.addEventListener('focus', checkForUpdate);
      } catch (err) {
        console.warn('Asset Finder service worker registration failed:', err);
      }
    });
  }
