import type {
  BodyMapPoint,
  EditableBodyRegion,
  GeneratedBodyRegionField,
  ParsedBodyMapSource,
  ViewBoxSize,
} from './types.js';

export function parsePoints(pointsText: string) {
  if (!pointsText.trim()) return [] as BodyMapPoint[];
  return pointsText.split(' ').filter(Boolean).map((pair) => {
    const [x, y] = pair.split(',').map(Number);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error(`Invalid point pair: ${pair}`);
    }
    return { x, y };
  });
}

export function stringifyPoints(points: BodyMapPoint[]) {
  return points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');
}

export function loadBodyMapSource(wiki: any, imageTiddlerTitle: string): ParsedBodyMapSource {
  const imageTiddler = wiki.getTiddler(imageTiddlerTitle);
  const fields = imageTiddler ? { ...imageTiddler.fields } : {};
  const regions: EditableBodyRegion[] = [];

  if (imageTiddler) {
    for (const fieldName in imageTiddler.fields) {
      if (!fieldName.startsWith('body-region-')) continue;
      const rawField = imageTiddler.fields[fieldName];
      if (typeof rawField !== 'string' || !rawField.trim()) continue;
      try {
        const parsed = JSON.parse(rawField) as { id?: string; name?: string; points?: string };
        if (!parsed.id || !parsed.name || typeof parsed.points !== 'string') continue;
        regions.push({
          field: fieldName,
          id: parsed.id,
          name: parsed.name,
          pointsArray: parsePoints(parsed.points),
        });
      } catch (error) {
        console.error(`Failed to parse ${fieldName}`, error);
      }
    }
  }

  regions.sort((left, right) => left.name.localeCompare(right.name));

  return {
    fields,
    imageBase64: typeof imageTiddler?.fields?.text === 'string' ? (imageTiddler.fields.text as string) : '',
    viewBoxWidth: Number(imageTiddler?.fields?.['body-viewbox-width'] ?? '100') || 100,
    viewBoxHeight: Number(imageTiddler?.fields?.['body-viewbox-height'] ?? '216') || 216,
    regions,
  };
}

export function listBodyMapImageTiddlers(wiki: any, currentTitle = '') {
  const titles = new Set<string>();
  if (currentTitle) {
    titles.add(currentTitle);
  }

  if (typeof wiki?.each === 'function') {
    wiki.each((tiddler: any, title: string) => {
      const fields = tiddler?.fields ?? {};
      const type = typeof fields.type === 'string' ? fields.type : '';
      const hasBodyRegionField = Object.keys(fields).some((fieldName) => fieldName.startsWith('body-region-'));
      if (type.startsWith('image/') || hasBodyRegionField) {
        titles.add(title);
      }
    });
  }

  return Array.from(titles).sort((left, right) => left.localeCompare(right));
}

export function snapshotRegions(regions: EditableBodyRegion[]): GeneratedBodyRegionField[] {
  return regions.map((region) => ({
    field: region.field,
    data: {
      id: region.id,
      name: region.name,
      points: stringifyPoints(region.pointsArray),
    },
  }));
}

export function editableRegionsFromGenerated(regions: GeneratedBodyRegionField[]) {
  return regions.map((region) => ({
    field: region.field,
    id: region.data.id,
    name: region.data.name,
    pointsArray: parsePoints(region.data.points),
  })).sort((left, right) => left.name.localeCompare(right.name));
}

function orderFields(fields: Record<string, unknown>) {
  const ordered: Record<string, string> = {};
  const priorityKeys = ['title', 'type', 'tags', 'body-viewbox-width', 'body-viewbox-height'];

  for (const key of priorityKeys) {
    if (key in fields && fields[key] !== undefined) {
      ordered[key] = String(fields[key]);
    }
  }

  for (const [key, value] of Object.entries(fields)) {
    if (priorityKeys.includes(key) || value === undefined) continue;
    ordered[key] = String(value);
  }

  return ordered;
}

export function buildUpdatedFields(sourceFields: Record<string, unknown>, regions: EditableBodyRegion[], viewBox: ViewBoxSize) {
  const nextFields: Record<string, unknown> = { ...sourceFields };
  for (const fieldName of Object.keys(nextFields)) {
    if (fieldName.startsWith('body-region-')) {
      delete nextFields[fieldName];
    }
  }
  nextFields['body-viewbox-width'] = String(Number(viewBox.width.toFixed(1)));
  nextFields['body-viewbox-height'] = String(Number(viewBox.height.toFixed(1)));

  for (const region of regions) {
    nextFields[region.field] = JSON.stringify({
      id: region.id,
      name: region.name,
      points: stringifyPoints(region.pointsArray),
    });
  }

  return nextFields;
}

export function buildMetaText(sourceFields: Record<string, unknown>, regions: EditableBodyRegion[], viewBox: ViewBoxSize) {
  const nextFields = buildUpdatedFields(sourceFields, regions, viewBox);
  const metaFields = { ...nextFields };
  delete metaFields.text;
  return $tw.utils.makeTiddlerDictionary(orderFields(metaFields));
}