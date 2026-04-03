import type { MSPData, MSPDetection, MSPTextOverlay } from '../parser/parser';

export interface TypeConfig {
  boxColor?: string;
  lineWidth?: number;
  labelFields?: Array<'object_id' | 'type' | 'confidence' | 'bbox' | 'angle'>;
}

export interface TextConfig {
  fontFamily?: string;
  fontSize?: number;
  padding?: number;
  textColor?: string;
  backgroundColor?: string | null;
  strokeColor?: string | null;
  lineWidth?: number;
}

export interface OverlayRendererConfig {
  maxDetectionFrames?: number;
  boxColor?: string | null;
  lineWidth?: number;
  labelFields?: Array<'object_id' | 'type' | 'confidence' | 'bbox' | 'angle'>;
  typeConfigs?: Record<string, TypeConfig>;
  textConfig?: TextConfig;
}

type VideoRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export class OverlayRenderer {
  private static readonly DEFAULT_TYPE_COLORS = [
    '#ff4d4f',
    '#fa8c16',
    '#fadb14',
    '#52c41a',
    '#13c2c2',
    '#1677ff',
    '#2f54eb',
    '#722ed1',
    '#eb2f96',
    '#a0d911'
  ];

  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private mediaElement: HTMLVideoElement | null = null;
  private frames: MSPData[] = [];
  private visible = false;
  private animationFrameId: number | null = null;
  private pausedFrame: MSPData | null = null;
  private assignedTypeColors = new Map<string, string>();

  private config: {
    maxDetectionFrames: number;
    boxColor: string | null;
    lineWidth: number;
    labelFields: Array<'object_id' | 'type' | 'confidence' | 'bbox' | 'angle'>;
    typeConfigs: Record<string, TypeConfig>;
    textConfig: Required<Omit<TextConfig, 'backgroundColor' | 'strokeColor'>> & {
      backgroundColor: string | null;
      strokeColor: string | null;
    };
  } = {
    maxDetectionFrames: 100,
    boxColor: null,
    lineWidth: 2,
    labelFields: ['object_id', 'type', 'confidence', 'bbox', 'angle'],
    typeConfigs: {},
    textConfig: {
      fontFamily: 'Arial',
      fontSize: 16,
      padding: 4,
      textColor: '#ffffff',
      backgroundColor: 'rgba(0, 0, 0, 0.6)',
      strokeColor: null,
      lineWidth: 2
    }
  };

  constructor(config?: OverlayRendererConfig) {
    if (config) {
      this.configure(config);
    }
  }

  attachMedia(mediaElement: HTMLVideoElement): void {
    this.detachMedia();

    this.mediaElement = mediaElement;

    this.canvas = document.createElement('canvas');
    this.canvas.style.position = 'absolute';
    this.canvas.style.top = '0';
    this.canvas.style.left = '0';
    this.canvas.style.pointerEvents = 'none';

    this.ctx = this.canvas.getContext('2d');

    if (mediaElement.parentElement) {
      const parent = mediaElement.parentElement;
      if (parent.style.position === '' || parent.style.position === 'static') {
        parent.style.position = 'relative';
      }
      parent.appendChild(this.canvas);
    }

    this.updateCanvasSize();

    mediaElement.addEventListener('loadedmetadata', this.updateCanvasSize);
    mediaElement.addEventListener('pause', this.handlePause);
    mediaElement.addEventListener('play', this.handlePlay);
    mediaElement.addEventListener('seeking', this.handleSeeking);
    window.addEventListener('resize', this.updateCanvasSize);
  }

  detachMedia(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    if (this.mediaElement) {
      this.mediaElement.removeEventListener('loadedmetadata', this.updateCanvasSize);
      this.mediaElement.removeEventListener('pause', this.handlePause);
      this.mediaElement.removeEventListener('play', this.handlePlay);
      this.mediaElement.removeEventListener('seeking', this.handleSeeking);
      window.removeEventListener('resize', this.updateCanvasSize);
      this.mediaElement = null;
    }

    if (this.canvas?.parentElement) {
      this.canvas.parentElement.removeChild(this.canvas);
    }

    this.canvas = null;
    this.ctx = null;
    this.pausedFrame = null;
  }

  private updateCanvasSize = (): void => {
    if (!this.canvas || !this.mediaElement || !this.ctx) return;

    const rect = this.mediaElement.getBoundingClientRect();
    const devicePixelRatio = window.devicePixelRatio || 1;

    this.canvas.width = Math.max(1, Math.round(rect.width * devicePixelRatio));
    this.canvas.height = Math.max(1, Math.round(rect.height * devicePixelRatio));
    this.canvas.style.width = `${rect.width}px`;
    this.canvas.style.height = `${rect.height}px`;
    this.ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  };

  pushFrame(frame: MSPData): void {
    this.frames.push(frame);

    if (this.frames.length > this.config.maxDetectionFrames) {
      this.frames.shift();
    }
  }

  configure(config: OverlayRendererConfig): void {
    if (config.maxDetectionFrames !== undefined) {
      this.config.maxDetectionFrames = config.maxDetectionFrames;
    }
    if (config.boxColor !== undefined) {
      this.config.boxColor = config.boxColor;
    }
    if (config.lineWidth !== undefined) {
      this.config.lineWidth = config.lineWidth;
    }
    if (config.labelFields !== undefined) {
      this.config.labelFields = config.labelFields;
    }
    if (config.typeConfigs !== undefined) {
      this.config.typeConfigs = config.typeConfigs;
    }
    if (config.textConfig !== undefined) {
      this.config.textConfig = {
        ...this.config.textConfig,
        ...config.textConfig
      };
    }
  }

  show(): void {
    this.visible = true;
    this.startRendering();
  }

  hide(): void {
    this.visible = false;
    this.pausedFrame = null;
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    this.clearCanvas();
  }

  clear(): void {
    this.frames = [];
    this.pausedFrame = null;
    this.assignedTypeColors.clear();
    this.clearCanvas();
  }

  private startRendering(): void {
    if (!this.visible || this.animationFrameId !== null) return;

    const render = (): void => {
      this.renderFrame();
      this.animationFrameId = requestAnimationFrame(render);
    };

    render();
  }

  private renderFrame(): void {
    if (!this.ctx || !this.canvas || !this.mediaElement || !this.visible) return;

    this.clearCanvas();

    if (this.mediaElement.paused && !this.pausedFrame) {
      this.pausedFrame = this.findClosestFrame(false);
    }

    const frame = this.findClosestFrame();
    if (!frame) return;

    const videoRect = this.getDisplayedVideoRect();
    frame.detections.forEach((detection) => {
      this.renderDetection(detection, videoRect);
    });
    frame.texts.forEach((textOverlay) => {
      this.renderTextOverlay(textOverlay, videoRect);
    });
  }

  private findClosestFrame(allowPausedFrame: boolean = true): MSPData | null {
    if (this.frames.length === 0) return null;

    if (allowPausedFrame && this.pausedFrame) {
      return this.pausedFrame;
    }

    if (!this.mediaElement) {
      return null;
    }

    const currentTimeMs = this.mediaElement.currentTime * 1000;
    if (!Number.isFinite(currentTimeMs)) {
      return null;
    }

    let closest: MSPData | null = null;
    let minDiff = Number.POSITIVE_INFINITY;

    for (let i = this.frames.length - 1; i >= 0; i--) {
      const frame = this.frames[i];
      const diff = Math.abs(frame.pts - currentTimeMs);

      if (diff < minDiff) {
        minDiff = diff;
        closest = frame;
      }

      const delta = currentTimeMs - frame.pts;
      if (delta >= -50 && delta <= 50) {
        return frame;
      }

      if (delta > 100) {
        break;
      }
    }

    return minDiff <= 100 ? closest : null;
  }

  private renderDetection(detection: MSPDetection, videoRect: VideoRect): void {
    if (!this.ctx || !this.mediaElement) return;

    const typeConfig = this.config.typeConfigs[detection.type] || {};
    const boxColor = typeConfig.boxColor ?? this.config.boxColor ?? this.generateColor(detection.type);
    const lineWidth = typeConfig.lineWidth || this.config.lineWidth;
    const labelFields = typeConfig.labelFields || this.config.labelFields;
    const isNormalized = this.isNormalizedBbox(detection);

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
      const scaleX = this.mediaElement.videoWidth ? (videoRect.width / this.mediaElement.videoWidth) : 0;
      const scaleY = this.mediaElement.videoHeight ? (videoRect.height / this.mediaElement.videoHeight) : 0;
      centerX = videoRect.x + (detection.bbox.cx * scaleX);
      centerY = videoRect.y + (detection.bbox.cy * scaleY);
      width = detection.bbox.width * scaleX;
      height = detection.bbox.height * scaleY;
    }

    const x = centerX - (width / 2);
    const y = centerY - (height / 2);
    const angle = this.normalizeAngle(detection.bbox.angle);

    this.ctx.save();
    this.ctx.translate(centerX, centerY);
    this.ctx.rotate((angle * Math.PI) / 180);
    this.ctx.strokeStyle = boxColor;
    this.ctx.lineWidth = lineWidth;
    this.ctx.strokeRect(-(width / 2), -(height / 2), width, height);
    this.ctx.restore();

    if (labelFields.length > 0) {
      const label = this.buildLabel(detection, labelFields);
      this.drawLabel(label, x, y, boxColor, videoRect.y);
    }
  }

  private renderTextOverlay(textOverlay: MSPTextOverlay, videoRect: VideoRect): void {
    if (!this.ctx || !this.mediaElement) return;

    const ctx = this.ctx;
    const mapped = this.mapTextOverlay(textOverlay, videoRect);
    const config = this.config.textConfig;
    const padding = config.padding;
    const horizontalAlign = textOverlay.flags & 0b11;
    const drawBackground = (textOverlay.flags & 0b100) !== 0;
    const drawStroke = (textOverlay.flags & 0b1000) !== 0;
    const anchorType = (textOverlay.flags >> 4) & 0b11;
    const lines = this.splitTextLines(textOverlay.text);
    const hasExplicitHeight = mapped.height > 0;
    const lineCount = Math.max(lines.length, 1);
    const contentHeight = hasExplicitHeight ? Math.max(0, mapped.height - (padding * 2)) : 0;
    const lineHeight = contentHeight > 0 ? Math.max(12, contentHeight / lineCount) : Math.max(config.fontSize * 1.2, config.fontSize);
    const fontSize = contentHeight > 0 ? Math.max(12, lineHeight / 1.2) : config.fontSize;

    ctx.save();
    ctx.font = `${fontSize}px ${config.fontFamily}`;
    ctx.textBaseline = 'top';

    const measuredWidth = this.measureMaxLineWidth(lines);
    const boxWidth = mapped.width > 0 ? mapped.width : measuredWidth + (padding * 2);
    const boxHeight = mapped.height > 0 ? mapped.height : (lineCount * lineHeight) + (padding * 2);
    const boxPosition = this.resolveTextBoxPosition(anchorType, mapped.x, mapped.y, boxWidth, boxHeight);
    const fillColor = this.colorFromRGBA(textOverlay.text_color, config.textColor);
    const backgroundColor = this.colorFromRGBA(textOverlay.bg_color, config.backgroundColor);
    const strokeColor = config.strokeColor || fillColor;

    ctx.textAlign = this.getCanvasTextAlign(horizontalAlign);

    if (drawBackground && backgroundColor) {
      ctx.fillStyle = backgroundColor;
      ctx.fillRect(boxPosition.x, boxPosition.y, boxWidth, boxHeight);
    }

    const textX = this.resolveTextX(horizontalAlign, boxPosition.x, boxWidth, padding);
    const textY = boxPosition.y + padding;
    const maxWidth = Math.max(0, boxWidth - (padding * 2));

    ctx.fillStyle = fillColor;

    lines.forEach((line, index) => {
      const lineY = textY + (index * lineHeight);

      if (drawStroke && strokeColor) {
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = config.lineWidth;
        ctx.strokeText(line, textX, lineY, maxWidth || undefined);
      }

      ctx.fillText(line, textX, lineY, maxWidth || undefined);
    });

    ctx.restore();
  }

  private splitTextLines(text: string): string[] {
    return text.split(/\r?\n/);
  }

  private measureMaxLineWidth(lines: string[]): number {
    if (!this.ctx || lines.length === 0) {
      return 0;
    }

    return lines.reduce((maxWidth, line) => Math.max(maxWidth, this.ctx!.measureText(line).width), 0);
  }

  private buildLabel(detection: MSPDetection, fields: Array<'object_id' | 'type' | 'confidence' | 'bbox' | 'angle'>): string {
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
          const isNormalized = this.isNormalizedBbox(detection);
          if (isNormalized) {
            parts.push(
              `${(bbox.cx * 100).toFixed(1)},${(bbox.cy * 100).toFixed(1)},${(bbox.width * 100).toFixed(1)},${(bbox.height * 100).toFixed(1)}%`
            );
          } else {
            parts.push(`${Math.round(bbox.cx)},${Math.round(bbox.cy)},${Math.round(bbox.width)},${Math.round(bbox.height)}`);
          }
          break;
        }
        case 'angle':
          parts.push(`${this.normalizeAngle(detection.bbox.angle).toFixed(1)}deg`);
          break;
      }
    });

    return parts.join(' ');
  }

  private drawLabel(text: string, x: number, y: number, color: string, minTop: number): void {
    if (!this.ctx) return;

    const padding = 4;
    const fontSize = 12;

    this.ctx.font = `${fontSize}px Arial`;
    this.ctx.textBaseline = 'top';

    const textWidth = this.ctx.measureText(text).width;
    const textHeight = fontSize;
    const labelY = Math.max(minTop, y - textHeight - (padding * 2));

    this.ctx.fillStyle = color;
    this.ctx.fillRect(x, labelY, textWidth + (padding * 2), textHeight + (padding * 2));

    this.ctx.fillStyle = '#ffffff';
    this.ctx.fillText(text, x + padding, labelY + padding);
  }

  private isNormalizedBbox(detection: MSPDetection): boolean {
    const { cx, cy, width, height } = detection.bbox;
    return cx <= 1 && cy <= 1 && width <= 1 && height <= 1;
  }

  private mapTextOverlay(textOverlay: MSPTextOverlay, videoRect: VideoRect): VideoRect {
    if (!this.mediaElement) {
      return { x: 0, y: 0, width: 0, height: 0 };
    }

    const isNormalized = textOverlay.x <= 1 && textOverlay.y <= 1 && textOverlay.width <= 1 && textOverlay.height <= 1;
    if (isNormalized) {
      return {
        x: videoRect.x + (textOverlay.x * videoRect.width),
        y: videoRect.y + (textOverlay.y * videoRect.height),
        width: textOverlay.width * videoRect.width,
        height: textOverlay.height * videoRect.height
      };
    }

    const scaleX = this.mediaElement.videoWidth ? (videoRect.width / this.mediaElement.videoWidth) : 0;
    const scaleY = this.mediaElement.videoHeight ? (videoRect.height / this.mediaElement.videoHeight) : 0;

    return {
      x: videoRect.x + (textOverlay.x * scaleX),
      y: videoRect.y + (textOverlay.y * scaleY),
      width: textOverlay.width * scaleX,
      height: textOverlay.height * scaleY
    };
  }

  private resolveTextBoxPosition(anchorType: number, x: number, y: number, width: number, height: number): { x: number; y: number } {
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

  private resolveTextX(horizontalAlign: number, x: number, width: number, padding: number): number {
    switch (horizontalAlign) {
      case 1:
        return x + (width / 2);
      case 2:
        return x + width - padding;
      default:
        return x + padding;
    }
  }

  private getCanvasTextAlign(horizontalAlign: number): CanvasTextAlign {
    switch (horizontalAlign) {
      case 1:
        return 'center';
      case 2:
        return 'right';
      default:
        return 'left';
    }
  }

  private colorFromRGBA(value: number, fallback: string | null): string {
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

  private normalizeAngle(angle: number): number {
    const normalized = angle % 360;
    return normalized < 0 ? normalized + 360 : normalized;
  }

  private getDisplayedVideoRect(): VideoRect {
    if (!this.canvas || !this.mediaElement) {
      return { x: 0, y: 0, width: 0, height: 0 };
    }

    const canvasWidth = this.canvas.clientWidth;
    const canvasHeight = this.canvas.clientHeight;
    const videoWidth = this.mediaElement.videoWidth;
    const videoHeight = this.mediaElement.videoHeight;

    if (!canvasWidth || !canvasHeight || !videoWidth || !videoHeight) {
      return { x: 0, y: 0, width: canvasWidth, height: canvasHeight };
    }

    const videoAspectRatio = videoWidth / videoHeight;
    const canvasAspectRatio = canvasWidth / canvasHeight;

    let width = canvasWidth;
    let height = canvasHeight;
    let x = 0;
    let y = 0;

    if (videoAspectRatio > canvasAspectRatio) {
      height = canvasWidth / videoAspectRatio;
      y = (canvasHeight - height) / 2;
    } else {
      width = canvasHeight * videoAspectRatio;
      x = (canvasWidth - width) / 2;
    }

    return { x, y, width, height };
  }

  private handlePause = (): void => {
    this.pausedFrame = this.findClosestFrame(false);
  };

  private handlePlay = (): void => {
    this.pausedFrame = null;
  };

  private handleSeeking = (): void => {
    this.pausedFrame = null;
  };

  private generateColor(type: string): string {
    const assignedColor = this.assignedTypeColors.get(type);

    if (assignedColor) {
      return assignedColor;
    }

    const palette = OverlayRenderer.DEFAULT_TYPE_COLORS;
    const color = palette[this.assignedTypeColors.size % palette.length];
    this.assignedTypeColors.set(type, color);
    return color;
  }

  private clearCanvas(): void {
    if (!this.ctx || !this.canvas) return;
    this.ctx.clearRect(0, 0, this.canvas.clientWidth, this.canvas.clientHeight);
  }
}
