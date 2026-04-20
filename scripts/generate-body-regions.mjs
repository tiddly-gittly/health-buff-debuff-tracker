import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';

const defaultMetaPath = path.resolve('src/health-buff-debuff-tracker/img/body.webp.meta');
const defaultImagePath = path.resolve('src/health-buff-debuff-tracker/img/body.webp');

function parseArgs(argv) {
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
      options.meta = path.resolve(next);
      index += 1;
    } else if (current === '--image') {
      options.image = path.resolve(next);
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

function parseMeta(content) {
  const headerLines = [];
  const regions = [];

  for (const line of content.split(/\r?\n/)) {
    if (line.startsWith('body-region-')) {
      const separatorIndex = line.indexOf(': ');
      if (separatorIndex === -1) continue;
      const field = line.slice(0, separatorIndex);
      const jsonText = line.slice(separatorIndex + 2).trim();
      if (!jsonText) continue;
      regions.push({ field, data: JSON.parse(jsonText) });
    } else {
      headerLines.push(line);
    }
  }

  const readHeaderField = (fieldName) => {
    const line = headerLines.find((item) => item.startsWith(`${fieldName}:`));
    return line ? line.slice(fieldName.length + 1).trim() : '';
  };

  return {
    headerLines,
    regions,
    viewBoxWidth: Number(readHeaderField('body-viewbox-width')) || 100,
    viewBoxHeight: Number(readHeaderField('body-viewbox-height')) || 0,
  };
}

function upsertField(lines, fieldName, value) {
  const nextLines = [...lines];
  const index = nextLines.findIndex((line) => line.startsWith(`${fieldName}:`));
  const line = `${fieldName}: ${value}`;
  if (index >= 0) {
    nextLines[index] = line;
    return nextLines;
  }

  const tagsIndex = nextLines.findIndex((item) => item.startsWith('tags:'));
  if (tagsIndex >= 0) {
    nextLines.splice(tagsIndex + 1, 0, line);
  } else {
    nextLines.push(line);
  }
  return nextLines;
}

function serializeMeta(parsed, generatedRegions, viewBox) {
  let headerLines = [...parsed.headerLines];
  headerLines = upsertField(headerLines, 'body-viewbox-width', String(Number(viewBox.width.toFixed(1))));
  headerLines = upsertField(headerLines, 'body-viewbox-height', String(Number(viewBox.height.toFixed(1))));

  const regionLines = generatedRegions.map(({ field, data }) => `${field}: ${JSON.stringify(data)}`);
  return [...headerLines, ...regionLines].join('\n');
}

async function generateRegions({ imageBase64, regions, rasterWidth, alphaThreshold, viewBoxWidth, viewBoxHeight }) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const result = await page.evaluate(async (input) => {
      const faceNames = new Set([
        'Eye (Right)',
        'Eye (Left)',
        'Nose',
        'Mouth',
        'Ear (Right)',
        'Ear (Left)',
      ]);

      const loadImage = async () => new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = `data:image/webp;base64,${input.imageBase64}`;
      });

      const image = await loadImage();
      const vbWidth = input.viewBoxWidth || 100;
      const vbHeight = input.viewBoxHeight > 0
        ? input.viewBoxHeight
        : Math.round(((vbWidth * image.height) / image.width) * 10) / 10;
      const width = input.rasterWidth;
      const height = Math.max(1, Math.round(width * (image.height / image.width)));
      const scaleX = width / vbWidth;
      const scaleY = height / vbHeight;
      const imageCenterX = width / 2;

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0, width, height);
      const alpha = context.getImageData(0, 0, width, height).data;

      const mask = new Uint8Array(width * height);
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const offset = (y * width + x) * 4 + 3;
          mask[y * width + x] = alpha[offset] >= input.alphaThreshold ? 1 : 0;
        }
      }

      const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
      const round = (value) => Math.round(value * 10) / 10;
      const parsePointText = (pointsText) => pointsText.split(' ').filter(Boolean).map((pair) => {
        const [x, y] = pair.split(',').map(Number);
        return { x: x * scaleX, y: y * scaleY };
      });
      const centroidOf = (points) => {
        const sum = points.reduce((accumulator, point) => ({
          x: accumulator.x + point.x,
          y: accumulator.y + point.y,
        }), { x: 0, y: 0 });
        return {
          x: sum.x / Math.max(1, points.length),
          y: sum.y / Math.max(1, points.length),
        };
      };
      const scaleAroundCenter = (points, scale) => {
        const center = centroidOf(points);
        return points.map((point) => ({
          x: center.x + (point.x - center.x) * scale,
          y: center.y + (point.y - center.y) * scale,
        }));
      };
      const formatPoints = (points) => points.map((point) => `${round(clamp(point.x / scaleX, 0, vbWidth))},${round(clamp(point.y / scaleY, 0, vbHeight))}`).join(' ');

      const maskAt = (x, y) => {
        const rx = Math.round(x);
        const ry = Math.round(y);
        if (rx < 0 || rx >= width || ry < 0 || ry >= height) return false;
        return mask[ry * width + rx] === 1;
      };

      const rowStats = [];
      let top = height - 1;
      let bottom = 0;

      for (let y = 0; y < height; y += 1) {
        const segments = [];
        let start = -1;
        for (let x = 0; x < width; x += 1) {
          const filled = mask[y * width + x] === 1;
          if (filled && start === -1) start = x;
          if ((!filled || x === width - 1) && start !== -1) {
            const end = filled && x === width - 1 ? x : x - 1;
            segments.push({ start, end, width: end - start + 1, cx: (start + end) / 2 });
            start = -1;
          }
        }

        const widest = segments.reduce((best, segment) => (!best || segment.width > best.width ? segment : best), null);
        const center = segments.find((segment) => imageCenterX >= segment.start && imageCenterX <= segment.end) ?? widest;
        const whole = segments.length > 0 ? {
          start: segments[0].start,
          end: segments[segments.length - 1].end,
          width: segments[segments.length - 1].end - segments[0].start + 1,
          cx: (segments[0].start + segments[segments.length - 1].end) / 2,
        } : null;

        if (whole) {
          top = Math.min(top, y);
          bottom = Math.max(bottom, y);
        }

        rowStats.push({ y, segments, center, whole });
      }

      const bodyHeight = Math.max(1, bottom - top);
      const rowFromRatio = (ratio) => clamp(Math.round(top + bodyHeight * ratio), top, bottom);
      const getSegment = (row, mode) => {
        if (!row) return null;
        if (mode === 'center') return row.center ?? row.whole;
        if (mode === 'left-outer') return row.segments[0] ?? row.whole;
        if (mode === 'right-outer') return row.segments[row.segments.length - 1] ?? row.whole;
        if (mode === 'left-inner') {
          const candidates = row.segments.filter((segment) => segment.cx < imageCenterX);
          return candidates[candidates.length - 1] ?? row.center ?? row.whole;
        }
        if (mode === 'right-inner') {
          const candidates = row.segments.filter((segment) => segment.cx > imageCenterX);
          return candidates[0] ?? row.center ?? row.whole;
        }
        return row.whole;
      };

      const pickRow = (mode, startRatio, endRatio, kind) => {
        let best = null;
        const middleRatio = (startRatio + endRatio) / 2;
        const middleY = rowFromRatio(middleRatio);
        for (let y = rowFromRatio(startRatio); y <= rowFromRatio(endRatio); y += 1) {
          const row = rowStats[y];
          const segment = getSegment(row, mode);
          if (!segment) continue;
          const proximityPenalty = Math.abs(y - middleY) / Math.max(1, bodyHeight) * 24;
          const score = (kind === 'max' ? -segment.width : segment.width) + proximityPenalty;
          if (!best || score < best.score) {
            best = { row, segment, score };
          }
        }
        return best ?? { row: rowStats[middleY], segment: getSegment(rowStats[middleY], mode) };
      };

      const snapPointToMask = (point, center) => {
        const dx = point.x - center.x;
        const dy = point.y - center.y;
        const length = Math.hypot(dx, dy) || 1;
        const stepX = dx / length;
        const stepY = dy / length;

        if (!maskAt(point.x, point.y)) {
          for (let distance = length; distance >= 0; distance -= 1) {
            const candidate = { x: center.x + stepX * distance, y: center.y + stepY * distance };
            if (maskAt(candidate.x, candidate.y)) return candidate;
          }
          return { ...center };
        }

        let best = { ...point };
        for (let distance = length; distance <= length + 24; distance += 1) {
          const candidate = { x: center.x + stepX * distance, y: center.y + stepY * distance };
          if (maskAt(candidate.x, candidate.y)) {
            best = candidate;
          } else {
            break;
          }
        }
        return best;
      };

      const cleanPoints = (points) => {
        const deduped = [];
        for (const point of points) {
          const previous = deduped[deduped.length - 1];
          if (!previous || Math.hypot(previous.x - point.x, previous.y - point.y) > 1.2) {
            deduped.push(point);
          }
        }
        return deduped;
      };

      const ellipsePoints = (cx, cy, rx, ry, steps = 14) => {
        const points = [];
        for (let index = 0; index < steps; index += 1) {
          const angle = (index / steps) * Math.PI * 2;
          points.push({
            x: cx + Math.cos(angle) * rx,
            y: cy + Math.sin(angle) * ry,
          });
        }
        return points;
      };

      const buildSeedRegion = (points, shrink = 1) => {
        const scaled = shrink === 1 ? points : scaleAroundCenter(points, shrink);
        const center = centroidOf(scaled);
        return cleanPoints(scaled.map((point) => snapPointToMask(point, center)));
      };

      const buildJointRegion = (rowMatch, mode, widthScale, heightScale, minSize = 8) => {
        const segment = rowMatch.segment ?? getSegment(rowMatch.row, mode);
        if (!segment) return [];
        const cx = segment.cx;
        const cy = rowMatch.row.y;
        const rx = Math.max(minSize, segment.width * widthScale * 0.5);
        const ry = Math.max(minSize * 0.7, bodyHeight * heightScale);
        const center = { x: cx, y: cy };
        return cleanPoints(ellipsePoints(cx, cy, rx, ry).map((point) => snapPointToMask(point, center)));
      };

      const buildShoulderRegion = (screenSide) => {
        const shoulderRow = pickRow('center', 0.16, 0.28, 'max');
        const whole = shoulderRow.row.whole ?? shoulderRow.segment;
        const center = shoulderRow.row.center ?? whole;
        if (!whole || !center) return [];

        const outer = screenSide === 'left' ? whole.start : center.end;
        const inner = screenSide === 'left' ? center.start : whole.end;
        const cx = (outer + inner) / 2;
        const rx = Math.max(8, Math.abs(inner - outer) * 0.7);
        const cy = shoulderRow.row.y;
        const ellipseCenter = { x: cx, y: cy };
        return cleanPoints(ellipsePoints(cx, cy, rx, bodyHeight * 0.025, 12).map((point) => snapPointToMask(point, ellipseCenter)));
      };

      const screenSideFor = (name) => {
        if (name.startsWith('Right ')) return 'left';
        if (name.startsWith('Left ')) return 'right';
        return 'center';
      };

      const rows = {
        neck: pickRow('center', 0.08, 0.19, 'min'),
        elbowLeft: pickRow('left-outer', 0.22, 0.35, 'min'),
        elbowRight: pickRow('right-outer', 0.22, 0.35, 'min'),
        wristLeft: pickRow('left-outer', 0.36, 0.52, 'min'),
        wristRight: pickRow('right-outer', 0.36, 0.52, 'min'),
        kneeLeft: pickRow('left-inner', 0.58, 0.72, 'min'),
        kneeRight: pickRow('right-inner', 0.58, 0.72, 'min'),
        ankleLeft: pickRow('left-inner', 0.82, 0.95, 'min'),
        ankleRight: pickRow('right-inner', 0.82, 0.95, 'min'),
      };

      const generated = input.regions.map((region) => {
        const seedPoints = parsePointText(region.data.points);
        const screenSide = screenSideFor(region.data.name);
        const sideMode = screenSide === 'left' ? 'left-outer' : 'right-outer';
        const legMode = screenSide === 'left' ? 'left-inner' : 'right-inner';
        let outputPoints;

        if (faceNames.has(region.data.name)) {
          outputPoints = buildSeedRegion(seedPoints, 0.92);
        } else if (region.data.name === 'Neck') {
          outputPoints = buildJointRegion(rows.neck, 'center', 0.9, 0.022, 7);
        } else if (region.data.name.includes('Shoulder')) {
          outputPoints = buildShoulderRegion(screenSide);
        } else if (region.data.name.includes('Elbow')) {
          outputPoints = buildJointRegion(sideMode === 'left-outer' ? rows.elbowLeft : rows.elbowRight, sideMode, 1.15, 0.022, 7);
        } else if (region.data.name.includes('Wrist')) {
          outputPoints = buildJointRegion(sideMode === 'left-outer' ? rows.wristLeft : rows.wristRight, sideMode, 0.9, 0.018, 6);
        } else if (region.data.name.includes('Knee')) {
          outputPoints = buildJointRegion(legMode === 'left-inner' ? rows.kneeLeft : rows.kneeRight, legMode, 1.2, 0.024, 8);
        } else if (region.data.name.includes('Ankle')) {
          outputPoints = buildJointRegion(legMode === 'left-inner' ? rows.ankleLeft : rows.ankleRight, legMode, 0.9, 0.018, 6);
        } else {
          outputPoints = buildSeedRegion(seedPoints, 0.98);
        }

        return {
          field: region.field,
          data: {
            ...region.data,
            points: formatPoints(outputPoints),
          },
        };
      });

      return {
        regions: generated,
        viewBox: {
          width: vbWidth,
          height: vbHeight,
        },
      };
    }, { imageBase64, regions, rasterWidth, alphaThreshold, viewBoxWidth, viewBoxHeight });

    await page.close();
    return result;
  } finally {
    await browser.close();
  }
}

async function main() {
  const options = parseArgs(process.argv);
  const [metaContent, imageBuffer] = await Promise.all([
    fs.readFile(options.meta, 'utf8'),
    fs.readFile(options.image),
  ]);

  const parsed = parseMeta(metaContent);
  const result = await generateRegions({
    imageBase64: imageBuffer.toString('base64'),
    regions: parsed.regions,
    rasterWidth: options.rasterWidth,
    alphaThreshold: options.alphaThreshold,
    viewBoxWidth: options.viewBoxWidth || parsed.viewBoxWidth,
    viewBoxHeight: options.viewBoxHeight || parsed.viewBoxHeight,
  });

  await fs.writeFile(options.meta, serializeMeta(parsed, result.regions, result.viewBox));
  console.log(`Updated ${result.regions.length} body regions in ${options.meta}`);
  console.log(`ViewBox: 0 0 ${result.viewBox.width} ${result.viewBox.height}`);
}

await main();