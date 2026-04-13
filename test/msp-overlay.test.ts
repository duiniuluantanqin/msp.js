import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MSPOverlay } from '../src/overlay/msp-overlay';

describe('MSPOverlay', () => {
  let overlay: MSPOverlay;
  let videoElement: HTMLVideoElement;
  let getContextSpy: { mockRestore: () => void };
  let originalResizeObserver: typeof ResizeObserver | undefined;
  let resizeObserverCallback: ResizeObserverCallback | null;
  let resizeObserverDisconnect: ReturnType<typeof vi.fn>;
  let mockContext: CanvasRenderingContext2D & {
    fillText: ReturnType<typeof vi.fn>;
    strokeText: ReturnType<typeof vi.fn>;
    measureText: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    resizeObserverCallback = null;
    resizeObserverDisconnect = vi.fn();
    originalResizeObserver = globalThis.ResizeObserver;

    class MockResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resizeObserverCallback = callback;
      }

      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = resizeObserverDisconnect;
    }

    Object.defineProperty(globalThis, 'ResizeObserver', {
      configurable: true,
      writable: true,
      value: MockResizeObserver
    });

    overlay = new MSPOverlay({
      boxColor: '#30d6b0',
      lineWidth: 2,
      labelFields: ['object_id', 'type', 'confidence', 'angle']
    });

    videoElement = document.createElement('video');
    videoElement.width = 640;
    videoElement.height = 480;

    const container = document.createElement('div');
    container.appendChild(videoElement);

    let parentRectLeft = 0;
    let parentRectTop = 0;
    let parentClientLeft = 0;
    let parentClientTop = 0;
    let parentScrollLeft = 0;
    let parentScrollTop = 0;
    vi.spyOn(container, 'getBoundingClientRect').mockImplementation(() => ({
      x: parentRectLeft,
      y: parentRectTop,
      top: parentRectTop,
      left: parentRectLeft,
      right: parentRectLeft + 1000,
      bottom: parentRectTop + 1000,
      width: 1000,
      height: 1000,
      toJSON: () => ({})
    }));

    Object.defineProperty(container, 'clientLeft', {
      configurable: true,
      get: () => parentClientLeft
    });

    Object.defineProperty(container, 'clientTop', {
      configurable: true,
      get: () => parentClientTop
    });

    Object.defineProperty(container, 'scrollLeft', {
      configurable: true,
      get: () => parentScrollLeft
    });

    Object.defineProperty(container, 'scrollTop', {
      configurable: true,
      get: () => parentScrollTop
    });

    Object.defineProperty(videoElement, '__setParentRectPosition', {
      configurable: true,
      value: (
        left: number,
        top: number,
        clientLeft: number = parentClientLeft,
        clientTop: number = parentClientTop,
        scrollLeft: number = parentScrollLeft,
        scrollTop: number = parentScrollTop
      ) => {
        parentRectLeft = left;
        parentRectTop = top;
        parentClientLeft = clientLeft;
        parentClientTop = clientTop;
        parentScrollLeft = scrollLeft;
        parentScrollTop = scrollTop;
      }
    });

    Object.defineProperty(videoElement, 'videoWidth', {
      writable: true,
      value: 640
    });
    Object.defineProperty(videoElement, 'videoHeight', {
      writable: true,
      value: 480
    });

    let rectWidth = 640;
    let rectHeight = 480;
    let rectLeft = 0;
    let rectTop = 0;
    vi.spyOn(videoElement, 'getBoundingClientRect').mockImplementation(() => ({
      x: rectLeft,
      y: rectTop,
      top: rectTop,
      left: rectLeft,
      right: rectLeft + rectWidth,
      bottom: rectTop + rectHeight,
      width: rectWidth,
      height: rectHeight,
      toJSON: () => ({})
    }));

    Object.defineProperty(videoElement, '__setRectSize', {
      configurable: true,
      value: (width: number, height: number, left: number = rectLeft, top: number = rectTop) => {
        rectWidth = width;
        rectHeight = height;
        rectLeft = left;
        rectTop = top;
      }
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

    document.body.appendChild(container);
  });

  afterEach(() => {
    overlay.detachMedia();
    getContextSpy.mockRestore();
    document.body.innerHTML = '';

    if (originalResizeObserver) {
      Object.defineProperty(globalThis, 'ResizeObserver', {
        configurable: true,
        writable: true,
        value: originalResizeObserver
      });
    } else {
      Reflect.deleteProperty(globalThis, 'ResizeObserver');
    }
  });

  it('should create overlay instance', () => {
    expect(overlay).toBeDefined();
  });

  it('should attach media element', () => {
    expect(() => overlay.attachMedia(videoElement)).not.toThrow();
  });

  it('should keep canvas size in sync with the video element', () => {
    overlay.attachMedia(videoElement);

    const canvas = document.body.querySelector('canvas');

    expect(canvas).not.toBeNull();
    expect(canvas?.style.width).toBe('640px');
    expect(canvas?.style.height).toBe('480px');
    expect(canvas?.style.left).toBe('0px');
    expect(canvas?.style.top).toBe('0px');

    (videoElement as HTMLVideoElement & {
      __setRectSize: (width: number, height: number, left?: number, top?: number) => void;
      __setParentRectPosition: (
        left: number,
        top: number,
        clientLeft?: number,
        clientTop?: number,
        scrollLeft?: number,
        scrollTop?: number
      ) => void;
    }).__setParentRectPosition(20, 30, 8, 12, 5, 7);
    (videoElement as HTMLVideoElement & {
      __setRectSize: (width: number, height: number, left?: number, top?: number) => void;
    }).__setRectSize(800, 450, 60, 90);
    resizeObserverCallback?.([], {} as ResizeObserver);

    expect(canvas?.style.width).toBe('800px');
    expect(canvas?.style.height).toBe('450px');
    expect(canvas?.style.left).toBe('37px');
    expect(canvas?.style.top).toBe('55px');
    expect(canvas?.width).toBe(800);
    expect(canvas?.height).toBe(450);
  });

  it('should detach media element', () => {
    overlay.attachMedia(videoElement);
    expect(() => overlay.detachMedia()).not.toThrow();
    expect(resizeObserverDisconnect).toHaveBeenCalled();
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

  it('should assign different default colors to different types', () => {
    const renderer = (overlay as any).renderer;

    const personColor = renderer.generateColor('person');
    const vehicleColor = renderer.generateColor('vehicle');
    const forkliftColor = renderer.generateColor('forklift');

    expect(personColor).toBe('#ff4d4f');
    expect(vehicleColor).toBe('#fa8c16');
    expect(forkliftColor).toBe('#fadb14');
    expect(renderer.generateColor('person')).toBe(personColor);
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
