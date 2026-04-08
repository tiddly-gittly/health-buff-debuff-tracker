import { widget as Widget } from '$:/core/modules/widgets/widget.js';
import type { IChangedTiddlers } from 'tiddlywiki';

interface BodyRegion {
  id: string;
  name: string;
  points: string;
}

class BodyMapWidget extends Widget {
  private editTiddler = '';
  private editField = '';
  private isInteractive = false;
  private valuesOverride: string | undefined;

  execute() {
    this.editTiddler = this.getAttribute('tiddler', this.getVariable('currentTiddler')) ?? '';
    this.editField = this.getAttribute('field', 'body-parts') ?? 'body-parts';
    this.isInteractive = this.getAttribute('interactive', 'false') === 'true';
    this.valuesOverride = this.getAttribute('values');
  }

  render(parent: Element, nextSibling: Element | null) {
    this.parentDomNode = parent;
    this.computeAttributes();
    this.execute();

    const doc = this.document;

    const container = doc.createElement('div');
    container.className = 'health-buff-debuff-body-map-container';
    container.setAttribute('style', 'position:relative;display:inline-block;width:100%;max-width:300px;');

    // Create image element
    const img = doc.createElement('img') as HTMLImageElement;
    const imgTiddler = this.wiki.getTiddler('$:/plugins/linonetwo/health-buff-debuff-tracker/img/body.webp');
    if (imgTiddler?.fields?.text) {
      img.src = `data:image/webp;base64,${imgTiddler.fields.text as string}`;
    }
    img.setAttribute('style', 'width:100%;height:auto;display:block;');
    container.appendChild(img);

    // Create SVG overlay
    const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('style', 'position:absolute;top:0;left:0;width:100%;height:100%;');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('preserveAspectRatio', 'none');

    // Parse regions from the meta field body-regions
    let regions: BodyRegion[] = [];
    if (imgTiddler?.fields?.['body-regions']) {
      try {
        regions = JSON.parse(imgTiddler.fields['body-regions'] as string) as BodyRegion[];
      } catch {
        console.error('Failed to parse body-regions');
      }
    }

    const currentValues = this.getCurrentValues();

    // Create tooltip element
    const tooltip = doc.createElement('div');
    tooltip.className = 'health-buff-debuff-body-map-tooltip';
    tooltip.setAttribute('style', 'position:absolute;background:rgba(0,0,0,0.8);color:#fff;padding:4px 8px;border-radius:4px;font-size:12px;pointer-events:none;display:none;z-index:10;white-space:nowrap;');
    container.appendChild(tooltip);

    for (const region of regions) {
      const polygon = doc.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      polygon.setAttribute('points', region.points);
      polygon.setAttribute('data-region-id', region.id);
      polygon.setAttribute('data-region-name', region.name);

      const isActive = currentValues.includes(region.id);
      polygon.setAttribute('style', [
        `fill:${isActive ? 'rgba(255,80,80,0.45)' : 'rgba(100,100,100,0.08)'}`,
        `stroke:${isActive ? 'rgba(255,0,0,0.8)' : 'rgba(0,0,0,0.2)'}`,
        'stroke-width:0.5',
        `cursor:${this.isInteractive ? 'pointer' : 'default'}`,
        'transition:fill 0.2s',
      ].join(';'));

      // Hover effects
      polygon.addEventListener('mouseenter', () => {
        if (!isActive) {
          polygon.style.fill = 'rgba(255,165,0,0.3)';
        }
        tooltip.textContent = `${region.name} (${region.id})`;
        tooltip.style.display = 'block';
      });
      polygon.addEventListener('mouseleave', () => {
        if (!isActive) {
          polygon.style.fill = 'rgba(100,100,100,0.08)';
        }
        tooltip.style.display = 'none';
      });
      polygon.addEventListener('mousemove', (e: Event) => {
        const mouseEvent = e as MouseEvent;
        const rect = (container as HTMLElement).getBoundingClientRect();
        tooltip.style.left = `${mouseEvent.clientX - rect.left + 10}px`;
        tooltip.style.top = `${mouseEvent.clientY - rect.top - 25}px`;
      });

      if (this.isInteractive) {
        polygon.addEventListener('click', () => {
          this.toggleValue(region.id);
        });
      }

      svg.appendChild(polygon);
    }

    container.appendChild(svg);
    parent.insertBefore(container, nextSibling);
    this.domNodes.push(container);
  }

  refresh(changedTiddlers: IChangedTiddlers) {
    const changedAttributes = this.computeAttributes();
    if ($tw.utils.count(changedAttributes) > 0 ||
        (this.editTiddler && changedTiddlers[this.editTiddler]) ||
        changedTiddlers['$:/plugins/linonetwo/health-buff-debuff-tracker/img/body.webp']) {
      this.refreshSelf();
      return true;
    }
    return false;
  }

  private getCurrentValues(): string[] {
    if (this.valuesOverride !== undefined && this.valuesOverride !== null) {
      return $tw.utils.parseStringArray(this.valuesOverride || '') ?? [];
    }
    const tiddler = this.wiki.getTiddler(this.editTiddler);
    if (!tiddler) return [];
    const fieldValue = tiddler.fields[this.editField];
    if (!fieldValue) return [];
    return $tw.utils.parseStringArray(fieldValue as string) ?? [];
  }

  private toggleValue(id: string) {
    const values = this.getCurrentValues();
    const index = values.indexOf(id);
    if (index > -1) {
      values.splice(index, 1);
    } else {
      values.push(id);
    }
    this.wiki.setText(this.editTiddler, this.editField, undefined, $tw.utils.stringifyList(values));
  }
}

declare let exports: {
  'body-map': typeof BodyMapWidget;
};
exports['body-map'] = BodyMapWidget;
