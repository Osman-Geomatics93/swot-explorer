import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  outDir: 'dist', // Load unpacked from dist/chrome-mv3
  outDirTemplate: '{{browser}}-mv{{manifestVersion}}',
  modules: ['@wxt-dev/module-react'],
  vite: () => ({
    plugins: [tailwindcss()],
    // Not minified: an error then names the real function and component ("onFrame is not a
    // function" instead of "l is not a function"). The extension loads from disk, so size barely matters.
    build: { minify: false },
  }),
  manifest: {
    name: 'SWOT Explorer',
    description: 'Search, preview, clip and download SWOT satellite hydrology data (rivers, lakes, reservoirs, ocean).',
    action: { default_title: 'Open SWOT Explorer' },
    permissions: ['sidePanel', 'storage', 'downloads', 'alarms', 'notifications'],
    host_permissions: [
      // Search and time series
      'https://cmr.earthdata.nasa.gov/*',
      'https://soto.podaac.earthdatacloud.nasa.gov/*',
      'https://fts.podaac.earthdata.nasa.gov/*',
      // Authenticated file access (clipping) and server-side subsetting
      'https://archive.swot.podaac.earthdata.nasa.gov/*',
      // The archive redirects authenticated downloads to this signed CDN (no CORS headers).
      'https://d176wrl3f7yqfo.cloudfront.net/*',
      'https://urs.earthdata.nasa.gov/*',
      'https://harmony.earthdata.nasa.gov/*',
      // Independent altimetry for comparison (DAHITI by DGFI-TUM; Hydroweb by Theia/CNES)
      'https://dahiti.dgfi.tum.de/*',
      'https://hydroweb.next.theia-land.fr/*',
      // Basemap tiles
      'https://server.arcgisonline.com/*',
      'https://basemaps.cartocdn.com/*',
      'https://tile.openstreetmap.org/*',
    ],
  },
});
