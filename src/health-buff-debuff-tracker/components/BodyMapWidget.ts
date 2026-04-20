import { widget as Widget } from '$:/core/modules/widgets/widget.js';
import type { IChangedTiddlers } from 'tiddlywiki';

interface BodyRegion {
  field?: string;
  id: string;
  name: string;
  points: string;
}

interface BodyMapConfig {
  imageSrc?: string;
  viewBoxWidth: number;
  viewBoxHeight: number;
  regions: BodyRegion[];
}

function parsePoints(pointsText: string) {
  return pointsText.split(' ').filter(Boolean).map((pair) => {
    const [x, y] = pair.split(',').map(Number);
    return { x, y };
  });
}

function polygonArea(pointsText: string) {
  const points = parsePoints(pointsText);
  if (points.length < 3) return 0;
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    area += current.x * next.y - next.x * current.y;
  }
  return Math.abs(area / 2);
}

function getBodyMapConfig(widget: Widget): BodyMapConfig {
  const imgTiddler = widget.wiki.getTiddler('$:/plugins/linonetwo/health-buff-debuff-tracker/img/body.webp');
  const imageSrc = typeof imgTiddler?.fields?.text === 'string'
    ? `data:image/webp;base64,${imgTiddler.fields.text as string}`
    : undefined;
  const viewBoxWidth = Number(imgTiddler?.fields?.['body-viewbox-width'] ?? '100') || 100;
  const viewBoxHeight = Number(imgTiddler?.fields?.['body-viewbox-height'] ?? '216') || 216;
  const regions: BodyRegion[] = [];

  if (imgTiddler) {
    for (const fieldName in imgTiddler.fields) {
      if (!fieldName.startsWith('body-region-')) continue;
      try {
        const rawField = imgTiddler.fields[fieldName];
        if (typeof rawField !== 'string' || !rawField.trim()) continue;
        const regionData = JSON.parse(rawField);
        if (regionData && regionData.id && regionData.points) {
          regions.push({ ...regionData, field: fieldName });
        }
      } catch (error) {
        console.error(`Failed to parse ${fieldName}`, error);
      }
    }
  }

  regions.sort((left, right) => polygonArea(right.points) - polygonArea(left.points));

  return { imageSrc, viewBoxWidth, viewBoxHeight, regions };
}

class BodyMapWidget extends Widget {
  private editTiddler = '';
  private editField = '';
  private isInteractive = false;
  private isDebug = false;
  private valuesOverride: string | undefined;

  execute() {
    this.editTiddler = this.getAttribute('tiddler', this.getVariable('currentTiddler')) ?? '';
    this.editField = this.getAttribute('field', 'body-parts') ?? 'body-parts';
    this.isInteractive = this.getAttribute('interactive', 'false') === 'true';
    const configDebug = this.wiki.getTiddlerText('$:/plugins/linonetwo/health-buff-debuff-tracker/configs/debug-body-map') === 'yes';
    this.isDebug = this.getAttribute('debug', configDebug ? 'true' : 'false') === 'true';
    this.valuesOverride = this.getAttribute('values');
  }

  render(parent: Element, nextSibling: Element | null) {
    this.parentDomNode = parent;
    this.computeAttributes();
    this.execute();

    const doc = this.document;
    const { imageSrc, regions, viewBoxWidth, viewBoxHeight } = getBodyMapConfig(this);

    const container = doc.createElement('div');
    container.className = 'health-buff-debuff-body-map-container';
    container.setAttribute('style', 'position:relative;display:inline-block;width:100%;max-width:300px;');

    const img = doc.createElement('img') as unknown as HTMLImageElement;
    if (imageSrc) {
      img.src = imageSrc;
    }
    img.setAttribute('style', 'width:100%;height:auto;display:block;');
    container.appendChild(img);

    const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    let svgStyle = 'position:absolute;top:0;left:0;width:100%;height:100%;overflow:visible;';
    if (imageSrc) {
      const maskUrl = `url("${imageSrc}")`;
      svgStyle += `-webkit-mask-image:${maskUrl};mask-image:${maskUrl};-webkit-mask-size:100% 100%;mask-size:100% 100%;`;
    }
    svg.setAttribute('style', svgStyle);
    svg.setAttribute('viewBox', `0 0 ${viewBoxWidth} ${viewBoxHeight}`);
    svg.setAttribute('preserveAspectRatio', 'none');

    const currentValues = this.getCurrentValues();
    const tooltip = doc.createElement('div');
    tooltip.className = 'health-buff-debuff-body-map-tooltip';
    tooltip.setAttribute('style', 'position:absolute;background:rgba(0,0,0,0.8);color:#fff;padding:4px 8px;border-radius:4px;font-size:12px;pointer-events:none;display:none;z-index:10;white-space:nowrap;');
    container.appendChild(tooltip);

    const applyPolygonStyle = (polygon: SVGPolygonElement, isActive: boolean, isHover = false) => {
      polygon.style.fill = isActive
        ? 'rgba(255,80,80,0.45)'
        : (isHover ? 'rgba(255,165,0,0.3)' : (this.isDebug ? 'rgba(100,100,100,0.08)' : 'transparent'));
      polygon.style.stroke = isActive
        ? 'rgba(255,0,0,0.8)'
        : (isHover || this.isDebug ? 'rgba(255,165,0,0.8)' : 'transparent');
      if (!isHover && this.isDebug && !isActive) {
        polygon.style.stroke = 'rgba(0,0,0,0.2)';
      }
      polygon.style.strokeWidth = '0.5';
      polygon.style.cursor = this.isInteractive ? 'pointer' : 'default';
      polygon.style.transition = 'fill 0.2s, stroke 0.2s';
    };

    for (const region of regions) {
      const polygon = doc.createElementNS('http://www.w3.org/2000/svg', 'polygon') as unknown as SVGPolygonElement;
      polygon.setAttribute('class', 'health-buff-debuff-body-map-polygon');
      polygon.setAttribute('points', region.points);
      polygon.setAttribute('data-region-id', region.id);
      polygon.setAttribute('data-region-name', region.name);
      polygon.setAttribute('aria-label', region.name);
      polygon.setAttribute('role', this.isInteractive ? 'button' : 'img');
      polygon.setAttribute('tabindex', this.isInteractive ? '0' : '-1');

      const title = doc.createElementNS('http://www.w3.org/2000/svg', 'title');
      title.textContent = `${region.name} (${region.id})`;
      polygon.appendChild(title);

      const isActive = currentValues.includes(region.id);
      applyPolygonStyle(polygon, isActive, false);

      const showTooltip = () => {
        tooltip.textContent = `${region.name} (${region.id})`;
        tooltip.style.display = 'block';
      };

      polygon.addEventListener('mouseenter', () => {
        applyPolygonStyle(polygon, isActive, !isActive);
        showTooltip();
      });
      polygon.addEventListener('mouseleave', () => {
        applyPolygonStyle(polygon, isActive, false);
        tooltip.style.display = 'none';
      });
      polygon.addEventListener('focus', () => {
        applyPolygonStyle(polygon, isActive, !isActive);
        showTooltip();
      });
      polygon.addEventListener('blur', () => {
        applyPolygonStyle(polygon, isActive, false);
        tooltip.style.display = 'none';
      });
      polygon.addEventListener('mousemove', (event: Event) => {
        const mouseEvent = event as MouseEvent;
        const rect = (container as HTMLElement).getBoundingClientRect();
        tooltip.style.left = `${mouseEvent.clientX - rect.left + 10}px`;
        tooltip.style.top = `${mouseEvent.clientY - rect.top - 25}px`;
      });

      if (this.isInteractive) {
        polygon.addEventListener('click', () => {
          this.toggleValue(region.id);
        });
        polygon.addEventListener('keydown', (event: Event) => {
          const keyboardEvent = event as KeyboardEvent;
          if (keyboardEvent.key === 'Enter' || keyboardEvent.key === ' ') {
            keyboardEvent.preventDefault();
            this.toggleValue(region.id);
          }
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
        changedTiddlers['$:/plugins/linonetwo/health-buff-debuff-tracker/img/body.webp'] ||
        changedTiddlers['$:/plugins/linonetwo/health-buff-debuff-tracker/configs/debug-body-map']) {
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
