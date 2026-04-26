import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TiddlyWiki } from 'tiddlywiki';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function parseArgs(argv) {
  const defaultMetaPath = path.resolve(__dirname, '../src/health-buff-debuff-tracker/img/body.webp.meta');
  const defaultImagePath = path.resolve(__dirname, '../src/health-buff-debuff-tracker/img/body.webp');

  const options = {
    meta: defaultMetaPath,
    image: defaultImagePath,
    rasterWidth: 700,
    alphaThreshold: 12,
    viewBoxWidth: 100,
    viewBoxHeight: 0,
  };

  for (let index = 2; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];
    if (!next) continue;

    if (current === '--meta') {
      options.meta = next;
      index += 1;
    } else if (current === '--image') {
      options.image = next;
      index += 1;
    } else if (current === '--raster-width') {
      options.rasterWidth = Number(next);
      index += 1;
    } else if (current === '--alpha-threshold') {
      options.alphaThreshold = Number(next);
      index += 1;
    } else if (current === '--viewbox-width') {
      options.viewBoxWidth = Number(next);
      index += 1;
    } else if (current === '--viewbox-height') {
      options.viewBoxHeight = Number(next);
      index += 1;
    }
  }

  return options;
}

function createTiddlyWiki() {
  const $tw = new TiddlyWiki();
  $tw.boot.argv = ['.'];
  $tw.boot.boot();
  return $tw;
}

export function parseMeta(content) {
  const $tw = createTiddlyWiki();
  const fields = $tw.utils.parseFields(content);
  const regions = [];

  for (const [field, value] of Object.entries(fields)) {
    if (field.startsWith('body-region-')) {
      regions.push({ field, data: JSON.parse(value) });
    }
  }

  return {
    fields,
    regions,
    viewBoxWidth: Number(fields['body-viewbox-width']) || 100,
    viewBoxHeight: Number(fields['body-viewbox-height']) || 0,
  };
}

export function serializeMeta(parsed, generatedRegions, viewBox) {
  const $tw = createTiddlyWiki();
  const fields = { ...parsed.fields };

  fields['body-viewbox-width'] = String(Number(viewBox.width.toFixed(1)));
  fields['body-viewbox-height'] = String(Number(viewBox.height.toFixed(1)));

  for (const region of generatedRegions) {
    fields[region.field] = JSON.stringify(region.data);
  }

  // Preserve field order: title, type, tags, viewbox, then regions
  const ordered = {};
  const priorityKeys = ['title', 'type', 'tags', 'body-viewbox-width', 'body-viewbox-height'];
  for (const key of priorityKeys) {
    if (key in fields) ordered[key] = fields[key];
  }
  for (const [key, value] of Object.entries(fields)) {
    if (!priorityKeys.includes(key)) ordered[key] = value;
  }

  return $tw.utils.makeTiddlerDictionary(ordered);
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function round(value) {
  return Math.round(value * 10) / 10;
}

export function parsePointText(pointsText, scaleX, scaleY) {
  return pointsText.split(' ').filter(Boolean).map((pair) => {
    const [x, y] = pair.split(',').map(Number);
    return { x: x * scaleX, y: y * scaleY };
  });
}

export function centroidOf(points) {
  const sum = points.reduce((accumulator, point) => ({
    x: accumulator.x + point.x,
    y: accumulator.y + point.y,
  }), { x: 0, y: 0 });
  return {
    x: sum.x / Math.max(1, points.length),
    y: sum.y / Math.max(1, points.length),
  };
}

export function scaleAroundCenter(points, scale) {
  const center = centroidOf(points);
  return points.map((point) => ({
    x: center.x + (point.x - center.x) * scale,
    y: center.y + (point.y - center.y) * scale,
  }));
}

export function formatPoints(points, scaleX, scaleY, vbWidth, vbHeight) {
  return points.map((point) => {
    const x = round(clamp(point.x / scaleX, 0, vbWidth));
    const y = round(clamp(point.y / scaleY, 0, vbHeight));
    return `${x},${y}`;
  }).join(' ');
}

export function cleanPoints(points) {
  const deduped = [];
  for (const point of points) {
    const previous = deduped[deduped.length - 1];
    if (!previous || Math.hypot(previous.x - point.x, previous.y - point.y) > 1.2) {
      deduped.push(point);
    }
  }
  return deduped;
}

export function ellipsePoints(cx, cy, rx, ry, steps = 14) {
  const points = [];
  for (let index = 0; index < steps; index += 1) {
    const angle = (index / steps) * Math.PI * 2;
    points.push({
      x: cx + Math.cos(angle) * rx,
      y: cy + Math.sin(angle) * ry,
    });
  }
  return points;
}

export function boundsOf(points) {
  if (!points || points.length === 0) {
    return null;
  }
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }
  return { minX, maxX, minY, maxY };
}
