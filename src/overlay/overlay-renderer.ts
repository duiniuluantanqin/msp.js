import type { MSPData, MSPDetection } from '../parser/parser';
import { getTypeLabel } from './type-labels';

export interface TypeConfig {
  boxColor?: string;
  lineWidth?: number;
  labelFields?: Array<'object_id' | 'type' | 'confidence' | 'bbox'>;
}

export interface OverlayRendererConfig {
  maxDetectionFrames?: number;
  boxColor?: string | null;
  lineWidth?: number;
  labelFields?: Array<'object_id' | 'type' | 'confidence' | 'bbox'>;
  typeConfigs?: Record<number, TypeConfig>;
}

type VideoRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export class OverlayRenderer {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private mediaElement: HTMLVideoElement | null = null;
  private frames: MSPData[] = [];
  private visible = false;
  private animationFrameId: number | null = null;
  private pausedFrame: MSPData | null = null;

  private config: Required<OverlayRendererConfig> = {
    maxDetectionFrames: 100,
    boxColor: '#30d6b0',
    lineWidth: 2,
    labelFields: ['object_id', 'type', 'confidence', 'bbox'],
    typeConfigs: {
      1: { boxColor: '#ff4d4f' },
      2: { boxColor: '#52c41a' }
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
    const boxColor = typeConfig.boxColor || this.config.boxColor || this.generateColor(detection.type);
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

    this.ctx.strokeStyle = boxColor;
    this.ctx.lineWidth = lineWidth;
    this.ctx.strokeRect(x, y, width, height);

    if (labelFields.length > 0) {
      const label = this.buildLabel(detection, labelFields);
      this.drawLabel(label, x, y, boxColor, videoRect.y);
    }
  }

  private buildLabel(detection: MSPDetection, fields: Array<'object_id' | 'type' | 'confidence' | 'bbox'>): string {
    const parts: string[] = [];

    fields.forEach((field) => {
      switch (field) {
        case 'object_id':
          parts.push(`ID:${detection.object_id}`);
          break;
        case 'type':
          parts.push(getTypeLabel(detection.type));
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

  private generateColor(type: number): string {
    const hue = (type * 137.508) % 360;
    return `hsl(${hue}, 70%, 50%)`;
  }

  private clearCanvas(): void {
    if (!this.ctx || !this.canvas) return;
    this.ctx.clearRect(0, 0, this.canvas.clientWidth, this.canvas.clientHeight);
  }
}
