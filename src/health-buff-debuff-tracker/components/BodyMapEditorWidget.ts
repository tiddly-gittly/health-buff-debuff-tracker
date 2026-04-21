import { widget as Widget } from '$:/core/modules/widgets/widget.js';
import type { IChangedTiddlers } from 'tiddlywiki';

interface BodyMapPoint {
  x: number;
  y: number;
}

interface EditableBodyRegion {
  field: string;
  id: string;
  name: string;
  pointsArray: BodyMapPoint[];
}

class BodyMapEditorWidget extends Widget {
  private imageTiddler = '$:/plugins/linonetwo/health-buff-debuff-tracker/img/body.webp';
  private viewBoxWidth = 100;
  private viewBoxHeight = 216;
  private handleSize = 14;
  private regions: EditableBodyRegion[] = [];
  private selectedField = '';
  private previewSurface?: HTMLDivElement;
  private polygonLayer?: SVGSVGElement;
  private handleLayer?: HTMLDivElement;
  private outputArea?: HTMLTextAreaElement;
  private statusText?: HTMLDivElement;
  private regionSelect?: HTMLSelectElement;
  private polygonElements = new Map<string, SVGPolygonElement>();
  private handleElements: HTMLButtonElement[] = [];
  private exportMode: 'selected' | 'all' = 'all';
  private dragInfo: { field: string; index: number } | null = null;
  private listenersBound = false;
  private readonly onPointerMoveBound = (event: PointerEvent) => this.onPointerMove(event);
  private readonly onPointerUpBound = () => this.onPointerUp();

  execute() {
    this.imageTiddler = this.getAttribute('imageTiddler', this.imageTiddler) ?? this.imageTiddler;
  }

  render(parent: Element, nextSibling: Element | null) {
    this.parentDomNode = parent;
    this.computeAttributes();
    this.execute();
    this.loadFromWiki();

    const doc = this.document as unknown as Document;
    if (!this.listenersBound) {
      doc.addEventListener('pointermove', this.onPointerMoveBound);
      doc.addEventListener('pointerup', this.onPointerUpBound);
      this.listenersBound = true;
    }

    const root = doc.createElement('div');
    root.className = 'health-buff-debuff-body-map-editor';
    root.setAttribute('style', [
      'display:grid',
      'grid-template-columns:minmax(260px,320px) minmax(280px,1fr)',
      'gap:16px',
      'align-items:start',
      'margin:1em 0',
    ].join(';'));

    const sidebar = doc.createElement('div');
    sidebar.setAttribute('style', 'display:flex;flex-direction:column;gap:12px;');

    const intro = doc.createElement('div');
    intro.setAttribute('style', 'font-size:0.95em;line-height:1.45;');
    intro.textContent = 'Drag the numbered points to fine-tune a region. Nothing is written back while dragging, so the editor stays stable until you choose to save.';
    sidebar.appendChild(intro);

    const selectLabel = doc.createElement('label');
    selectLabel.textContent = 'Selected region';
    selectLabel.setAttribute('style', 'font-weight:600;');
    sidebar.appendChild(selectLabel);

    const select = doc.createElement('select') as HTMLSelectElement;
    select.setAttribute('style', 'padding:6px 8px;');
    for (const region of this.regions) {
      const option = doc.createElement('option') as HTMLOptionElement;
      option.value = region.field;
      option.textContent = `${region.name} (${region.id})`;
      option.selected = region.field === this.selectedField;
      select.appendChild(option);
    }
    select.addEventListener('change', () => {
      this.selectedField = select.value;
      this.refreshSelectionView('selected');
      this.setStatus('Region selected.');
    });
    this.regionSelect = select;
    sidebar.appendChild(select);

    const buttonRow = doc.createElement('div');
    buttonRow.setAttribute('style', 'display:flex;flex-wrap:wrap;gap:8px;');

    const showSelectedButton = doc.createElement('button') as HTMLButtonElement;
    showSelectedButton.type = 'button';
    showSelectedButton.textContent = 'Export Selected';
    showSelectedButton.addEventListener('click', () => {
      this.renderOutput('selected');
      this.setStatus('Showing the selected region export.');
    });
    buttonRow.appendChild(showSelectedButton);

    const showAllButton = doc.createElement('button') as HTMLButtonElement;
    showAllButton.type = 'button';
    showAllButton.textContent = 'Export All';
    showAllButton.addEventListener('click', () => {
      this.renderOutput('all');
      this.setStatus('Showing the full meta export.');
    });
    buttonRow.appendChild(showAllButton);

    const saveButton = doc.createElement('button') as HTMLButtonElement;
    saveButton.type = 'button';
    saveButton.textContent = 'Save to Image Meta';
    saveButton.addEventListener('click', () => {
      this.saveToWiki();
    });
    buttonRow.appendChild(saveButton);

    sidebar.appendChild(buttonRow);

    const sizeRow = doc.createElement('div');
    sizeRow.setAttribute('style', 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;');

    const sizeLabel = doc.createElement('label');
    sizeLabel.textContent = 'Point size';
    sizeLabel.setAttribute('style', 'font-weight:600;');
    sizeRow.appendChild(sizeLabel);

    const decreaseSizeButton = doc.createElement('button') as HTMLButtonElement;
    decreaseSizeButton.type = 'button';
    decreaseSizeButton.textContent = 'Smaller';
    decreaseSizeButton.addEventListener('click', () => {
      this.updateHandleSize(this.handleSize - 2);
    });
    sizeRow.appendChild(decreaseSizeButton);

    const increaseSizeButton = doc.createElement('button') as HTMLButtonElement;
    increaseSizeButton.type = 'button';
    increaseSizeButton.textContent = 'Larger';
    increaseSizeButton.addEventListener('click', () => {
      this.updateHandleSize(this.handleSize + 2);
    });
    sizeRow.appendChild(increaseSizeButton);

    const sizeValue = doc.createElement('span');
    sizeValue.textContent = `${this.handleSize}px`;
    sizeValue.setAttribute('style', 'font-size:12px;color:#666;min-width:40px;');
    sizeRow.appendChild(sizeValue);

    const sizeSlider = doc.createElement('input') as HTMLInputElement;
    sizeSlider.type = 'range';
    sizeSlider.min = '10';
    sizeSlider.max = '28';
    sizeSlider.step = '2';
    sizeSlider.value = String(this.handleSize);
    sizeSlider.addEventListener('input', () => {
      sizeValue.textContent = `${sizeSlider.value}px`;
      this.updateHandleSize(Number(sizeSlider.value));
    });
    sizeRow.appendChild(sizeSlider);

    sidebar.appendChild(sizeRow);

    const outputArea = doc.createElement('textarea') as HTMLTextAreaElement;
    outputArea.readOnly = false;
    outputArea.setAttribute('style', 'width:100%;min-height:240px;font-family:monospace;font-size:12px;');
    outputArea.addEventListener('input', () => {
      this.applyOutputText(outputArea.value);
    });
    this.outputArea = outputArea;
    sidebar.appendChild(outputArea);

    const statusText = doc.createElement('div') as HTMLDivElement;
    statusText.setAttribute('style', 'font-size:12px;color:#666;');
    this.statusText = statusText;
    sidebar.appendChild(statusText);

    const previewWrapper = doc.createElement('div');
    previewWrapper.setAttribute('style', 'display:flex;justify-content:center;');

    const previewSurface = doc.createElement('div') as HTMLDivElement;
    previewSurface.className = 'health-buff-debuff-body-map-editor-surface';
    previewSurface.setAttribute('style', 'position:relative;width:100%;max-width:420px;');
    this.previewSurface = previewSurface;

    const imageTiddler = this.wiki.getTiddler(this.imageTiddler);
    const img = doc.createElement('img') as unknown as HTMLImageElement;
    if (typeof imageTiddler?.fields?.text === 'string') {
      img.src = `data:image/webp;base64,${imageTiddler.fields.text as string}`;
    }
    img.alt = 'Body map preview';
    img.setAttribute('style', 'display:block;width:100%;height:auto;');
    previewSurface.appendChild(img);

    const polygonLayer = doc.createElementNS('http://www.w3.org/2000/svg', 'svg') as unknown as SVGSVGElement;
    polygonLayer.setAttribute('style', 'position:absolute;inset:0;width:100%;height:100%;overflow:visible;');
    polygonLayer.setAttribute('viewBox', `0 0 ${this.viewBoxWidth} ${this.viewBoxHeight}`);
    polygonLayer.setAttribute('preserveAspectRatio', 'none');
    this.polygonLayer = polygonLayer;
    previewSurface.appendChild(polygonLayer);

    const handleLayer = doc.createElement('div') as HTMLDivElement;
    handleLayer.className = 'health-buff-debuff-body-map-editor-handle-layer';
    handleLayer.setAttribute('style', 'position:absolute;inset:0;pointer-events:none;');
    this.handleLayer = handleLayer;
    previewSurface.appendChild(handleLayer);

    previewWrapper.appendChild(previewSurface);
    root.appendChild(sidebar);
    root.appendChild(previewWrapper);

    parent.insertBefore(root, nextSibling);
    this.domNodes.push(root);

    this.renderPolygons();
    this.renderHandles();
    this.renderOutput('all');
    this.setStatus('Ready. Drag a handle to fine-tune the selected region.');
  }

  refresh(changedTiddlers: IChangedTiddlers) {
    if (this.dragInfo) return false;
    const changedAttributes = this.computeAttributes();
    if ($tw.utils.count(changedAttributes) > 0 || changedTiddlers[this.imageTiddler]) {
      this.refreshSelf();
      return true;
    }
    return false;
  }

  private loadFromWiki() {
    const imageTiddler = this.wiki.getTiddler(this.imageTiddler);
    this.viewBoxWidth = Number(imageTiddler?.fields?.['body-viewbox-width'] ?? '100') || 100;
    this.viewBoxHeight = Number(imageTiddler?.fields?.['body-viewbox-height'] ?? '216') || 216;

    const regions: EditableBodyRegion[] = [];
    if (imageTiddler) {
      for (const fieldName in imageTiddler.fields) {
        if (!fieldName.startsWith('body-region-')) continue;
        const rawField = imageTiddler.fields[fieldName];
        if (typeof rawField !== 'string' || !rawField.trim()) continue;
        try {
          const parsed = JSON.parse(rawField) as { id: string; name: string; points?: string };
          if (!parsed.id || !parsed.name || typeof parsed.points !== 'string') continue;
          regions.push({
            field: fieldName,
            id: parsed.id,
            name: parsed.name,
            pointsArray: this.parsePoints(parsed.points),
          });
        } catch (error) {
          console.error(`Failed to parse ${fieldName}`, error);
        }
      }
    }

    regions.sort((left, right) => left.name.localeCompare(right.name));
    this.regions = regions;
    if (!this.selectedField || !this.regions.some((region) => region.field === this.selectedField)) {
      this.selectedField = this.regions[0]?.field ?? '';
    }
  }

  private parsePoints(pointsText: string) {
    if (!pointsText.trim()) return [];
    return pointsText.split(' ').filter(Boolean).map((pair) => {
      const [x, y] = pair.split(',').map(Number);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        throw new Error(`Invalid point pair: ${pair}`);
      }
      return { x, y };
    });
  }

  private stringifyPoints(points: BodyMapPoint[]) {
    return points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');
  }

  private getSelectedRegion() {
    return this.regions.find((region) => region.field === this.selectedField);
  }

  private renderPolygons() {
    if (!this.polygonLayer) return;
    this.polygonLayer.replaceChildren();
    this.polygonElements.clear();

    for (const region of this.regions) {
      const polygon = this.document.createElementNS('http://www.w3.org/2000/svg', 'polygon') as unknown as SVGPolygonElement;
      polygon.setAttribute('points', this.stringifyPoints(region.pointsArray));
      polygon.setAttribute('data-region-field', region.field);
      polygon.setAttribute('data-region-name', region.name);
      polygon.setAttribute('style', 'fill:transparent;stroke:rgba(255,255,255,0.45);stroke-width:0.6;cursor:pointer;');
      polygon.addEventListener('click', () => {
        this.selectedField = region.field;
        this.refreshSelectionView('selected');
        this.setStatus(`${region.name} selected.`);
      });
      this.polygonLayer.appendChild(polygon);
      this.polygonElements.set(region.field, polygon);
    }

    this.highlightPolygons();
  }

  private highlightPolygons() {
    for (const region of this.regions) {
      const polygon = this.polygonElements.get(region.field);
      if (!polygon) continue;
      const isSelected = region.field === this.selectedField;
      polygon.style.fill = isSelected ? 'rgba(255,80,80,0.28)' : 'transparent';
      polygon.style.stroke = isSelected ? 'rgba(255,0,0,0.9)' : 'rgba(255,255,255,0.45)';
      polygon.style.strokeWidth = isSelected ? '1.1' : '0.6';
    }
  }

  private renderHandles() {
    if (!this.handleLayer) return;
    this.handleLayer.replaceChildren();
    this.handleElements = [];

    const selectedRegion = this.getSelectedRegion();
    if (!selectedRegion) return;

    selectedRegion.pointsArray.forEach((point, index) => {
      const handle = this.document.createElement('button') as unknown as HTMLButtonElement;
      handle.type = 'button';
      handle.className = 'health-buff-debuff-body-map-editor-handle';
      handle.textContent = String(index + 1);
      handle.setAttribute('aria-label', `${selectedRegion.name} point ${index + 1}`);
      handle.setAttribute('style', this.buildHandleStyle());
      this.positionHandle(handle, point);
      handle.addEventListener('pointerdown', (event) => {
        this.startDrag(selectedRegion.field, index, event);
      });
      this.handleLayer?.appendChild(handle);
      this.handleElements.push(handle);
    });
  }

  private positionHandle(handle: HTMLButtonElement, point: BodyMapPoint) {
    const offset = this.handleSize / 2;
    handle.style.left = `calc(${(point.x / this.viewBoxWidth) * 100}% - ${offset}px)`;
    handle.style.top = `calc(${(point.y / this.viewBoxHeight) * 100}% - ${offset}px)`;
  }

  private startDrag(field: string, index: number, event: PointerEvent) {
    this.dragInfo = { field, index };
    event.preventDefault();
    event.stopPropagation();
    (event.currentTarget as HTMLElement | null)?.setPointerCapture?.(event.pointerId);
    this.setStatus('Dragging…');
  }

  private onPointerMove(event: PointerEvent) {
    if (!this.dragInfo || !this.previewSurface) return;
    const region = this.regions.find((item) => item.field === this.dragInfo?.field);
    if (!region) return;

    const rect = this.previewSurface.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const x = this.clamp(((event.clientX - rect.left) / rect.width) * this.viewBoxWidth, 0, this.viewBoxWidth);
    const y = this.clamp(((event.clientY - rect.top) / rect.height) * this.viewBoxHeight, 0, this.viewBoxHeight);
    const point = { x: Number(x.toFixed(1)), y: Number(y.toFixed(1)) };
    region.pointsArray[this.dragInfo.index] = point;

    this.polygonElements.get(region.field)?.setAttribute('points', this.stringifyPoints(region.pointsArray));
    const handle = this.handleElements[this.dragInfo.index];
    if (handle) this.positionHandle(handle, point);
    this.renderOutput(this.exportMode);
  }

  private onPointerUp() {
    if (this.dragInfo) {
      this.dragInfo = null;
      this.setStatus('Point updated locally. Save when ready.');
    }
  }

  private renderOutput(mode: 'selected' | 'all') {
    this.exportMode = mode;
    if (!this.outputArea) return;
    this.outputArea.value = this.buildExportText(mode);
  }

  private buildHandleStyle() {
    const fontSize = Math.max(9, Math.round(this.handleSize * 0.5));
    const lineHeight = Math.max(this.handleSize - 2, 10);
    return [
      'position:absolute',
      `width:${this.handleSize}px`,
      `height:${this.handleSize}px`,
      'border-radius:999px',
      'border:1px solid #fff',
      'background:#c62828',
      'color:#fff',
      `font-size:${fontSize}px`,
      `line-height:${lineHeight}px`,
      'padding:0',
      'text-align:center',
      'cursor:grab',
      'pointer-events:auto',
      'user-select:none',
      'touch-action:none',
      'box-shadow:0 1px 4px rgba(0,0,0,0.35)',
    ].join(';');
  }

  private updateHandleSize(size: number) {
    const nextSize = this.clamp(Math.round(size), 10, 28);
    if (nextSize === this.handleSize) return;
    this.handleSize = nextSize;
    this.renderHandles();
    this.setStatus(`Point size set to ${this.handleSize}px.`);
  }

  private refreshSelectionView(mode: 'selected' | 'all' = this.exportMode) {
    this.renderRegionOptions();
    this.renderHandles();
    this.highlightPolygons();
    this.renderOutput(mode);
  }

  private applyOutputText(text: string) {
    try {
      const updates = this.parseExportText(text);
      for (const update of updates) {
        const region = this.regions.find((item) => item.field === update.field);
        if (!region) {
          throw new Error(`Unknown region field: ${update.field}`);
        }
        region.id = update.id;
        region.name = update.name;
        region.pointsArray = update.pointsArray;
      }

      const selectedStillExists = this.regions.some((region) => region.field === this.selectedField);
      if (!selectedStillExists) {
        this.selectedField = this.regions[0]?.field ?? '';
      }

      this.renderPolygons();
      this.renderRegionOptions();
      this.renderHandles();
      this.highlightPolygons();
      this.setStatus('Text changes synced to points.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to parse editor text.';
      this.setStatus(`Text not applied: ${message}`);
    }
  }

  private renderRegionOptions() {
    if (!this.regionSelect) return;
    this.regionSelect.replaceChildren();
    for (const region of this.regions) {
      const option = this.document.createElement('option') as unknown as HTMLOptionElement;
      option.value = region.field;
      option.textContent = `${region.name} (${region.id})`;
      option.selected = region.field === this.selectedField;
      this.regionSelect.appendChild(option);
    }
    this.regionSelect.value = this.selectedField;
  }

  private parseExportText(text: string) {
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (!lines.length) {
      throw new Error('Editor text is empty.');
    }

    const updates: Array<{ field: string; id: string; name: string; pointsArray: BodyMapPoint[] }> = [];
    for (const line of lines) {
      const separatorIndex = line.indexOf(':');
      if (separatorIndex <= 0) {
        throw new Error(`Invalid export line: ${line}`);
      }

      const field = line.slice(0, separatorIndex).trim();
      const rawJson = line.slice(separatorIndex + 1).trim();
      const parsed = JSON.parse(rawJson) as { id?: string; name?: string; points?: string };
      if (!parsed.id || !parsed.name || typeof parsed.points !== 'string') {
        throw new Error(`Invalid region payload for ${field}`);
      }

      updates.push({
        field,
        id: parsed.id,
        name: parsed.name,
        pointsArray: this.parsePoints(parsed.points),
      });
    }

    if (this.exportMode === 'selected' && updates.length !== 1) {
      throw new Error('Selected export mode expects exactly one region line.');
    }

    return updates;
  }

  private buildExportText(mode: 'selected' | 'all') {
    const selectedRegion = this.getSelectedRegion();
    const regions = mode === 'selected' ? (selectedRegion ? [selectedRegion] : []) : this.regions;
    return regions.map((region) => `${region.field}: ${JSON.stringify({
      id: region.id,
      name: region.name,
      points: this.stringifyPoints(region.pointsArray),
    })}`).join('\n');
  }

  private saveToWiki() {
    const imageTiddler = this.wiki.getTiddler(this.imageTiddler);
    if (!imageTiddler) {
      this.setStatus('Image tiddler not found.');
      return;
    }

    const nextFields: Record<string, unknown> = { ...imageTiddler.fields };
    nextFields['body-viewbox-width'] = String(this.viewBoxWidth);
    nextFields['body-viewbox-height'] = String(this.viewBoxHeight);

    for (const region of this.regions) {
      nextFields[region.field] = JSON.stringify({
        id: region.id,
        name: region.name,
        points: this.stringifyPoints(region.pointsArray),
      });
    }

    this.wiki.addTiddler(new $tw.Tiddler(imageTiddler, nextFields));
    this.setStatus('Saved to the image meta tiddler.');
  }

  private setStatus(text: string) {
    if (this.statusText) {
      this.statusText.textContent = text;
    }
  }

  private clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
  }
}

declare let exports: {
  'body-map-editor': typeof BodyMapEditorWidget;
};
exports['body-map-editor'] = BodyMapEditorWidget;
