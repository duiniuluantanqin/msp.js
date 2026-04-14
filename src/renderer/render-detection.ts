import type { MSPDetection } from '../parser/parser';
import type { LabelField, TypeConfig, VideoRect } from './renderer';

type DetectionRendererConfig = {
  boxColor: string | null;
  lineWidth: number;
  labelFields: LabelField[];
  typeConfigs: Record<string, TypeConfig>;
};

type RenderDetectionOptions = {
  ctx: CanvasRenderingContext2D;
  mediaElement: HTMLVideoElement;
  detection: MSPDetection;
  videoRect: VideoRect;
  config: DetectionRendererConfig;
  generateColor: (type: string) => string;
};

export function renderDetection({
  ctx,
  mediaElement,
  detection,
  videoRect,
  config,
  generateColor
}: RenderDetectionOptions): void {
  const typeConfig = config.typeConfigs[detection.type] || {};
  const boxColor = typeConfig.boxColor ?? config.boxColor ?? generateColor(detection.type);
  const lineWidth = typeConfig.lineWidth || config.lineWidth;
  const labelFields = typeConfig.labelFields || config.labelFields;
  const isNormalized = isNormalizedBbox(detection);

  let centerX: number;
  let centerY: number;
  let width: number;
  let height: number;

  if (isNormalized) {
    centerX = videoRect.x + (detection.bbox.cx * videoRect.width);
    centerY = videoRect.y + (detection.bbox.cy * videoRect.height);
    width = detection.bbox.width * videoRect.width;
    height = detection.bbox.height * videoRect.height;
  } else {
    const scaleX = mediaElement.videoWidth ? (videoRect.width / mediaElement.videoWidth) : 0;
    const scaleY = mediaElement.videoHeight ? (videoRect.height / mediaElement.videoHeight) : 0;
    centerX = videoRect.x + (detection.bbox.cx * scaleX);
    centerY = videoRect.y + (detection.bbox.cy * scaleY);
    width = detection.bbox.width * scaleX;
    height = detection.bbox.height * scaleY;
  }

  const x = centerX - (width / 2);
  const y = centerY - (height / 2);
  const angle = normalizeAngle(detection.bbox.angle);

  ctx.save();
  ctx.translate(centerX, centerY);
  ctx.rotate((angle * Math.PI) / 180);
  ctx.strokeStyle = boxColor;
  ctx.lineWidth = lineWidth;
  ctx.strokeRect(-(width / 2), -(height / 2), width, height);
  ctx.restore();

  if (labelFields.length > 0) {
    const label = buildLabel(detection, labelFields);
    drawLabel(ctx, label, x, y, boxColor, videoRect.y);
  }
}

function buildLabel(detection: MSPDetection, fields: LabelField[]): string {
  const parts: string[] = [];

  fields.forEach((field) => {
    switch (field) {
      case 'object_id':
        parts.push(`ID:${detection.object_id}`);
        break;
      case 'type':
        parts.push(detection.type);
        break;
      case 'confidence':
        parts.push(`${detection.confidence.toFixed(2)}`);
        break;
      case 'bbox': {
        const bbox = detection.bbox;
        const normalized = isNormalizedBbox(detection);
        if (normalized) {
          parts.push(
            `${(bbox.cx * 100).toFixed(1)},${(bbox.cy * 100).toFixed(1)},${(bbox.width * 100).toFixed(1)},${(bbox.height * 100).toFixed(1)}%`
          );
        } else {
          parts.push(`${Math.round(bbox.cx)},${Math.round(bbox.cy)},${Math.round(bbox.width)},${Math.round(bbox.height)}`);
        }
        break;
      }
      case 'angle':
        parts.push(`${normalizeAngle(detection.bbox.angle).toFixed(1)}deg`);
        break;
    }
  });

  return parts.join(' ');
}

function drawLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
  minTop: number
): void {
  const padding = 4;
  const fontSize = 12;

  ctx.font = `${fontSize}px Arial`;
  ctx.textBaseline = 'top';

  const textWidth = ctx.measureText(text).width;
  const textHeight = fontSize;
  const labelY = Math.max(minTop, y - textHeight - (padding * 2));

  ctx.fillStyle = color;
  ctx.fillRect(x, labelY, textWidth + (padding * 2), textHeight + (padding * 2));

  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, x + padding, labelY + padding);
}

function isNormalizedBbox(detection: MSPDetection): boolean {
  const { cx, cy, width, height } = detection.bbox;
  return cx <= 1 && cy <= 1 && width <= 1 && height <= 1;
}

function normalizeAngle(angle: number): number {
  const normalized = angle % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}
