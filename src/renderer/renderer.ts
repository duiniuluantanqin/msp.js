import type { MSPData, MSPDetection, MSPTextOverlay } from '../parser/parser';
import { renderDetection as renderDetectionImpl } from './render-detection.js';
import { renderTextOverlay as renderTextOverlayImpl, resolveTextBoxPosition as resolveTextBoxPositionImpl } from './render-text.js';

export type LabelField = 'object_id' | 'type' | 'confidence' | 'bbox' | 'angle';

export interface TypeConfig {
  boxColor?: string;
  lineWidth?: number;
  labelFields?: LabelField[];
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

export interface RendererConfig {
  maxDetectionFrames?: number;
  boxColor?: string | null;
  lineWidth?: number;
  labelFields?: LabelField[];
  typeConfigs?: Record<string, TypeConfig>;
  textConfig?: TextConfig;
}

export interface DebugInfo {
  videoCurrentTimeMs: number | null;
  seiPtsMs: number | null;
  diffMs: number | null;
  bufferedFrames: number;
  firstBufferedPtsMs: number | null;
  lastBufferedPtsMs: number | null;
  matchedFrameIndex: number | null;
  paused: boolean;
}

export type VideoRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/**
 * Tracks a single active drawing item (detection or text overlay) with its
 * expiry time derived from item_duration.
 */
interface ActiveItem<T> {
  item: T;
  /** Absolute time (ms, same epoch as pts) when this item expires. */
  expiresAt: number;
}

export class Renderer {
  private static readonly DEFAULT_TYPE_COLORS = [
    '#ff4d4f',
    '#52c41a',
    '#fa8c16',
    '#1677ff',
    '#fadb14',
    '#2f54eb',
    '#13c2c2',
    '#eb2f96',
    '#722ed1',
    '#a0d911'
  ];

  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private mediaElement: HTMLVideoElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private frames: MSPData[] = [];
  private visible = false;
  private animationFrameId: number | null = null;
  private pausedFrame: MSPData | null = null;
  private assignedTypeColors = new Map<string, string>();

  /** Active detections keyed by item_id, supporting item_duration persistence. */
  private activeDetections = new Map<number, ActiveItem<MSPDetection>>();
  /** Active text overlays keyed by item_id, supporting item_duration persistence. */
  private activeTexts = new Map<number, ActiveItem<MSPTextOverlay>>();

  private debugInfo: DebugInfo = {
    videoCurrentTimeMs: null,
    seiPtsMs: null,
    diffMs: null,
    bufferedFrames: 0,
    firstBufferedPtsMs: null,
    lastBufferedPtsMs: null,
    matchedFrameIndex: null,
    paused: false
  };

  private config: {
    maxDetectionFrames: number;
    boxColor: string | null;
    lineWidth: number;
    labelFields: LabelField[];
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

  constructor(config?: RendererConfig) {
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

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => {
        this.updateCanvasSize();
      });
      this.resizeObserver.observe(mediaElement);
    }

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

    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
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
    const parent = this.canvas.parentElement;
    const parentRect = parent?.getBoundingClientRect();
    const devicePixelRatio = window.devicePixelRatio || 1;
    const offsetLeft = parentRect && parent
      ? rect.left - parentRect.left - parent.clientLeft + parent.scrollLeft
      : 0;
    const offsetTop = parentRect && parent
      ? rect.top - parentRect.top - parent.clientTop + parent.scrollTop
      : 0;

    this.canvas.width = Math.max(1, Math.round(rect.width * devicePixelRatio));
    this.canvas.height = Math.max(1, Math.round(rect.height * devicePixelRatio));
    this.canvas.style.left = `${offsetLeft}px`;
    this.canvas.style.top = `${offsetTop}px`;
    this.canvas.style.width = `${rect.width}px`;
    this.canvas.style.height = `${rect.height}px`;
    this.ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  };

  pushFrame(frame: MSPData): void {
    this.frames.push(frame);

    while (this.frames.length > this.config.maxDetectionFrames) {
      this.frames.shift();
    }

    this.debugInfo.bufferedFrames = this.frames.length;
    this.debugInfo.firstBufferedPtsMs = this.frames[0]?.pts ?? null;
    this.debugInfo.lastBufferedPtsMs = this.frames[this.frames.length - 1]?.pts ?? null;
    this.debugInfo.matchedFrameIndex = null;
  }

  configure(config: RendererConfig): void {
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
    this.activeDetections.clear();
    this.activeTexts.clear();
    this.assignedTypeColors.clear();
    this.debugInfo = {
      videoCurrentTimeMs: this.getCurrentTimeMs(),
      seiPtsMs: null,
      diffMs: null,
      bufferedFrames: 0,
      firstBufferedPtsMs: null,
      lastBufferedPtsMs: null,
      matchedFrameIndex: null,
      paused: this.mediaElement?.paused ?? false
    };
    this.clearCanvas();
  }

  getDebugInfo(): DebugInfo {
    const currentTimeMs = this.getCurrentTimeMs();

    return {
      ...this.debugInfo,
      videoCurrentTimeMs: currentTimeMs,
      paused: this.mediaElement?.paused ?? false,
      bufferedFrames: this.frames.length,
      firstBufferedPtsMs: this.frames[0]?.pts ?? null,
      lastBufferedPtsMs: this.frames[this.frames.length - 1]?.pts ?? null,
      matchedFrameIndex: this.debugInfo.matchedFrameIndex
    };
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

    const currentTimeMs = this.getCurrentTimeMs();

    if (this.mediaElement.paused && !this.pausedFrame) {
      this.pausedFrame = this.findClosestFrame(false);
    }

    const frame = this.findClosestFrame();
    this.updateDebugInfo(currentTimeMs, frame);

    // Apply items from the matched frame into the active item maps
    if (frame) {
      this.applyFrameItems(frame);
    }

    // Collect currently visible items (not expired) for rendering
    const renderTimeMs = currentTimeMs ?? 0;
    const visibleDetections = this.collectActiveDetections(renderTimeMs);
    const visibleTexts = this.collectActiveTexts(renderTimeMs);

    if (visibleDetections.length === 0 && visibleTexts.length === 0) return;

    const videoRect = this.getDisplayedVideoRect();
    visibleDetections.forEach((detection) => {
      this.renderDetection(detection, videoRect);
    });
    visibleTexts.forEach((textOverlay) => {
      this.renderTextOverlay(textOverlay, videoRect);
    });
  }

  /**
   * Applies items from a matched frame into the active item maps.
   * Each item's expiry is computed as pts + item_duration.
   * If item_duration === 0, the item expires immediately after the current frame
   * (we set expiresAt = pts so it only renders when currentTime ≈ pts).
   */
  private applyFrameItems(frame: MSPData): void {
    for (const detection of frame.detections) {
      const expiresAt = detection.item_duration > 0
        ? frame.pts + detection.item_duration
        : frame.pts;
      this.activeDetections.set(detection.item_id, { item: detection, expiresAt });
    }

    for (const text of frame.texts) {
      const expiresAt = text.item_duration > 0
        ? frame.pts + text.item_duration
        : frame.pts;
      this.activeTexts.set(text.item_id, { item: text, expiresAt });
    }
  }

  /**
   * Returns detections that are still within their display window at renderTimeMs.
   * Items with item_duration === 0 are only shown when renderTimeMs is within
   * a ±50 ms window of their frame pts.
   */
  private collectActiveDetections(renderTimeMs: number): MSPDetection[] {
    const result: MSPDetection[] = [];
    for (const [, active] of this.activeDetections) {
      const pts = active.item.item_duration === 0
        ? active.expiresAt
        : active.expiresAt - active.item.item_duration;

      if (active.item.item_duration === 0) {
        if (Math.abs(renderTimeMs - pts) <= 50) {
          result.push(active.item);
        }
      } else if (renderTimeMs >= pts - 50 && renderTimeMs <= active.expiresAt) {
        result.push(active.item);
      }
    }
    return result;
  }

  /**
   * Returns text overlays that are still within their display window at renderTimeMs.
   */
  private collectActiveTexts(renderTimeMs: number): MSPTextOverlay[] {
    const result: MSPTextOverlay[] = [];
    for (const [, active] of this.activeTexts) {
      const pts = active.item.item_duration === 0
        ? active.expiresAt
        : active.expiresAt - active.item.item_duration;

      if (active.item.item_duration === 0) {
        if (Math.abs(renderTimeMs - pts) <= 50) {
          result.push(active.item);
        }
      } else if (renderTimeMs >= pts - 50 && renderTimeMs <= active.expiresAt) {
        result.push(active.item);
      }
    }
    return result;
  }

  private updateDebugInfo(currentTimeMs: number | null, frame: MSPData | null): void {
    const matchedFrameIndex = frame ? this.frames.indexOf(frame) : -1;

    this.debugInfo = {
      videoCurrentTimeMs: currentTimeMs,
      seiPtsMs: frame?.pts ?? null,
      diffMs: currentTimeMs !== null && frame ? currentTimeMs - frame.pts : null,
      bufferedFrames: this.frames.length,
      firstBufferedPtsMs: this.frames[0]?.pts ?? null,
      lastBufferedPtsMs: this.frames[this.frames.length - 1]?.pts ?? null,
      matchedFrameIndex: matchedFrameIndex >= 0 ? matchedFrameIndex : null,
      paused: this.mediaElement?.paused ?? false
    };
  }

  private getCurrentTimeMs(): number | null {
    if (!this.mediaElement) {
      return null;
    }

    const currentTimeMs = this.mediaElement.currentTime * 1000;
    return Number.isFinite(currentTimeMs) ? currentTimeMs : null;
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
    renderDetectionImpl({
      ctx: this.ctx,
      mediaElement: this.mediaElement,
      detection,
      videoRect,
      config: this.config,
      generateColor: this.generateColor
    });
  }

  private renderTextOverlay(textOverlay: MSPTextOverlay, videoRect: VideoRect): void {
    if (!this.ctx || !this.mediaElement) return;
    renderTextOverlayImpl({
      ctx: this.ctx,
      mediaElement: this.mediaElement,
      textOverlay,
      videoRect,
      textConfig: this.config.textConfig
    });
  }

  private resolveTextBoxPosition(anchorType: number, x: number, y: number, width: number, height: number): { x: number; y: number } {
    return resolveTextBoxPositionImpl(anchorType, x, y, width, height);
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
    this.updateDebugInfo(this.getCurrentTimeMs(), this.pausedFrame);
  };

  private handlePlay = (): void => {
    this.pausedFrame = null;
    this.updateDebugInfo(this.getCurrentTimeMs(), this.findClosestFrame(false));
  };

  private handleSeeking = (): void => {
    this.pausedFrame = null;
    this.activeDetections.clear();
    this.activeTexts.clear();
    this.updateDebugInfo(this.getCurrentTimeMs(), this.findClosestFrame(false));
  };

  private generateColor = (type: string): string => {
    const assignedColor = this.assignedTypeColors.get(type);

    if (assignedColor) {
      return assignedColor;
    }

    const palette = Renderer.DEFAULT_TYPE_COLORS;
    const color = palette[this.assignedTypeColors.size % palette.length];
    this.assignedTypeColors.set(type, color);
    return color;
  };

  private clearCanvas(): void {
    if (!this.ctx || !this.canvas) return;
    this.ctx.clearRect(0, 0, this.canvas.clientWidth, this.canvas.clientHeight);
  }
}
