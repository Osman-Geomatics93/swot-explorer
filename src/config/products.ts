import type { FeatureKind } from '@/qc/qualityControl';

/**
 * How a product is found and handled.
 *  - continental: one file per pass and continent (zipped shapefile). CMR footprints are
 *    continent-wide boxes, so passes are matched against PIXC tile coverage.
 *  - continental-avg: one file per cycle and basin (zipped shapefile).
 *  - tile: ~64 km NetCDF tiles with accurate boxes.
 *  - raster: NetCDF scenes; boxes are accurate except near the antimeridian (whole-world box).
 *  - swath: LR NetCDF half-orbits with real polygons.
 */
export type ProductFamily = 'continental' | 'continental-avg' | 'tile' | 'raster' | 'swath';

export interface Product {
  key: string;
  label: string;
  group: 'Rivers' | 'Lakes' | 'Water mask' | 'Ocean';
  shortName: string;
  family: ProductFamily;
  /** Vector products can be clipped and merged in the browser. */
  clip: boolean;
  /** QC rule field set; undefined = no per-feature QC. */
  qcKind?: FeatureKind;
}

export const PRODUCTS: Product[] = [
  { key: 'river-reach', label: 'River reaches (RiverSP)', group: 'Rivers', shortName: 'SWOT_L2_HR_RiverSP_reach_D', family: 'continental', clip: true, qcKind: 'reach' },
  { key: 'river-node', label: 'River nodes (RiverSP)', group: 'Rivers', shortName: 'SWOT_L2_HR_RiverSP_node_D', family: 'continental', clip: true, qcKind: 'node' },
  { key: 'river-avg', label: 'River cycle averages (RiverAvg)', group: 'Rivers', shortName: 'SWOT_L2_HR_RiverAvg_D', family: 'continental-avg', clip: true },
  { key: 'lake-prior', label: 'Lakes, prior/PLD (LakeSP)', group: 'Lakes', shortName: 'SWOT_L2_HR_LakeSP_prior_D', family: 'continental', clip: true, qcKind: 'lake' },
  { key: 'lake-obs', label: 'Lakes, observed pieces (LakeSP)', group: 'Lakes', shortName: 'SWOT_L2_HR_LakeSP_obs_D', family: 'continental', clip: true, qcKind: 'lake' },
  { key: 'lake-unassigned', label: 'Lakes, unassigned water (LakeSP)', group: 'Lakes', shortName: 'SWOT_L2_HR_LakeSP_unassigned_D', family: 'continental', clip: true, qcKind: 'lake' },
  { key: 'lake-avg', label: 'Lake cycle averages (LakeAvg)', group: 'Lakes', shortName: 'SWOT_L2_HR_LakeAvg_D', family: 'continental-avg', clip: true },
  { key: 'pixc', label: 'Pixel cloud (PIXC, NetCDF)', group: 'Water mask', shortName: 'SWOT_L2_HR_PIXC_D', family: 'tile', clip: false },
  { key: 'pixcvec', label: 'Pixel cloud vectors (PIXCVec, NetCDF)', group: 'Water mask', shortName: 'SWOT_L2_HR_PIXCVec_D', family: 'tile', clip: false },
  { key: 'raster-100', label: 'Raster 100 m (NetCDF)', group: 'Water mask', shortName: 'SWOT_L2_HR_Raster_100m_D', family: 'raster', clip: false },
  { key: 'raster-250', label: 'Raster 250 m (NetCDF)', group: 'Water mask', shortName: 'SWOT_L2_HR_Raster_250m_D', family: 'raster', clip: false },
  { key: 'ssh-basic', label: 'Sea surface height, Basic (LR)', group: 'Ocean', shortName: 'SWOT_L2_LR_SSH_BASIC_D', family: 'swath', clip: false },
  { key: 'ssh-expert', label: 'Sea surface height, Expert (LR)', group: 'Ocean', shortName: 'SWOT_L2_LR_SSH_EXPERT_D', family: 'swath', clip: false },
  { key: 'ssh-unsmoothed', label: 'Sea surface height, Unsmoothed (LR)', group: 'Ocean', shortName: 'SWOT_L2_LR_SSH_UNSMOOTHED_D', family: 'swath', clip: false },
  { key: 'ssh-windwave', label: 'Sea surface height, Wind/Wave (LR)', group: 'Ocean', shortName: 'SWOT_L2_LR_SSH_WINDWAVE_D', family: 'swath', clip: false },
];

export const findProduct = (key: string) => PRODUCTS.find((p) => p.key === key) ?? PRODUCTS[0]!;
