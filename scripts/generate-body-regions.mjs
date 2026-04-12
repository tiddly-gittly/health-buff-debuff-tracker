import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const defaultMetaPath = path.resolve('src/health-buff-debuff-tracker/img/body.webp.meta');
const defaultImagePath = path.resolve('src/health-buff-debuff-tracker/img/body.webp');
const viewBoxWidth = 100;
const viewBoxHeight = 216;
const faceScaleByName = {
  'Eye (Right)': 2.0,
  'Eye (Left)': 2.0,
  Nose: 2.0,
  Mouth: 2.0,
  'Ear (Right)': 1.8,
  'Ear (Left)': 1.8,
};
const faceNames = new Set(Object.keys(faceScaleByName));

function parseArgs(argv) {
  const options = {
    meta: defaultMetaPath,
    image: defaultImagePath,
    rasterWidth: 520,
    rowStep: 1,
    alphaThreshold: 16,
  };
  for (let index = 2; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];
    if (current === '--meta' && next) {
      options.meta = path.resolve(next);
      index += 1;
    } else if (current === '--image' && next) {
      options.image = path.resolve(next);
      index += 1;
    } else if (current === '--raster-width' && next) {
      options.rasterWidth = Number(next);
      index += 1;
    } else if (current === '--row-step' && next) {
      options.rowStep = Number(next);
      index += 1;
    }
  }
  return options;
}

function parseMeta(content) {
  const headers = [];
  const regions = [];
  for (const line of content.split(/\r?\n/)) {
    if (line.startsWith('body-region-')) {
      const separatorIndex = line.indexOf(': ');
      if (separatorIndex === -1) continue;
      const field = line.slice(0, separatorIndex);
      const jsonText = line.slice(separatorIndex + 2).trim();
      if (!jsonText) continue;
      regions.push({ field, data: JSON.parse(jsonText) });
    } else if (!line.startsWith('body-regions:')) {
      headers.push(line);
    }
  }
  return { headers, regions };
}

function serializeMeta(headers, regions) {
  const regionLines = regions.map(({ field, data }) => `${field}: ${JSON.stringify(data)}`);
  return [...headers, ...regionLines].join('\n');
}

async function generateRegions({ imageBase64, regions, rasterWidth, rowStep, alphaThreshold }) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const result = await page.evaluate(
      async ({ imageBase64: source, regions: seedRegions, rasterWidth: width, rowStep: step, alphaThreshold: alphaCutoff, viewBoxWidth: vbWidth, viewBoxHeight: vbHeight, faceScaleByName: faceScale }) => {
        const loadImage = async () => new Promise((resolve, reject) => {
          const image = new Image();
          image.onload = () => resolve(image);
          image.onerror = reject;
          image.src = `data:image/webp;base64,${source}`;
        });

        const image = await loadImage();
        const rasterHeight = Math.round(width * (image.height / image.width));
        const scaleX = width / vbWidth;
        const scaleY = rasterHeight / vbHeight;
        const imageCanvas = document.createElement('canvas');
        imageCanvas.width = width;
        imageCanvas.height = rasterHeight;
        const imageContext = imageCanvas.getContext('2d');
        imageContext.drawImage(image, 0, 0, width, rasterHeight);
        const alpha = imageContext.getImageData(0, 0, width, rasterHeight).data;

        const bodyMask = new Uint8Array(width * rasterHeight);
        for (let y = 0; y < rasterHeight; y += 1) {
          for (let x = 0; x < width; x += 1) {
            const offset = (y * width + x) * 4 + 3;
            bodyMask[y * width + x] = alpha[offset] >= alphaCutoff ? 1 : 0;
          }
        }

        const pointInPolygon = (pointX, pointY, polygon) => {
          let inside = false;
          for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            const xi = polygon[i].x;
            const yi = polygon[i].y;
            const xj = polygon[j].x;
            const yj = polygon[j].y;
            const intersects = ((yi > pointY) !== (yj > pointY)) &&
              (pointX < ((xj - xi) * (pointY - yi)) / ((yj - yi) || 1e-6) + xi);
            if (intersects) inside = !inside;
          }
          return inside;
        };

        const centroidOf = (points) => {
          let x = 0;
          let y = 0;
          for (const point of points) {
            x += point.x;
            y += point.y;
          }
          return {
            x: x / points.length,
            y: y / points.length,
          };
        };

        const scalePolygon = (points, scale) => {
          const centroid = centroidOf(points);
          return points.map((point) => ({
            x: centroid.x + (point.x - centroid.x) * scale,
            y: centroid.y + (point.y - centroid.y) * scale,
          }));
        };

        const dedupePoints = (points) => {
          const deduped = [];
          for (const point of points) {
            const previous = deduped[deduped.length - 1];
            if (!previous || Math.hypot(previous.x - point.x, previous.y - point.y) > 0.35) {
              deduped.push(point);
            }
          }
          if (deduped.length > 1) {
            const first = deduped[0];
            const last = deduped[deduped.length - 1];
            if (Math.hypot(first.x - last.x, first.y - last.y) <= 0.35) {
              deduped.pop();
            }
          }
          return deduped;
        };

        const chaikin = (points, passes) => {
          let output = points;
          for (let pass = 0; pass < passes; pass += 1) {
            if (output.length < 3) return output;
            const next = [];
            for (let i = 0; i < output.length; i += 1) {
              const current = output[i];
              const following = output[(i + 1) % output.length];
              next.push({
                x: current.x * 0.75 + following.x * 0.25,
                y: current.y * 0.75 + following.y * 0.25,
              });
              next.push({
                x: current.x * 0.25 + following.x * 0.75,
                y: current.y * 0.25 + following.y * 0.75,
              });
            }
            output = next;
          }
          return output;
        };

        const perpendicularDistance = (point, lineStart, lineEnd) => {
          const dx = lineEnd.x - lineStart.x;
          const dy = lineEnd.y - lineStart.y;
          if (dx === 0 && dy === 0) return Math.hypot(point.x - lineStart.x, point.y - lineStart.y);
          return Math.abs(dy * point.x - dx * point.y + lineEnd.x * lineStart.y - lineEnd.y * lineStart.x) / Math.hypot(dx, dy);
        };

        const rdp = (points, epsilon) => {
          if (points.length < 3) return points;
          let maxDistance = 0;
          let splitIndex = 0;
          for (let i = 1; i < points.length - 1; i += 1) {
            const distance = perpendicularDistance(points[i], points[0], points[points.length - 1]);
            if (distance > maxDistance) {
              maxDistance = distance;
              splitIndex = i;
            }
          }
          if (maxDistance <= epsilon) return [points[0], points[points.length - 1]];
          const left = rdp(points.slice(0, splitIndex + 1), epsilon);
          const right = rdp(points.slice(splitIndex), epsilon);
          return [...left.slice(0, -1), ...right];
        };

        const simplifyClosed = (points, epsilon) => {
          if (points.length < 4) return points;
          const open = [...points, points[0]];
          const simplified = rdp(open, epsilon);
          return dedupePoints(simplified.slice(0, -1));
        };

        const toViewBox = (points) => points.map((point) => ({
          x: Math.max(0, Math.min(vbWidth, point.x / scaleX)),
          y: Math.max(0, Math.min(vbHeight, point.y / scaleY)),
        }));

        const formattedPoints = (points) => points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');

        const nonFaceRegions = [];
        const faceRegions = [];
        for (const region of seedRegions) {
          const rawPoints = region.data.points.split(' ').filter(Boolean).map((pair) => {
            const [x, y] = pair.split(',').map(Number);
            return { x, y };
          });
          if (faceScale[region.data.name]) {
            const scaled = scalePolygon(rawPoints, faceScale[region.data.name]);
            faceRegions.push({ ...region, points: scaled });
          } else {
            const scaledPoints = rawPoints.map((point) => ({
              x: point.x * scaleX,
              y: point.y * scaleY,
            }));
            const centroid = centroidOf(scaledPoints);
            const bbox = scaledPoints.reduce((accumulator, point) => ({
              minX: Math.min(accumulator.minX, point.x),
              maxX: Math.max(accumulator.maxX, point.x),
              minY: Math.min(accumulator.minY, point.y),
              maxY: Math.max(accumulator.maxY, point.y),
            }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
            nonFaceRegions.push({
              ...region,
              points: scaledPoints,
              centroid,
              bbox,
            });
          }
        }

                const getDistanceToPolygon = (px, py, polygon) => {
          let minDist = Infinity;
          for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            const p1 = polygon[i];
            const p2 = polygon[j];
            const l2 = (p1.x - p2.x)*(p1.x - p2.x) + (p1.y - p2.y)*(p1.y - p2.y);
            if (l2 === 0) {
              minDist = Math.min(minDist, (px - p1.x)**2 + (py - p1.y)**2);
              continue;
            }
            let t = ((px - p1.x) * (p2.x - p1.x) + (py - p1.y) * (p2.y - p1.y)) / l2;
            t = Math.max(0, Math.min(1, t));
            const projX = p1.x + t * (p2.x - p1.x);
            const projY = p1.y + t * (p2.y - p1.y);
            minDist = Math.min(minDist, (px - projX)**2 + (py - projY)**2);
          }
          return Math.sqrt(minDist);
        };

        const labelMap = new Int16Array(width * rasterHeight);
        labelMap.fill(-1);
        for (let y = 0; y < rasterHeight; y += 1) {
          for (let x = 0; x < width; x += 1) {
            const pixelIndex = y * width + x;
            if (!bodyMask[pixelIndex]) continue;
            
            const inRegions = [];
            for (let regionIndex = 0; regionIndex < nonFaceRegions.length; regionIndex += 1) {
              const region = nonFaceRegions[regionIndex];
              if (
                x >= region.bbox.minX - 4 && x <= region.bbox.maxX + 4 &&
                y >= region.bbox.minY - 4 && y <= region.bbox.maxY + 4 &&
                pointInPolygon(x, y, region.points)
              ) {
                inRegions.push(regionIndex);
              }
            }

            if (inRegions.length === 1) {
              labelMap[pixelIndex] = inRegions[0];
            } else if (inRegions.length > 1) {
              let bestIndex = -1;
              let maxDepth = -Infinity;
              for (const regionIndex of inRegions) {
                 const depth = getDistanceToPolygon(x, y, nonFaceRegions[regionIndex].points);
                 if (depth > maxDepth) {
                    maxDepth = depth;
                    bestIndex = regionIndex;
                 }
              }
              labelMap[pixelIndex] = bestIndex;
            } else {
              let bestIndex = -1;
              let minDist = Infinity;
              for (let regionIndex = 0; regionIndex < nonFaceRegions.length; regionIndex += 1) {
                 const region = nonFaceRegions[regionIndex];
                 if (y < region.bbox.minY - 100 || y > region.bbox.maxY + 100) continue;
                 const dist = getDistanceToPolygon(x, y, region.points);
                 if (dist < minDist) {
                    minDist = dist;
                    bestIndex = regionIndex;
                 }
              }
              labelMap[pixelIndex] = bestIndex;
            }
          }
        }
const generated = [];
        for (let regionIndex = 0; regionIndex < nonFaceRegions.length; regionIndex += 1) {
          const region = nonFaceRegions[regionIndex];
          const leftEdge = [];
          const rightEdge = [];
          const assignedYs = [];
          for (let y = 0; y < rasterHeight; y += step) {
            let firstX = -1;
            let lastX = -1;
            for (let x = 0; x < width; x += 1) {
              if (labelMap[y * width + x] !== regionIndex) continue;
              if (firstX === -1) firstX = x;
              lastX = x;
            }
            if (firstX !== -1) { leftEdge.push({ x: firstX - 0.5, y }); rightEdge.push({ x: lastX + 0.5, y }); }
          }

          if (leftEdge.length < 2) {
            generated.push(region);
            continue;
          }

          const polygon = dedupePoints([...leftEdge, ...rightEdge.reverse()]);
          const smoothed = simplifyClosed(polygon, 0.8);
          const viewBoxPoints = toViewBox(smoothed);
          generated.push({
            field: region.field,
            data: {
              ...region.data,
              points: formattedPoints(viewBoxPoints),
            },
          });
        }

        for (const region of faceRegions) {
          generated.push({
            field: region.field,
            data: {
              ...region.data,
              points: formattedPoints(region.points),
            },
          });
        }

        const order = new Map(seedRegions.map((region, index) => [region.field, index]));
        generated.sort((left, right) => (order.get(left.field) ?? 0) - (order.get(right.field) ?? 0));
        return generated;
      },
      { imageBase64, regions, rasterWidth, rowStep, alphaThreshold, viewBoxWidth, viewBoxHeight, faceScaleByName },
    );
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
  const generatedRegions = await generateRegions({
    imageBase64: imageBuffer.toString('base64'),
    regions: parsed.regions,
    rasterWidth: options.rasterWidth,
    rowStep: options.rowStep,
    alphaThreshold: options.alphaThreshold,
  });
  await fs.writeFile(options.meta, serializeMeta(parsed.headers, generatedRegions));
  console.log(`Updated ${generatedRegions.length} body regions in ${options.meta}`);
}

await main();