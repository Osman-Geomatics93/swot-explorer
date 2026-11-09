declare module 'shpjs' {
  import type { FeatureCollection } from 'geojson';

  /** Parse a zipped Shapefile (or URL). Returns one collection per layer when the zip holds several. */
  export default function shp(input: ArrayBuffer | string): Promise<FeatureCollection | FeatureCollection[]>;
}
