import type { GenerationInput, GenerationResult } from './types.js';

export async function generateBodyRegions(options: GenerationInput): Promise<GenerationResult> {
  const { document, imageBase64, regions, rasterWidth, alphaThreshold, viewBoxWidth, viewBoxHeight } = options;
  const faceNames = new Set([
    'Eye (Right)',
    'Eye (Left)',
    'Nose',
    'Mouth',
    'Ear (Right)',
    'Ear (Left)',
  ]);

  const loadImage = async () => new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Failed to load source image.'));
    image.src = `data:image/webp;base64,${imageBase64}`;
  });

  const image = await loadImage();
  const vbWidth = viewBoxWidth || 100;
  const vbHeight = viewBoxHeight > 0
    ? viewBoxHeight
    : Math.round(((vbWidth * image.height) / image.width) * 10) / 10;
  const width = rasterWidth;
  const height = Math.max(1, Math.round(width * (image.height / image.width)));
  const scaleX = width / vbWidth;
  const scaleY = height / vbHeight;
  const imageCenterX = width / 2;

  const canvas = document.createElement('canvas') as HTMLCanvasElement;
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Canvas 2D context is unavailable.');
  }
  context.drawImage(image, 0, 0, width, height);
  const alpha = context.getImageData(0, 0, width, height).data;

  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4 + 3;
      mask[y * width + x] = alpha[offset] >= alphaThreshold ? 1 : 0;
    }
  }

  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
  const round = (value: number) => Math.round(value * 10) / 10;
  const parsePointText = (pointsText: string) => pointsText.split(' ').filter(Boolean).map((pair) => {
    const [x, y] = pair.split(',').map(Number);
    return { x: x * scaleX, y: y * scaleY };
  });
  const centroidOf = (points: Array<{ x: number; y: number }>) => {
    const sum = points.reduce((accumulator, point) => ({
      x: accumulator.x + point.x,
      y: accumulator.y + point.y,
    }), { x: 0, y: 0 });
    return {
      x: sum.x / Math.max(1, points.length),
      y: sum.y / Math.max(1, points.length),
    };
  };
  const scaleAroundCenter = (points: Array<{ x: number; y: number }>, scale: number) => {
    const center = centroidOf(points);
    return points.map((point) => ({
      x: center.x + (point.x - center.x) * scale,
      y: center.y + (point.y - center.y) * scale,
    }));
  };
  const formatPoints = (points: Array<{ x: number; y: number }>) => points.map((point) => `${round(clamp(point.x / scaleX, 0, vbWidth))},${round(clamp(point.y / scaleY, 0, vbHeight))}`).join(' ');

  const maskAt = (x: number, y: number) => {
    const rx = Math.round(x);
    const ry = Math.round(y);
    if (rx < 0 || rx >= width || ry < 0 || ry >= height) return false;
    return mask[ry * width + rx] === 1;
  };

  const rowStats: any[] = [];
  let top = height - 1;
  let bottom = 0;

  for (let y = 0; y < height; y += 1) {
    const segments: any[] = [];
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
  const rowFromRatio = (ratio: number) => clamp(Math.round(top + bodyHeight * ratio), top, bottom);
  const getSegment = (row: any, mode: string) => {
    if (!row) return null;
    if (mode === 'center') return row.center ?? row.whole;
    if (mode === 'left-outer') return row.segments[0] ?? row.whole;
    if (mode === 'right-outer') return row.segments[row.segments.length - 1] ?? row.whole;
    if (mode === 'left-inner') {
      const candidates = row.segments.filter((segment: any) => segment.cx < imageCenterX);
      return candidates[candidates.length - 1] ?? row.center ?? row.whole;
    }
    if (mode === 'right-inner') {
      const candidates = row.segments.filter((segment: any) => segment.cx > imageCenterX);
      return candidates[0] ?? row.center ?? row.whole;
    }
    return row.whole;
  };

  const pickRow = (mode: string, startRatio: number, endRatio: number, kind: 'max' | 'min') => {
    let best: any = null;
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

  const findLocalMinima = (mode: string, startRatio: number, endRatio: number, windowSize = 2) => {
    const startY = rowFromRatio(startRatio);
    const endY = rowFromRatio(endRatio);
    const candidates: any[] = [];
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
    const merged: any[] = [];
    for (const candidate of candidates) {
      const last = merged[merged.length - 1];
      if (last && Math.abs(candidate.y - last.y) <= 3) {
        if (candidate.width < last.width) merged[merged.length - 1] = candidate;
      } else {
        merged.push(candidate);
      }
    }
    return merged;
  };

  const limbClusterGap = Math.max(4, Math.round(width * 0.01));
  const maxLimbCenterShift = Math.max(28, Math.round(width * 0.08));

  const getSideCluster = (row: any, side: 'left' | 'right') => {
    if (!row || row.segments.length === 0) return null;
    const sideSegments = row.segments.filter((segment: any) => (side === 'left' ? segment.cx < imageCenterX : segment.cx > imageCenterX));
    if (sideSegments.length === 0) return null;

    if (side === 'left') {
      let start = sideSegments[0].start;
      let end = sideSegments[0].end;
      for (let index = 1; index < sideSegments.length; index += 1) {
        const segment = sideSegments[index];
        if (segment.start - end > limbClusterGap) break;
        end = segment.end;
      }
      return { start, end, width: end - start + 1, cx: (start + end) / 2 };
    }

    let start = sideSegments[sideSegments.length - 1].start;
    let end = sideSegments[sideSegments.length - 1].end;
    for (let index = sideSegments.length - 2; index >= 0; index -= 1) {
      const segment = sideSegments[index];
      if (start - segment.end > limbClusterGap) break;
      start = segment.start;
    }
    return { start, end, width: end - start + 1, cx: (start + end) / 2 };
  };

  const getTrackedLimbSegment = (row: any, mode: string, previousSegment: any, anchorX?: number) => {
    const side = mode === 'left-outer' ? 'left' : mode === 'right-outer' ? 'right' : null;
    if (!side) return getSegment(row, mode);
    const cluster = getSideCluster(row, side);
    if (!cluster) return null;

    const targetX = previousSegment?.cx ?? anchorX;
    if (targetX === undefined) return cluster;
    if (Math.abs(cluster.cx - targetX) > maxLimbCenterShift) return null;
    return cluster;
  };

  const findWristBySplit = (mode: string) => {
    const side = mode === 'left-outer' ? 'left' : 'right';
    const startY = rowFromRatio(0.35);
    const endY = rowFromRatio(0.62);
    for (let y = startY; y <= endY; y += 1) {
      const row = rowStats[y];
      const sideSegments = row.segments.filter((segment: any) =>
        side === 'left'
          ? segment.end < imageCenterX * 0.55
          : segment.start > imageCenterX * 1.45,
      );
      if (sideSegments.length >= 2) {
        const outerMost = side === 'left' ? sideSegments[0] : sideSegments[sideSegments.length - 1];
        const secondOuter = side === 'left' ? sideSegments[1] : sideSegments[sideSegments.length - 2];
        const gap = side === 'left' ? secondOuter.start - outerMost.end : outerMost.start - secondOuter.end;
        const nearEdge = side === 'left'
          ? outerMost.start < width * 0.15
          : outerMost.end > width * 0.85;
        if (gap >= 3 && nearEdge) {
          return { row, segment: outerMost, y, width: outerMost.width };
        }
      }
    }
    return null;
  };

  const findArmLandmarks = (mode: string, elbowRow: any) => {
    const elbowY = elbowRow?.row?.y ?? rowFromRatio(0.28);
    const wristSearchStartY = Math.max(Math.round(elbowY + bodyHeight * 0.12), rowFromRatio(0.45));
    const candidates = findLocalMinima(mode, 0.28, 0.65, 2)
      .filter((match) => match.y >= wristSearchStartY)
      .sort((a, b) => b.y - a.y);
    const splitWrist = findWristBySplit(mode);
    if (splitWrist) {
      return { wrist: splitWrist, candidates };
    }
    return {
      wrist: candidates[1] ?? candidates[0] ?? pickRow(mode, 0.5, 0.62, 'min'),
      candidates,
    };
  };

  const hasSeparatedTorsoRow = (row: any) => {
    if (!row || !row.center || row.segments.length < 3) return false;
    const leftOuter = row.segments[0];
    const rightOuter = row.segments[row.segments.length - 1];
    return leftOuter.end < row.center.start && rightOuter.start > row.center.end;
  };

  const findRowByPredicate = (startRatio: number, endRatio: number, predicate: (row: any) => boolean) => {
    for (let y = rowFromRatio(startRatio); y <= rowFromRatio(endRatio); y += 1) {
      if (predicate(rowStats[y])) return y;
    }
    return null;
  };

  const centerSliceOf = (segment: any, widthRatio: number) => {
    const inset = Math.max(0, (segment.width * (1 - widthRatio)) / 2);
    return {
      start: segment.start + inset,
      end: segment.end - inset,
    };
  };

  const snapPointToMask = (point: { x: number; y: number }, center: { x: number; y: number }) => {
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

  const cleanPoints = (points: Array<{ x: number; y: number }>) => {
    const deduped: Array<{ x: number; y: number }> = [];
    for (const point of points) {
      const previous = deduped[deduped.length - 1];
      if (!previous || Math.hypot(previous.x - point.x, previous.y - point.y) > 1.2) {
        deduped.push(point);
      }
    }
    return deduped;
  };

  const ellipsePoints = (cx: number, cy: number, rx: number, ry: number, steps = 14) => {
    const points: Array<{ x: number; y: number }> = [];
    for (let index = 0; index < steps; index += 1) {
      const angle = (index / steps) * Math.PI * 2;
      points.push({
        x: cx + Math.cos(angle) * rx,
        y: cy + Math.sin(angle) * ry,
      });
    }
    return points;
  };

  const buildSeedRegion = (points: Array<{ x: number; y: number }>, shrink = 1) => {
    const scaled = shrink === 1 ? points : scaleAroundCenter(points, shrink);
    const center = centroidOf(scaled);
    return cleanPoints(scaled.map((point) => snapPointToMask(point, center)));
  };

  const buildJointRegion = (rowMatch: any, mode: string, widthScale: number, heightScale: number, minSize = 8) => {
    const segment = rowMatch.segment ?? getSegment(rowMatch.row, mode);
    if (!segment) return [];
    const cx = segment.cx;
    const cy = rowMatch.row.y;
    const rx = Math.max(minSize, segment.width * widthScale * 0.5);
    const ry = Math.max(minSize * 0.7, bodyHeight * heightScale);
    const center = { x: cx, y: cy };
    return cleanPoints(ellipsePoints(cx, cy, rx, ry).map((point) => snapPointToMask(point, center)));
  };

  const boundsOf = (points: Array<{ x: number; y: number }> | null | undefined) => {
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

  const buildFaceRegion = (headBounds: any, name: string) => {
    const headH = headBounds.maxY - headBounds.minY;
    const headW = headBounds.maxX - headBounds.minX;
    const cx = (headBounds.minX + headBounds.maxX) / 2;
    let pcx = cx;
    let pcy = headBounds.minY + headH * 0.5;
    let rx = headW * 0.1;
    let ry = headH * 0.1;
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
    return ellipsePoints(pcx, pcy, rx, ry).map((point) => snapPointToMask(point, { x: pcx, y: pcy }));
  };

  const buildLimbRegion = (minY: number, maxY: number, mode: string, seedPoints: Array<{ x: number; y: number }>, innerLimit?: number, settings: any = {}) => {
    if (minY >= maxY) return buildSeedRegion(seedPoints, 0.98);
    const leftEdge: Array<{ x: number; y: number }> = [];
    const rightEdge: Array<{ x: number; y: number }> = [];
    let previousSegment: any = null;
    const trackedRows: number[] = [];
    if (settings.trackConnected) {
      const rowStep = Math.max(1, settings.rowStep ?? Math.round(bodyHeight * 0.003));
      for (let y = Math.round(minY); y <= Math.round(maxY); y += rowStep) {
        trackedRows.push(y);
      }
      if (trackedRows[trackedRows.length - 1] !== Math.round(maxY)) {
        trackedRows.push(Math.round(maxY));
      }
    } else {
      const steps = 14;
      for (let index = 0; index <= steps; index += 1) {
        trackedRows.push(Math.round(minY + (maxY - minY) * (index / steps)));
      }
    }

    for (const y of trackedRows) {
      const row = rowStats[y];
      const segment = settings.trackConnected
        ? getTrackedLimbSegment(row, mode, previousSegment, settings.anchorX)
        : getSegment(row, mode);
      if (segment) {
        let start = segment.start;
        let end = segment.end;
        const regionWidth = end - start;
        if (innerLimit !== undefined) {
          if (mode === 'left-outer') {
            end = Math.min(end, innerLimit);
            const maxWidth = regionWidth * 0.42;
            if (end - start > maxWidth) {
              start = end - maxWidth;
            }
          } else if (mode === 'right-outer') {
            start = Math.max(start, innerLimit);
            const maxWidth = regionWidth * 0.42;
            if (end - start > maxWidth) {
              end = start + maxWidth;
            }
          }
        }
        if (end > start) {
          leftEdge.push({ x: start, y });
          rightEdge.push({ x: end, y });
          previousSegment = { start, end, cx: (start + end) / 2 };
        }
      } else if (settings.stopOnDisconnect && previousSegment) {
        break;
      }
    }
    const points = [...leftEdge, ...rightEdge.reverse()];
    return cleanPoints(points.length >= 3 ? points : buildSeedRegion(seedPoints, 0.98));
  };

  const buildShoulderRegion = (screenSide: string, neckRow: any, neckBottomY?: number) => {
    const shoulderTopY = neckBottomY ?? neckRow?.y ?? rowFromRatio(0.19);
    const shoulderBottomY = shoulderTopY + bodyHeight * 0.035;
    const mode = screenSide === 'left' ? 'left-outer' : 'right-outer';

    const leftEdge: Array<{ x: number; y: number }> = [];
    const rightEdge: Array<{ x: number; y: number }> = [];
    const steps = 8;
    for (let index = 0; index <= steps; index += 1) {
      const y = Math.round(shoulderTopY + (shoulderBottomY - shoulderTopY) * (index / steps));
      const row = rowStats[y];
      const segment = getSegment(row, mode);
      if (segment) {
        const segmentWidth = segment.end - segment.start;
        const shoulderWidth = Math.max(6, segmentWidth * 0.30);
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

  const screenSideFor = (name: string) => {
    if (name.startsWith('Right ')) return 'left';
    if (name.startsWith('Left ')) return 'right';
    return 'center';
  };

  const elbowLeft = pickRow('left-outer', 0.22, 0.35, 'min');
  const elbowRight = pickRow('right-outer', 0.22, 0.35, 'min');
  const armLandmarksLeft = findArmLandmarks('left-outer', elbowLeft);
  const armLandmarksRight = findArmLandmarks('right-outer', elbowRight);

  const rows = {
    neck: pickRow('center', 0.08, 0.19, 'min'),
    elbowLeft,
    elbowRight,
    wristLeft: armLandmarksLeft.wrist,
    wristRight: armLandmarksRight.wrist,
    kneeLeft: pickRow('left-inner', 0.58, 0.72, 'min'),
    kneeRight: pickRow('right-inner', 0.58, 0.72, 'min'),
    ankleLeft: pickRow('left-inner', 0.82, 0.95, 'min'),
    ankleRight: pickRow('right-inner', 0.82, 0.95, 'min'),
  };

  const jointRegions = {
    neck: buildJointRegion(rows.neck, 'center', 0.9, 0.022, 7),
    elbowLeft: buildJointRegion(rows.elbowLeft, 'left-outer', 0.70, 0.015, 5),
    elbowRight: buildJointRegion(rows.elbowRight, 'right-outer', 0.70, 0.015, 5),
    wristLeft: buildJointRegion(rows.wristLeft, 'left-outer', 0.75, 0.006, 5),
    wristRight: buildJointRegion(rows.wristRight, 'right-outer', 0.75, 0.006, 5),
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

  const torsoNames = ['Chest', 'Abdomen', 'Pelvis'];
  const torsoSeeds: Record<string, any> = {};
  for (const name of torsoNames) {
    const region = regions.find((entry) => entry.data.name === name);
    if (region) torsoSeeds[name] = boundsOf(parsePointText(region.data.points));
  }
  const torsoOrder = torsoNames
    .filter((name) => torsoSeeds[name])
    .map((name) => ({ name, centerY: (torsoSeeds[name].minY + torsoSeeds[name].maxY) / 2 }))
    .sort((left, right) => left.centerY - right.centerY);

  const neckMaxY = jointBounds.neck?.maxY ?? rowFromRatio(0.19);
  const kneeMinY = Math.min(
    jointBounds.kneeLeft?.minY ?? rowFromRatio(0.72),
    jointBounds.kneeRight?.minY ?? rowFromRatio(0.72),
  );
  const torsoIsolationTop = findRowByPredicate(0.28, 0.5, hasSeparatedTorsoRow) ?? rowFromRatio(0.34);
  const legSplitTop = findRowByPredicate(0.5, 0.75, (row) => row && row.segments.length >= 2 && !row.segments.some((segment: any) => imageCenterX >= segment.start && imageCenterX <= segment.end))
    ?? rowFromRatio(0.62);

  const torsoRanges: Record<string, { minY: number; maxY: number }> = {};
  if (torsoOrder.length > 0) {
    const centers = torsoOrder.map((entry) => entry.centerY);
    const minC = Math.min(...centers);
    const maxC = Math.max(...centers);
    const span = maxC - minC || 1;

    const thighGap = bodyHeight * 0.08;
    const pelvisBottom = Math.min(legSplitTop - bodyHeight * 0.018, kneeMinY - thighGap);
    const shoulderSpace = bodyHeight * 0.035;
    const chestTop = neckMaxY + shoulderSpace;
    const dividers = [chestTop];
    for (let index = 0; index < torsoOrder.length - 1; index += 1) {
      const c1 = (torsoOrder[index].centerY - minC) / span;
      const c2 = (torsoOrder[index + 1].centerY - minC) / span;
      const ratio = (c1 + c2) / 2;
      dividers.push(chestTop + ratio * (pelvisBottom - chestTop));
    }
    dividers.push(pelvisBottom);

    for (let index = 0; index < torsoOrder.length; index += 1) {
      torsoRanges[torsoOrder[index].name] = {
        minY: dividers[index],
        maxY: dividers[index + 1],
      };
    }

    if (torsoRanges.Abdomen) {
      torsoRanges.Abdomen.minY = Math.max(torsoRanges.Abdomen.minY, torsoIsolationTop);
      if (torsoRanges.Chest) {
        torsoRanges.Chest.maxY = torsoRanges.Abdomen.minY;
      }
    }

    if (torsoRanges.Pelvis) {
      torsoRanges.Pelvis.maxY = Math.min(torsoRanges.Pelvis.maxY, pelvisBottom);
    }

    if (torsoRanges.Abdomen && torsoRanges.Pelvis) {
      const minPelvisHeight = bodyHeight * 0.08;
      const abdomenBottom = Math.min(torsoRanges.Abdomen.maxY, torsoRanges.Pelvis.maxY - minPelvisHeight);
      torsoRanges.Abdomen.maxY = abdomenBottom;
      torsoRanges.Pelvis.minY = abdomenBottom;
    }
  }

  const rawRegions: Record<string, Array<{ x: number; y: number }>> = {};
  const rawBounds: Record<string, any> = {};

  for (const region of regions) {
    const seedPoints = parsePointText(region.data.points);
    const screenSide = screenSideFor(region.data.name);
    const sideMode = screenSide === 'left' ? 'left-outer' : 'right-outer';
    const legMode = screenSide === 'left' ? 'left-inner' : 'right-inner';
    let points: Array<{ x: number; y: number }> | null = [];

    if (faceNames.has(region.data.name)) {
      points = null;
    } else if (region.data.name === 'Head') {
      points = buildSeedRegion(seedPoints, 0.98);
      const neckMinY = jointBounds.neck?.minY ?? rowFromRatio(0.08);
      points = points.filter((point) => point.y >= top && point.y <= neckMinY);
      if (points.length < 3) {
        const cx = imageCenterX;
        const cy = (top + neckMinY) / 2;
        const rx = width * 0.15;
        const ry = (neckMinY - top) / 2;
        points = ellipsePoints(cx, cy, rx, ry).map((point) => snapPointToMask(point, { x: cx, y: cy }));
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

    rawRegions[region.data.name] = points ?? [];
    rawBounds[region.data.name] = boundsOf(points ?? []);
  }

  const headBounds = rawBounds.Head;
  if (headBounds) {
    for (const faceName of faceNames) {
      const points = buildFaceRegion(headBounds, faceName);
      rawRegions[faceName] = cleanPoints(points);
      rawBounds[faceName] = boundsOf(rawRegions[faceName]);
    }
  }

  const generated = regions.map((region) => {
    const seedPoints = parsePointText(region.data.points);
    const screenSide = screenSideFor(region.data.name);
    const sideMode = screenSide === 'left' ? 'left-outer' : 'right-outer';
    const legMode = screenSide === 'left' ? 'left-inner' : 'right-inner';
    let outputPoints = rawRegions[region.data.name] ?? [];

    if (region.data.name.includes('Chest') || region.data.name.includes('Abdomen') || region.data.name.includes('Pelvis')) {
      const range = torsoRanges[region.data.name];
      if (range && outputPoints.length > 0) {
        const leftEdge: Array<{ x: number; y: number }> = [];
        const rightEdge: Array<{ x: number; y: number }> = [];
        const steps = 14;
        const isChest = region.data.name.includes('Chest');
        for (let index = 0; index <= steps; index += 1) {
          const y = Math.round(range.minY + (range.maxY - range.minY) * (index / steps));
          const row = rowStats[y];
          const segment = getSegment(row, 'center');
          if (!segment) continue;
          const widthRatio = isChest ? 0.60 : (region.data.name.includes('Abdomen') ? 0.8 : 0.72);
          const centerSlice = centerSliceOf(segment, widthRatio);
          leftEdge.push({ x: centerSlice.start, y });
          rightEdge.push({ x: centerSlice.end, y });
        }
        const points = [...leftEdge, ...rightEdge.reverse()];
        outputPoints = cleanPoints(points.length >= 3 ? points : outputPoints);
      }
    }

    if (region.data.name.includes('Upper Arm')) {
      const shoulderName = screenSide === 'left' ? 'Right Shoulder' : 'Left Shoulder';
      const elbowName = screenSide === 'left' ? 'Right Elbow' : 'Left Elbow';
      const shoulderB = rawBounds[shoulderName];
      const elbowB = rawBounds[elbowName];
      const minY = shoulderB?.maxY ?? rowFromRatio(0.25);
      const maxY = elbowB?.minY ?? rowFromRatio(0.30);
      const innerLimit = shoulderB ? (screenSide === 'left' ? shoulderB.maxX : shoulderB.minX) : undefined;
      outputPoints = buildLimbRegion(minY, maxY, sideMode, seedPoints, innerLimit);
    }

    if (region.data.name.includes('Forearm')) {
      const elbowName = screenSide === 'left' ? 'Right Elbow' : 'Left Elbow';
      const elbowB = rawBounds[elbowName];
      const wristRow = screenSide === 'left' ? rows.wristRight : rows.wristLeft;
      const wristY = wristRow?.row?.y ?? rowFromRatio(0.45);
      const wristRy = Math.max(5 * 0.7, bodyHeight * 0.006);
      const minY = elbowB?.maxY ?? rowFromRatio(0.35);
      const maxY = Math.round(wristY - wristRy);
      outputPoints = buildLimbRegion(minY, maxY, sideMode, seedPoints);
    }

    if (region.data.name.includes('Hand')) {
      const wristRow = screenSide === 'left' ? rows.wristRight : rows.wristLeft;
      const wristName = screenSide === 'left' ? 'Right Wrist' : 'Left Wrist';
      const wristB = rawBounds[wristName];
      const wristY = wristRow?.row?.y ?? rowFromRatio(0.45);
      const wristRy = Math.max(5 * 0.7, bodyHeight * 0.006);
      const minY = Math.round(wristY + wristRy);
      const maxY = bottom;
      const anchorX = wristB ? (wristB.minX + wristB.maxX) / 2 : undefined;
      outputPoints = buildLimbRegion(minY, maxY, sideMode, seedPoints, undefined, {
        trackConnected: true,
        stopOnDisconnect: true,
        anchorX,
      });
    }

    if (region.data.name.includes('Thigh')) {
      const pelvisB = rawBounds.Pelvis;
      const kneeName = screenSide === 'left' ? 'Right Knee' : 'Left Knee';
      const kneeB = rawBounds[kneeName];
      const minY = pelvisB?.maxY ?? rowFromRatio(0.65);
      const maxY = kneeB?.minY ?? rowFromRatio(0.72);
      outputPoints = buildLimbRegion(minY, maxY, legMode, seedPoints);
    }

    if (region.data.name.includes('Lower Leg')) {
      const kneeName = screenSide === 'left' ? 'Right Knee' : 'Left Knee';
      const ankleName = screenSide === 'left' ? 'Right Ankle' : 'Left Ankle';
      const kneeB = rawBounds[kneeName];
      const ankleB = rawBounds[ankleName];
      const minY = kneeB?.maxY ?? rowFromRatio(0.75);
      const maxY = ankleB?.minY ?? rowFromRatio(0.85);
      outputPoints = buildLimbRegion(minY, maxY, legMode, seedPoints);
    }

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
      wristRightCandidates: armLandmarksRight.candidates.map((candidate: any) => candidate.y),
      wristLeftCandidates: armLandmarksLeft.candidates.map((candidate: any) => candidate.y),
      kneeRightY: rows.kneeRight?.row?.y,
      kneeLeftY: rows.kneeLeft?.row?.y,
      ankleRightY: rows.ankleRight?.row?.y,
      ankleLeftY: rows.ankleLeft?.row?.y,
    },
  };
}