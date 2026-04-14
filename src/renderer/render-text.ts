import type { MSPTextOverlay } from '../parser/parser';
import type { TextConfig, VideoRect } from './renderer';

type ResolvedTextConfig = Required<Omit<TextConfig, 'backgroundColor' | 'strokeColor'>> & {
  backgroundColor: string | null;
  strokeColor: string | null;
};

type RenderTextOverlayOptions = {
  ctx: CanvasRenderingContext2D;
  mediaElement: HTMLVideoElement;
  textOverlay: MSPTextOverlay;
  videoRect: VideoRect;
  textConfig: ResolvedTextConfig;
};

export function renderTextOverlay({
  ctx,
  mediaElement,
  textOverlay,
  videoRect,
  textConfig
}: RenderTextOverlayOptions): void {
  const mapped = mapTextOverlay(mediaElement, textOverlay, videoRect);
  const padding = textConfig.padding;
  const horizontalAlign = textOverlay.flags & 0b11;
  const drawBackground = (textOverlay.flags & 0b100) !== 0;
  const drawStroke = (textOverlay.flags & 0b1000) !== 0;
  const anchorType = (textOverlay.flags >> 4) & 0b11;
  const lines = splitTextLines(textOverlay.text);
  const hasExplicitHeight = mapped.height > 0;
  const lineCount = Math.max(lines.length, 1);
  const contentHeight = hasExplicitHeight ? Math.max(0, mapped.height - (padding * 2)) : 0;
  const lineHeight = contentHeight > 0 ? Math.max(12, contentHeight / lineCount) : Math.max(textConfig.fontSize * 1.2, textConfig.fontSize);
  const fontSize = contentHeight > 0 ? Math.max(12, lineHeight / 1.2) : textConfig.fontSize;

  ctx.save();
  ctx.font = `${fontSize}px ${textConfig.fontFamily}`;
  ctx.textBaseline = 'top';

  const measuredWidth = measureMaxLineWidth(ctx, lines);
  const boxWidth = mapped.width > 0 ? mapped.width : measuredWidth + (padding * 2);
  const boxHeight = mapped.height > 0 ? mapped.height : (lineCount * lineHeight) + (padding * 2);
  const boxPosition = resolveTextBoxPosition(anchorType, mapped.x, mapped.y, boxWidth, boxHeight);
  const fillColor = colorFromRGBA(textOverlay.text_color, textConfig.textColor);
  const backgroundColor = colorFromRGBA(textOverlay.bg_color, textConfig.backgroundColor);
  const strokeColor = textConfig.strokeColor || fillColor;

  ctx.textAlign = getCanvasTextAlign(horizontalAlign);

  if (drawBackground && backgroundColor) {
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(boxPosition.x, boxPosition.y, boxWidth, boxHeight);
  }

  const textX = resolveTextX(horizontalAlign, boxPosition.x, boxWidth, padding);
  const textY = boxPosition.y + padding;
  const maxWidth = Math.max(0, boxWidth - (padding * 2));

  ctx.fillStyle = fillColor;

  lines.forEach((line, index) => {
    const lineY = textY + (index * lineHeight);

    if (drawStroke && strokeColor) {
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = textConfig.lineWidth;
      ctx.strokeText(line, textX, lineY, maxWidth || undefined);
    }

    ctx.fillText(line, textX, lineY, maxWidth || undefined);
  });

  ctx.restore();
}

export function resolveTextBoxPosition(anchorType: number, x: number, y: number, width: number, height: number): { x: number; y: number } {
  switch (anchorType) {
    case 1:
      return { x: x - width, y };
    case 2:
      return { x, y: y - height };
    case 3:
      return { x: x - width, y: y - height };
    default:
      return { x, y };
  }
}

function mapTextOverlay(mediaElement: HTMLVideoElement, textOverlay: MSPTextOverlay, videoRect: VideoRect): VideoRect {
  const isNormalized = textOverlay.x <= 1 && textOverlay.y <= 1 && textOverlay.width <= 1 && textOverlay.height <= 1;
  if (isNormalized) {
    return {
      x: videoRect.x + (textOverlay.x * videoRect.width),
      y: videoRect.y + (textOverlay.y * videoRect.height),
      width: textOverlay.width * videoRect.width,
      height: textOverlay.height * videoRect.height
    };
  }

  const scaleX = mediaElement.videoWidth ? (videoRect.width / mediaElement.videoWidth) : 0;
  const scaleY = mediaElement.videoHeight ? (videoRect.height / mediaElement.videoHeight) : 0;

  return {
    x: videoRect.x + (textOverlay.x * scaleX),
    y: videoRect.y + (textOverlay.y * scaleY),
    width: textOverlay.width * scaleX,
    height: textOverlay.height * scaleY
  };
}

function splitTextLines(text: string): string[] {
  return text.split(/\r?\n/);
}

function measureMaxLineWidth(ctx: CanvasRenderingContext2D, lines: string[]): number {
  if (lines.length === 0) {
    return 0;
  }

  return lines.reduce((maxWidth, line) => Math.max(maxWidth, ctx.measureText(line).width), 0);
}

function resolveTextX(horizontalAlign: number, x: number, width: number, padding: number): number {
  switch (horizontalAlign) {
    case 1:
      return x + (width / 2);
    case 2:
      return x + width - padding;
    default:
      return x + padding;
  }
}

function getCanvasTextAlign(horizontalAlign: number): CanvasTextAlign {
  switch (horizontalAlign) {
    case 1:
      return 'center';
    case 2:
      return 'right';
    default:
      return 'left';
  }
}

function colorFromRGBA(value: number, fallback: string | null): string {
  const normalized = value >>> 0;

  if (normalized === 0 && fallback) {
    return fallback;
  }

  const red = (normalized >>> 24) & 0xFF;
  const green = (normalized >>> 16) & 0xFF;
  const blue = (normalized >>> 8) & 0xFF;
  const alpha = (normalized & 0xFF) / 255;

  return `rgba(${red}, ${green}, ${blue}, ${alpha.toFixed(3)})`;
}
