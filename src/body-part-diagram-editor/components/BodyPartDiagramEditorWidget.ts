import { widget as Widget } from '$:/core/modules/widgets/widget.js';
import type { IChangedTiddlers } from 'tiddlywiki';
import { buildMetaText, buildUpdatedFields, editableRegionsFromGenerated, loadBodyMapSource } from '../lib/meta.js';
import { generateBodyRegions } from '../lib/generateBodyRegions.js';
import type { EditableBodyRegion } from '../lib/types.js';
import { describeEditorTarget } from '../lib/status.js';

class BodyPartDiagramEditorWidget extends Widget {
  private imageTiddler = '$:/plugins/linonetwo/health-buff-debuff-tracker/img/body.webp';
  private imageBase64 = '';
  private sourceFields: Record<string, unknown> = {};
  private viewBoxWidth = 100;
  private viewBoxHeight = 216;
  private rasterWidth = 700;
  private alphaThreshold = 12;
  private handleSize = 14;
  private regions: EditableBodyRegion[] = [];
  private selectedField = '';
  private debugInfo: Record<string, unknown> | null = null;
  private busy = false;
  private previewImage?: HTMLImageElement;
  private previewSurface?: HTMLDivElement;
  private polygonLayer?: SVGSVGElement;
  private handleLayer?: HTMLDivElement;
  private metaOutputArea?: HTMLTextAreaElement;
  private debugOutputArea?: HTMLPreElement;
  private statusText?: HTMLDivElement;
  private sourceSummary?: HTMLDivElement;
  private regionSelect?: HTMLSelectElement;
  private polygonElements = new Map<string, SVGPolygonElement>();
  private handleElements: HTMLButtonElement[] = [];
  private dragInfo: { field: string; index: number } | null = null;
  private listenersBound = false;
  private readonly onPointerMoveBound = (event: PointerEvent) => this.onPointerMove(event);
  private readonly onPointerUpBound = () => this.onPointerUp();

  execute() {
    this.imageTiddler = this.getAttribute('imageTiddler', this.imageTiddler) ?? this.imageTiddler;
    this.rasterWidth = Number(this.getAttribute('rasterWidth', String(this.rasterWidth)) ?? this.rasterWidth) || this.rasterWidth;
    this.alphaThreshold = Number(this.getAttribute('alphaThreshold', String(this.alphaThreshold)) ?? this.alphaThreshold) || this.alphaThreshold;
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
    root.className = 'body-part-diagram-editor';
    root.setAttribute('style', [
      'display:grid',
      'grid-template-columns:minmax(320px,420px) minmax(320px,1fr)',
      'gap:16px',
      'align-items:start',
      'margin:1em 0',
    ].join(';'));

    const sidebar = doc.createElement('div');
    sidebar.setAttribute('style', [
      'display:flex',
      'flex-direction:column',
      'gap:12px',
      'padding:16px',
      'border:1px solid rgba(0,0,0,0.12)',
      'border-radius:8px',
      'background:#fff',
    ].join(';'));

    const title = doc.createElement('h2');
    title.textContent = 'Body Part Diagram Editor';
    title.setAttribute('style', 'margin:0;font-size:1.2em;');
    sidebar.appendChild(title);

    const intro = doc.createElement('p');
    intro.textContent = 'Generate body-region polygons directly in the browser, then drag points to fine-tune the result before saving it back into the image meta tiddler.';
    intro.setAttribute('style', 'margin:0;line-height:1.5;');
    sidebar.appendChild(intro);

    const sourceSummary = doc.createElement('div') as HTMLDivElement;
    sourceSummary.setAttribute('style', 'font-size:12px;color:#555;line-height:1.5;');
    this.sourceSummary = sourceSummary;
    sidebar.appendChild(sourceSummary);

    const settingsGrid = doc.createElement('div');
    settingsGrid.setAttribute('style', 'display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;');

    const rasterWidthLabel = doc.createElement('label');
    rasterWidthLabel.textContent = 'Raster width';
    rasterWidthLabel.setAttribute('style', 'display:flex;flex-direction:column;gap:4px;font-weight:600;');
    const rasterWidthInput = doc.createElement('input') as HTMLInputElement;
    rasterWidthInput.type = 'number';
    rasterWidthInput.min = '100';
    rasterWidthInput.step = '50';
    rasterWidthInput.value = String(this.rasterWidth);
    rasterWidthInput.addEventListener('change', () => {
      this.rasterWidth = Math.max(100, Number(rasterWidthInput.value) || this.rasterWidth);
      rasterWidthInput.value = String(this.rasterWidth);
    });
    rasterWidthLabel.appendChild(rasterWidthInput);
    settingsGrid.appendChild(rasterWidthLabel);

    const alphaThresholdLabel = doc.createElement('label');
    alphaThresholdLabel.textContent = 'Alpha threshold';
    alphaThresholdLabel.setAttribute('style', 'display:flex;flex-direction:column;gap:4px;font-weight:600;');
    const alphaThresholdInput = doc.createElement('input') as HTMLInputElement;
    alphaThresholdInput.type = 'number';
    alphaThresholdInput.min = '0';
    alphaThresholdInput.max = '255';
    alphaThresholdInput.step = '1';
    alphaThresholdInput.value = String(this.alphaThreshold);
    alphaThresholdInput.addEventListener('change', () => {
      this.alphaThreshold = Math.min(255, Math.max(0, Number(alphaThresholdInput.value) || this.alphaThreshold));
      alphaThresholdInput.value = String(this.alphaThreshold);
    });
    alphaThresholdLabel.appendChild(alphaThresholdInput);
    settingsGrid.appendChild(alphaThresholdLabel);

    sidebar.appendChild(settingsGrid);

    const buttonRow = doc.createElement('div');
    buttonRow.setAttribute('style', 'display:flex;flex-wrap:wrap;gap:8px;');

    const reloadButton = doc.createElement('button') as HTMLButtonElement;
    reloadButton.type = 'button';
    reloadButton.textContent = 'Reload From Wiki';
    reloadButton.addEventListener('click', () => {
      this.loadFromWiki();
      this.debugInfo = null;
      this.refreshDomFromState('Reloaded the source image meta from the wiki.');
    });
    buttonRow.appendChild(reloadButton);

    const generateButton = doc.createElement('button') as HTMLButtonElement;
    generateButton.type = 'button';
    generateButton.textContent = 'Generate Regions';
    generateButton.addEventListener('click', async () => {
      await this.runGeneration();
    });
    buttonRow.appendChild(generateButton);

    const saveButton = doc.createElement('button') as HTMLButtonElement;
    saveButton.type = 'button';
    saveButton.textContent = 'Save To Image Meta';
    saveButton.addEventListener('click', () => {
      this.saveToWiki();
    });
    buttonRow.appendChild(saveButton);

    sidebar.appendChild(buttonRow);

    const selectLabel = doc.createElement('label');
    selectLabel.textContent = 'Selected region';
    selectLabel.setAttribute('style', 'font-weight:600;');
    sidebar.appendChild(selectLabel);

    const select = doc.createElement('select') as HTMLSelectElement;
    select.setAttribute('style', 'padding:6px 8px;');
    select.addEventListener('change', () => {
      this.selectedField = select.value;
      this.refreshSelectionView('Region selected.');
    });
    this.regionSelect = select;
    sidebar.appendChild(select);

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

    const metaLabel = doc.createElement('label');
    metaLabel.textContent = 'Generated meta output';
    metaLabel.setAttribute('style', 'font-weight:600;');
    sidebar.appendChild(metaLabel);

    const metaOutputArea = doc.createElement('textarea') as HTMLTextAreaElement;
    metaOutputArea.readOnly = true;
    metaOutputArea.setAttribute('style', 'width:100%;min-height:260px;font-family:monospace;font-size:12px;');
    this.metaOutputArea = metaOutputArea;
    sidebar.appendChild(metaOutputArea);

    const debugLabel = doc.createElement('label');
    debugLabel.textContent = 'Generation debug';
    debugLabel.setAttribute('style', 'font-weight:600;');
    sidebar.appendChild(debugLabel);

    const debugOutputArea = doc.createElement('pre') as HTMLPreElement;
    debugOutputArea.setAttribute('style', 'margin:0;min-height:96px;padding:12px;border:1px solid rgba(0,0,0,0.08);border-radius:6px;background:#fafafa;overflow:auto;font-size:12px;line-height:1.5;');
    this.debugOutputArea = debugOutputArea;
    sidebar.appendChild(debugOutputArea);

    const statusText = doc.createElement('div') as HTMLDivElement;
    statusText.setAttribute('style', 'font-size:12px;color:#666;');
    this.statusText = statusText;
    sidebar.appendChild(statusText);

    const previewWrapper = doc.createElement('div');
    previewWrapper.setAttribute('style', [
      'display:flex',
      'justify-content:center',
      'padding:16px',
      'border:1px solid rgba(0,0,0,0.12)',
      'border-radius:8px',
      'background:#fff',
    ].join(';'));

    const previewSurface = doc.createElement('div') as HTMLDivElement;
    previewSurface.className = 'body-part-diagram-editor-surface';
    previewSurface.setAttribute('style', 'position:relative;width:100%;max-width:480px;');
    this.previewSurface = previewSurface;

    const img = doc.createElement('img') as unknown as HTMLImageElement;
    img.alt = 'Body part diagram preview';
    img.setAttribute('style', 'display:block;width:100%;height:auto;');
    this.previewImage = img;
    previewSurface.appendChild(img);

    const polygonLayer = doc.createElementNS('http://www.w3.org/2000/svg', 'svg') as unknown as SVGSVGElement;
    polygonLayer.setAttribute('style', 'position:absolute;inset:0;width:100%;height:100%;overflow:visible;');
    polygonLayer.setAttribute('preserveAspectRatio', 'none');
    this.polygonLayer = polygonLayer;
    previewSurface.appendChild(polygonLayer);

    const handleLayer = doc.createElement('div') as HTMLDivElement;
    handleLayer.className = 'body-part-diagram-editor-handle-layer';
    handleLayer.setAttribute('style', 'position:absolute;inset:0;pointer-events:none;');
    this.handleLayer = handleLayer;
    previewSurface.appendChild(handleLayer);

    previewWrapper.appendChild(previewSurface);
    root.appendChild(sidebar);
    root.appendChild(previewWrapper);

    parent.insertBefore(root, nextSibling);
    this.domNodes.push(root);

    this.refreshDomFromState('Ready. Generate regions in-browser, then drag handles to fine-tune the result.');
  }

  refresh(changedTiddlers: IChangedTiddlers) {
    const changedAttributes = this.computeAttributes();
    if ($tw.utils.count(changedAttributes) > 0 || changedTiddlers[this.imageTiddler]) {
      this.refreshSelf();
      return true;
    }
    return false;
  }

  private loadFromWiki() {
    const source = loadBodyMapSource(this.wiki, this.imageTiddler);
    this.sourceFields = source.fields;
    this.imageBase64 = source.imageBase64;
    this.viewBoxWidth = source.viewBoxWidth;
    this.viewBoxHeight = source.viewBoxHeight;
    this.regions = source.regions;
    if (!this.selectedField || !this.regions.some((region) => region.field === this.selectedField)) {
      this.selectedField = this.regions[0]?.field ?? '';
    }
  }

  private refreshDomFromState(status?: string) {
    if (this.previewImage) {
      this.previewImage.src = this.imageBase64 ? `data:image/webp;base64,${this.imageBase64}` : '';
    }
    if (this.polygonLayer) {
      this.polygonLayer.setAttribute('viewBox', `0 0 ${this.viewBoxWidth} ${this.viewBoxHeight}`);
    }
    if (this.sourceSummary) {
      this.sourceSummary.textContent = `${describeEditorTarget(this.imageTiddler)} | ViewBox: 0 0 ${this.viewBoxWidth} ${this.viewBoxHeight} | Regions: ${this.regions.length}`;
    }
    this.renderRegionOptions();
    this.renderPolygons();
    this.renderHandles();
    this.renderMetaOutput();
    this.renderDebugOutput();
    if (status) {
      this.setStatus(status);
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
        this.refreshSelectionView(`${region.name} selected.`);
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
      handle.className = 'body-part-diagram-editor-handle';
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

  private renderMetaOutput() {
    if (!this.metaOutputArea) return;
    this.metaOutputArea.value = buildMetaText(this.sourceFields, this.regions, {
      width: this.viewBoxWidth,
      height: this.viewBoxHeight,
    });
  }

  private renderDebugOutput() {
    if (!this.debugOutputArea) return;
    this.debugOutputArea.textContent = this.debugInfo ? JSON.stringify(this.debugInfo, null, 2) : 'Run generation to inspect the detected landmark rows and candidate positions.';
  }

  private stringifyPoints(points: Array<{ x: number; y: number }>) {
    return points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');
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

  private refreshSelectionView(status?: string) {
    this.renderRegionOptions();
    this.renderHandles();
    this.highlightPolygons();
    this.renderMetaOutput();
    if (status) {
      this.setStatus(status);
    }
  }

  private positionHandle(handle: HTMLButtonElement, point: { x: number; y: number }) {
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
    this.renderMetaOutput();
  }

  private onPointerUp() {
    if (this.dragInfo) {
      this.dragInfo = null;
      this.setStatus('Point updated locally. Save to write it back into the image meta tiddler.');
    }
  }

  private async runGeneration() {
    if (this.busy) return;
    if (!this.imageBase64) {
      this.setStatus('Image tiddler text is empty, so there is no source image to analyze.');
      return;
    }
    if (this.regions.length === 0) {
      this.setStatus('No body-region-* fields were found in the source meta.');
      return;
    }

    this.busy = true;
    this.setStatus('Generating body regions in the browser…');
    try {
      const result = await generateBodyRegions({
        document: this.document as unknown as Document,
        imageBase64: this.imageBase64,
        regions: this.regions.map((region) => ({
          field: region.field,
          data: {
            id: region.id,
            name: region.name,
            points: this.stringifyPoints(region.pointsArray),
          },
        })),
        rasterWidth: this.rasterWidth,
        alphaThreshold: this.alphaThreshold,
        viewBoxWidth: this.viewBoxWidth,
        viewBoxHeight: this.viewBoxHeight,
      });

      this.viewBoxWidth = result.viewBox.width;
      this.viewBoxHeight = result.viewBox.height;
      this.regions = editableRegionsFromGenerated(result.regions);
      this.debugInfo = result.debug;
      if (!this.regions.some((region) => region.field === this.selectedField)) {
        this.selectedField = this.regions[0]?.field ?? '';
      }
      this.refreshDomFromState(`Generated ${result.regions.length} regions in the browser.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown generation error.';
      this.setStatus(`Generation failed: ${message}`);
    } finally {
      this.busy = false;
    }
  }

  private saveToWiki() {
    const imageTiddler = this.wiki.getTiddler(this.imageTiddler);
    if (!imageTiddler) {
      this.setStatus('Image tiddler not found.');
      return;
    }

    const nextFields = buildUpdatedFields(this.sourceFields, this.regions, {
      width: this.viewBoxWidth,
      height: this.viewBoxHeight,
    });

    this.wiki.addTiddler(new $tw.Tiddler(imageTiddler, nextFields));
    this.sourceFields = nextFields;
    this.renderMetaOutput();
    this.setStatus('Saved the generated meta fields back into the image tiddler.');
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
  'body-part-diagram-editor': typeof BodyPartDiagramEditorWidget;
};
exports['body-part-diagram-editor'] = BodyPartDiagramEditorWidget;