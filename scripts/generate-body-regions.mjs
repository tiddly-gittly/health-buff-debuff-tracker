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

      const findLocalMinima = (mode, startRatio, endRatio, windowSize = 2) => {
        const startY = rowFromRatio(startRatio);
        const endY = rowFromRatio(endRatio);
        const candidates = [];
        for (let y = startY + windowSize; y <= endY - windowSize; y += 1) {
          const row = rowStats[y];
          const segment = getSegment(row, mode);
          if (!segment || !segment.width) continue;
          let isMin = true;
          for (let w = 1; w <= windowSize; w += 1) {
            const prev = getSegment(rowStats[y - w], mode);
            const next = getSegment(rowStats[y + w], mode);
            if ((prev && segment.width >= prev.width) || (next && segment.width >= next.width)) {
              isMin = false;
              break;
            }
          }
          if (isMin) {
            candidates.push({ row, segment, y: row.y, width: segment.width });
          }
        }
        const merged = [];
        for (const c of candidates) {
          const last = merged[merged.length - 1];
          if (last && Math.abs(c.y - last.y) <= 3) {
            if (c.width < last.width) merged[merged.length - 1] = c;
          } else {
            merged.push(c);
          }
        }
        return merged;
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

      const boundsOf = (points) => {
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
      };

      const buildFaceRegion = (headBounds, name, screenSide) => {
        const headH = headBounds.maxY - headBounds.minY;
        const headW = headBounds.maxX - headBounds.minX;
        const cx = (headBounds.minX + headBounds.maxX) / 2;
        let pcx, pcy, rx, ry;
        switch (name) {
          case 'Eye (Right)':
            pcx = cx - headW * 0.20;
            pcy = headBounds.minY + headH * 0.38;
            rx = headW * 0.10;
            ry = headH * 0.07;
            break;
          case 'Eye (Left)':
            pcx = cx + headW * 0.20;
            pcy = headBounds.minY + headH * 0.38;
            rx = headW * 0.10;
            ry = headH * 0.07;
            break;
          case 'Nose':
            pcx = cx;
            pcy = headBounds.minY + headH * 0.55;
            rx = headW * 0.07;
            ry = headH * 0.09;
            break;
          case 'Mouth':
            pcx = cx;
            pcy = headBounds.minY + headH * 0.74;
            rx = headW * 0.14;
            ry = headH * 0.06;
            break;
          case 'Ear (Right)':
            pcx = headBounds.minX + headW * 0.08;
            pcy = headBounds.minY + headH * 0.44;
            rx = headW * 0.05;
            ry = headH * 0.09;
            break;
          case 'Ear (Left)':
            pcx = headBounds.maxX - headW * 0.08;
            pcy = headBounds.minY + headH * 0.44;
            rx = headW * 0.05;
            ry = headH * 0.09;
            break;
          default:
            return [];
        }
        return ellipsePoints(pcx, pcy, rx, ry).map((p) => snapPointToMask(p, { x: pcx, y: pcy }));
      };

      const buildLimbRegion = (minY, maxY, mode, seedPoints, innerLimit) => {
        if (minY >= maxY) return buildSeedRegion(seedPoints, 0.98);
        const leftEdge = [];
        const rightEdge = [];
        const steps = 14;
        for (let i = 0; i <= steps; i += 1) {
          const y = Math.round(minY + (maxY - minY) * (i / steps));
          const row = rowStats[y];
          const segment = getSegment(row, mode);
          if (segment) {
            let start = segment.start;
            let end = segment.end;
            const width = end - start;
            if (innerLimit !== undefined) {
              if (mode === 'left-outer') {
                end = Math.min(end, innerLimit);
                // 手臂通常比相连躯干窄，只取外侧约 40% 宽度避免横跨躯干
                const maxWidth = width * 0.42;
                if (end - start > maxWidth) {
                  start = end - maxWidth;
                }
              } else if (mode === 'right-outer') {
                start = Math.max(start, innerLimit);
                const maxWidth = width * 0.42;
                if (end - start > maxWidth) {
                  end = start + maxWidth;
                }
              }
            }
            if (end > start) {
              leftEdge.push({ x: start, y });
              rightEdge.push({ x: end, y });
            }
          }
        }
        const points = [...leftEdge, ...rightEdge.reverse()];
        return cleanPoints(points.length >= 3 ? points : buildSeedRegion(seedPoints, 0.98));
      };

      const buildShoulderRegion = (screenSide, neckRow, neckBottomY) => {
        const shoulderTopY = neckBottomY ?? neckRow?.y ?? rowFromRatio(0.19);
        const shoulderBottomY = shoulderTopY + bodyHeight * 0.035;
        const mode = screenSide === 'left' ? 'left-outer' : 'right-outer';

        const leftEdge = [];
        const rightEdge = [];
        const steps = 8;
        for (let i = 0; i <= steps; i += 1) {
          const y = Math.round(shoulderTopY + (shoulderBottomY - shoulderTopY) * (i / steps));
          const row = rowStats[y];
          const segment = getSegment(row, mode);
          if (segment) {
            // 只取外侧约 30% 宽度，让 shoulder 贴紧图像边缘
            const segWidth = segment.end - segment.start;
            const shoulderWidth = Math.max(6, segWidth * 0.30);
            if (screenSide === 'left') {
              leftEdge.push({ x: segment.start, y });
              rightEdge.push({ x: segment.start + shoulderWidth, y });
            } else {
              leftEdge.push({ x: segment.end - shoulderWidth, y });
              rightEdge.push({ x: segment.end, y });
            }
          }
        }
        const points = [...leftEdge, ...rightEdge.reverse()];
        return cleanPoints(points.length >= 3 ? points : []);
      };

      const screenSideFor = (name) => {
        if (name.startsWith('Right ')) return 'left';
        if (name.startsWith('Left ')) return 'right';
        return 'center';
      };

      const findWrist = (mode, elbowRow) => {
        const elbowY = elbowRow?.row?.y ?? rowFromRatio(0.28);
        // 扩大范围以找到更多 minima，包括前臂 narrowing、wrist 和 palm
        const mins = findLocalMinima(mode, 0.28, 0.65, 2);
        // 确保 wrist 在 elbow 下方足够远，避免 wrist 的椭圆顶部与 elbow 重叠
        const minGap = bodyHeight * 0.04;
        const belowElbow = mins.filter((m) => m.y > elbowY + minGap);
        // 从 elbow 往下排序（y 从小到大）
        belowElbow.sort((a, b) => a.y - b.y);
        // 跳过第一个 minima（通常是前臂 narrowing），取 wrist
        // 3+ 个时取第 2 个（跳过前臂 narrowing）
        // 2 个时取第 1 个（wrist，第 2 个是 palm）
        if (belowElbow.length >= 3) {
          return belowElbow[1];
        }
        if (belowElbow.length === 2) {
          return belowElbow[0];
        }
        return belowElbow[0] ?? pickRow(mode, 0.45, 0.55, 'min');
      };

      const rows = {
        neck: pickRow('center', 0.08, 0.19, 'min'),
        elbowLeft: pickRow('left-outer', 0.22, 0.35, 'min'),
        elbowRight: pickRow('right-outer', 0.22, 0.35, 'min'),
        wristLeft: findWrist('left-outer', pickRow('left-outer', 0.22, 0.35, 'min')),
        wristRight: findWrist('right-outer', pickRow('right-outer', 0.22, 0.35, 'min')),
        kneeLeft: pickRow('left-inner', 0.58, 0.72, 'min'),
        kneeRight: pickRow('right-inner', 0.58, 0.72, 'min'),
        ankleLeft: pickRow('left-inner', 0.82, 0.95, 'min'),
        ankleRight: pickRow('right-inner', 0.82, 0.95, 'min'),
      };

      const jointRegions = {
        neck: buildJointRegion(rows.neck, 'center', 0.9, 0.022, 7),
        elbowLeft: buildJointRegion(rows.elbowLeft, 'left-outer', 0.70, 0.015, 5),
        elbowRight: buildJointRegion(rows.elbowRight, 'right-outer', 0.70, 0.015, 5),
        wristLeft: buildJointRegion(rows.wristLeft, 'left-outer', 0.75, 0.012, 5),
        wristRight: buildJointRegion(rows.wristRight, 'right-outer', 0.75, 0.012, 5),
        kneeLeft: buildJointRegion(rows.kneeLeft, 'left-inner', 1.2, 0.024, 8),
        kneeRight: buildJointRegion(rows.kneeRight, 'right-inner', 1.2, 0.024, 8),
        ankleLeft: buildJointRegion(rows.ankleLeft, 'left-inner', 0.9, 0.018, 6),
        ankleRight: buildJointRegion(rows.ankleRight, 'right-inner', 0.9, 0.018, 6),
      };

      const jointBounds = {
        neck: boundsOf(jointRegions.neck),
        elbowLeft: boundsOf(jointRegions.elbowLeft),
        elbowRight: boundsOf(jointRegions.elbowRight),
        wristLeft: boundsOf(jointRegions.wristLeft),
        wristRight: boundsOf(jointRegions.wristRight),
        kneeLeft: boundsOf(jointRegions.kneeLeft),
        kneeRight: boundsOf(jointRegions.kneeRight),
        ankleLeft: boundsOf(jointRegions.ankleLeft),
        ankleRight: boundsOf(jointRegions.ankleRight),
      };

      // ===== 准备：确定躯干顺序和分界 =====
      const torsoNames = ['Chest', 'Abdomen', 'Pelvis'];
      const torsoSeeds = {};
      for (const name of torsoNames) {
        const region = input.regions.find((r) => r.data.name === name);
        if (region) torsoSeeds[name] = boundsOf(parsePointText(region.data.points));
      }
      const torsoOrder = torsoNames
        .filter((n) => torsoSeeds[n])
        .map((name) => ({ name, centerY: (torsoSeeds[name].minY + torsoSeeds[name].maxY) / 2 }))
        .sort((a, b) => a.centerY - b.centerY);

      const neckMaxY = jointBounds.neck?.maxY ?? rowFromRatio(0.19);
      const kneeMinY = Math.min(
        jointBounds.kneeLeft?.minY ?? rowFromRatio(0.72),
        jointBounds.kneeRight?.minY ?? rowFromRatio(0.72),
      );

      const torsoRanges = {};
      if (torsoOrder.length > 0) {
        const centers = torsoOrder.map((t) => t.centerY);
        const minC = Math.min(...centers);
        const maxC = Math.max(...centers);
        const span = maxC - minC || 1;

        const thighGap = bodyHeight * 0.08;
        const pelvisBottom = Math.min(rowFromRatio(0.68), kneeMinY - thighGap);
        // 给 shoulder 留出空间，chest 从 shoulder 底部开始
        const shoulderSpace = bodyHeight * 0.035;
        const chestTop = neckMaxY + shoulderSpace;
        const dividers = [chestTop];
        for (let i = 0; i < torsoOrder.length - 1; i += 1) {
          const c1 = (torsoOrder[i].centerY - minC) / span;
          const c2 = (torsoOrder[i + 1].centerY - minC) / span;
          const ratio = (c1 + c2) / 2;
          dividers.push(chestTop + ratio * (pelvisBottom - chestTop));
        }
        dividers.push(pelvisBottom);

        for (let i = 0; i < torsoOrder.length; i += 1) {
          torsoRanges[torsoOrder[i].name] = {
            minY: dividers[i],
            maxY: dividers[i + 1],
          };
        }
      }

      // ===== 第一遍：生成所有区域的原始形状 =====
      const rawRegions = {};
      const rawBounds = {};

      for (const region of input.regions) {
        const seedPoints = parsePointText(region.data.points);
        const screenSide = screenSideFor(region.data.name);
        const sideMode = screenSide === 'left' ? 'left-outer' : 'right-outer';
        const legMode = screenSide === 'left' ? 'left-inner' : 'right-inner';
        let points;

        if (faceNames.has(region.data.name)) {
          points = null;
        } else if (region.data.name === 'Head') {
          points = buildSeedRegion(seedPoints, 0.98);
          const neckMinY = jointBounds.neck?.minY ?? rowFromRatio(0.08);
          points = points.filter((p) => p.y >= top && p.y <= neckMinY);
          if (points.length < 3) {
            const cx = imageCenterX;
            const cy = (top + neckMinY) / 2;
            const rx = width * 0.15;
            const ry = (neckMinY - top) / 2;
            points = ellipsePoints(cx, cy, rx, ry).map((p) => snapPointToMask(p, { x: cx, y: cy }));
          }
        } else if (region.data.name === 'Neck') {
          points = jointRegions.neck;
        } else if (region.data.name.includes('Shoulder')) {
          points = buildShoulderRegion(screenSide, rows.neck?.row, jointBounds.neck?.maxY);
        } else if (region.data.name.includes('Elbow')) {
          points = screenSide === 'left' ? jointRegions.elbowLeft : jointRegions.elbowRight;
        } else if (region.data.name.includes('Wrist')) {
          points = screenSide === 'left' ? jointRegions.wristLeft : jointRegions.wristRight;
        } else if (region.data.name.includes('Knee')) {
          points = screenSide === 'left' ? jointRegions.kneeLeft : jointRegions.kneeRight;
        } else if (region.data.name.includes('Ankle')) {
          points = screenSide === 'left' ? jointRegions.ankleLeft : jointRegions.ankleRight;
        } else {
          points = buildSeedRegion(seedPoints, 0.98);
        }

        rawRegions[region.data.name] = points;
        rawBounds[region.data.name] = boundsOf(points);
      }

      // 生成五官（在 Head 内启发式）
      const headBounds = rawBounds['Head'];
      if (headBounds) {
        for (const faceName of faceNames) {
          const points = buildFaceRegion(headBounds, faceName, screenSideFor(faceName));
          rawRegions[faceName] = cleanPoints(points);
          rawBounds[faceName] = boundsOf(rawRegions[faceName]);
        }
      }

      // ===== 第二遍：应用链式约束 =====
      const generated = input.regions.map((region) => {
        const seedPoints = parsePointText(region.data.points);
        const screenSide = screenSideFor(region.data.name);
        const sideMode = screenSide === 'left' ? 'left-outer' : 'right-outer';
        const legMode = screenSide === 'left' ? 'left-inner' : 'right-inner';
        let outputPoints = rawRegions[region.data.name] ?? [];

        // 躯干区域：链式裁切
        if (region.data.name.includes('Chest') || region.data.name.includes('Abdomen') || region.data.name.includes('Pelvis')) {
          const range = torsoRanges[region.data.name];
          if (range && outputPoints.length > 0) {
            const rawB = boundsOf(outputPoints);
            const cx = (rawB.minX + rawB.maxX) / 2;
            const halfW = (rawB.maxX - rawB.minX) / 2;
            const leftEdge = [];
            const rightEdge = [];
            const steps = 14;
            const isChest = region.data.name.includes('Chest');
            for (let i = 0; i <= steps; i += 1) {
              const y = Math.round(range.minY + (range.maxY - range.minY) * (i / steps));
              const row = rowStats[y];
              const segment = getSegment(row, 'center');
              if (isChest) {
                // chest 延伸到手臂与躯干交叉处，使用 left-inner/right-inner
                const leftSeg = getSegment(row, 'left-inner');
                const rightSeg = getSegment(row, 'right-inner');
                const leftX = leftSeg ? leftSeg.start : (segment ? segment.start : cx - halfW);
                const rightX = rightSeg ? rightSeg.end : (segment ? segment.end : cx + halfW);
                if (segment || leftSeg || rightSeg) {
                  leftEdge.push({ x: leftX, y });
                  rightEdge.push({ x: rightX, y });
                }
              } else {
                // abdomen/pelvis 只取躯干中心，避免溢出到手臂
                if (segment) {
                  leftEdge.push({ x: Math.max(segment.start, cx - halfW), y });
                  rightEdge.push({ x: Math.min(segment.end, cx + halfW), y });
                }
              }
            }
            const pts = [...leftEdge, ...rightEdge.reverse()];
            outputPoints = cleanPoints(pts.length >= 3 ? pts : outputPoints);
          }
        }

        // 上臂：shoulder 到 elbow
        if (region.data.name.includes('Upper Arm')) {
          const shoulderName = screenSide === 'left' ? 'Right Shoulder' : 'Left Shoulder';
          const elbowName = screenSide === 'left' ? 'Right Elbow' : 'Left Elbow';
          const shoulderB = rawBounds[shoulderName];
          const elbowB = rawBounds[elbowName];
          const minY = shoulderB?.maxY ?? rowFromRatio(0.25);
          const maxY = elbowB?.minY ?? rowFromRatio(0.30);
          const innerLimit = shoulderB
            ? (screenSide === 'left' ? shoulderB.maxX : shoulderB.minX)
            : undefined;
          outputPoints = buildLimbRegion(minY, maxY, sideMode, seedPoints, innerLimit);
        }

        // 前臂：elbow 到 wrist
        if (region.data.name.includes('Forearm')) {
          const elbowName = screenSide === 'left' ? 'Right Elbow' : 'Left Elbow';
          const wristName = screenSide === 'left' ? 'Right Wrist' : 'Left Wrist';
          const elbowB = rawBounds[elbowName];
          const wristB = rawBounds[wristName];
          const minY = elbowB?.maxY ?? rowFromRatio(0.35);
          const maxY = wristB?.minY ?? rowFromRatio(0.45);
          outputPoints = buildLimbRegion(minY, maxY, sideMode, seedPoints);
        }

        // 手：wrist 到 bottom
        if (region.data.name.includes('Hand')) {
          const wristName = screenSide === 'left' ? 'Right Wrist' : 'Left Wrist';
          const wristB = rawBounds[wristName];
          const minY = wristB?.maxY ?? rowFromRatio(0.45);
          const maxY = bottom;
          outputPoints = buildLimbRegion(minY, maxY, sideMode, seedPoints);
        }

        // 大腿：pelvis 到 knee
        if (region.data.name.includes('Thigh')) {
          const pelvisB = rawBounds['Pelvis'];
          const kneeName = screenSide === 'left' ? 'Right Knee' : 'Left Knee';
          const kneeB = rawBounds[kneeName];
          const minY = pelvisB?.maxY ?? rowFromRatio(0.65);
          const maxY = kneeB?.minY ?? rowFromRatio(0.72);
          outputPoints = buildLimbRegion(minY, maxY, legMode, seedPoints);
        }

        // 小腿：knee 到 ankle
        if (region.data.name.includes('Lower Leg')) {
          const kneeName = screenSide === 'left' ? 'Right Knee' : 'Left Knee';
          const ankleName = screenSide === 'left' ? 'Right Ankle' : 'Left Ankle';
          const kneeB = rawBounds[kneeName];
          const ankleB = rawBounds[ankleName];
          const minY = kneeB?.maxY ?? rowFromRatio(0.75);
          const maxY = ankleB?.minY ?? rowFromRatio(0.85);
          outputPoints = buildLimbRegion(minY, maxY, legMode, seedPoints);
        }

        // 脚：ankle 到 bottom
        if (region.data.name.includes('Foot')) {
          const ankleName = screenSide === 'left' ? 'Right Ankle' : 'Left Ankle';
          const ankleB = rawBounds[ankleName];
          const minY = ankleB?.maxY ?? rowFromRatio(0.85);
          const maxY = bottom;
          outputPoints = buildLimbRegion(minY, maxY, legMode, seedPoints);
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
        debug: {
          elbowRightY: rows.elbowRight?.row?.y,
          elbowLeftY: rows.elbowLeft?.row?.y,
          wristRightY: rows.wristRight?.row?.y,
          wristLeftY: rows.wristLeft?.row?.y,
          kneeRightY: rows.kneeRight?.row?.y,
          kneeLeftY: rows.kneeLeft?.row?.y,
          ankleRightY: rows.ankleRight?.row?.y,
          ankleLeftY: rows.ankleLeft?.row?.y,
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
  if (result.debug) {
    console.log('Debug:', JSON.stringify(result.debug, null, 2));
  }
}

await main();
