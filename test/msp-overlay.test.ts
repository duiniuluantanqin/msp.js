import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MSPOverlay } from '../src/overlay/msp-overlay';

describe('MSPOverlay', () => {
  let overlay: MSPOverlay;
  let videoElement: HTMLVideoElement;
  let getContextSpy: { mockRestore: () => void };
  let mockContext: CanvasRenderingContext2D & {
    fillText: ReturnType<typeof vi.fn>;
    strokeText: ReturnType<typeof vi.fn>;
    measureText: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    overlay = new MSPOverlay({
      boxColor: '#30d6b0',
      lineWidth: 2,
      labelFields: ['object_id', 'type', 'confidence', 'angle']
    });

    videoElement = document.createElement('video');
    videoElement.width = 640;
    videoElement.height = 480;

    Object.defineProperty(videoElement, 'videoWidth', {
      writable: true,
      value: 640
    });
    Object.defineProperty(videoElement, 'videoHeight', {
      writable: true,
      value: 480
    });

    mockContext = {
      setTransform: vi.fn(),
      clearRect: vi.fn(),
      strokeRect: vi.fn(),
      fillRect: vi.fn(),
      fillText: vi.fn(),
      strokeText: vi.fn(),
      measureText: vi.fn((text: string) => ({ width: text.length * 8 })),
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      font: '',
      textBaseline: 'top',
      textAlign: 'left',
      fillStyle: '#ffffff',
      strokeStyle: '#000000',
      lineWidth: 1
    } as unknown as CanvasRenderingContext2D & {
      fillText: ReturnType<typeof vi.fn>;
      strokeText: ReturnType<typeof vi.fn>;
      measureText: ReturnType<typeof vi.fn>;
    };

    getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(mockContext);

    document.body.appendChild(videoElement);
  });

  afterEach(() => {
    overlay.detachMedia();
    getContextSpy.mockRestore();
    document.body.removeChild(videoElement);
  });

  it('should create overlay instance', () => {
    expect(overlay).toBeDefined();
  });

  it('should attach media element', () => {
    expect(() => overlay.attachMedia(videoElement)).not.toThrow();
  });

  it('should detach media element', () => {
    overlay.attachMedia(videoElement);
    expect(() => overlay.detachMedia()).not.toThrow();
  });

  it('should push MSP data with normalized coordinates', () => {
    overlay.attachMedia(videoElement);

    const mockData = {
      pts: 0,
      detections: [
        {
          object_id: 1,
          type: 'person',
          confidence: 0.95,
          bbox: { cx: 0.1, cy: 0.1, width: 0.2, height: 0.15, angle: 20 },
          distance: 3000
        }
      ],
      texts: [
        {
          text: 'OSD',
          x: 0.2,
          y: 0.2,
          width: 0.12,
          height: 0.05,
          flags: 0b00000100,
          style: 1,
          text_color: 0xFFFFFFFF,
          bg_color: 0x00000099
        }
      ]
    };

    expect(() => overlay.pushData(mockData)).not.toThrow();
  });

  it('should push MSP data with pixel coordinates', () => {
    overlay.attachMedia(videoElement);

    const mockData = {
      pts: 0,
      detections: [
        {
          object_id: 2,
          type: 'vehicle',
          confidence: 0.95,
          bbox: { cx: 200, cy: 175, width: 200, height: 150, angle: 35 },
          distance: 5000
        }
      ],
      texts: [
        {
          text: 'pixel osd',
          x: 100,
          y: 80,
          width: 120,
          height: 30,
          flags: 0,
          style: 0,
          text_color: 0xFFFFFFFF,
          bg_color: 0x00000000
        }
      ]
    };

    expect(() => overlay.pushData(mockData)).not.toThrow();
  });

  it('should configure overlay', () => {
    expect(() => overlay.configure({
      boxColor: '#ff0000',
      lineWidth: 3,
      typeConfigs: {
        person: { boxColor: '#00ff00' }
      },
      textConfig: {
        fontSize: 20,
        backgroundColor: 'rgba(0, 0, 0, 0.8)'
      }
    })).not.toThrow();
  });

  it('should show and hide overlay', () => {
    overlay.attachMedia(videoElement);
    expect(() => overlay.show()).not.toThrow();
    expect(() => overlay.hide()).not.toThrow();
  });

  it('should clear data', () => {
    overlay.attachMedia(videoElement);
    expect(() => overlay.clear()).not.toThrow();
  });

  it('should resolve text anchors using the declared corner point', () => {
    const renderer = (overlay as any).renderer;

    expect(renderer.resolveTextBoxPosition(0, 100, 50, 40, 20)).toEqual({ x: 100, y: 50 });
    expect(renderer.resolveTextBoxPosition(1, 100, 50, 40, 20)).toEqual({ x: 60, y: 50 });
    expect(renderer.resolveTextBoxPosition(2, 100, 50, 40, 20)).toEqual({ x: 100, y: 30 });
    expect(renderer.resolveTextBoxPosition(3, 100, 50, 40, 20)).toEqual({ x: 60, y: 30 });
  });

  it('should render multiline OSD text by splitting on newline', () => {
    overlay.attachMedia(videoElement);

    const renderer = (overlay as any).renderer;

    renderer.renderTextOverlay({
      text: 'line1\nline2',
      x: 20,
      y: 30,
      width: 0,
      height: 0,
      flags: 0,
      style: 0,
      text_color: 0xFFFFFFFF,
      bg_color: 0x00000000
    }, { x: 0, y: 0, width: 640, height: 480 });

    expect(mockContext.fillText).toHaveBeenCalledTimes(2);
    expect(mockContext.fillText).toHaveBeenNthCalledWith(1, 'line1', 24, 34, 40);
    expect(mockContext.fillText).toHaveBeenNthCalledWith(2, 'line2', 24, 53.2, 40);
  });
});
