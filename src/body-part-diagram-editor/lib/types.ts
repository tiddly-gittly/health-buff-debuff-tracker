export interface BodyMapPoint {
  x: number;
  y: number;
}

export interface SerializedBodyRegion {
  id: string;
  name: string;
  points: string;
}

export interface GeneratedBodyRegionField {
  field: string;
  data: SerializedBodyRegion;
}

export interface EditableBodyRegion {
  field: string;
  id: string;
  name: string;
  pointsArray: BodyMapPoint[];
}

export interface ParsedBodyMapSource {
  fields: Record<string, unknown>;
  imageBase64: string;
  viewBoxWidth: number;
  viewBoxHeight: number;
  regions: EditableBodyRegion[];
}

export interface ViewBoxSize {
  width: number;
  height: number;
}

export interface GenerationInput {
  document: Document;
  imageBase64: string;
  regions: GeneratedBodyRegionField[];
  rasterWidth: number;
  alphaThreshold: number;
  viewBoxWidth: number;
  viewBoxHeight: number;
}

export interface GenerationResult {
  regions: GeneratedBodyRegionField[];
  viewBox: ViewBoxSize;
  debug: Record<string, unknown>;
}