import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MSPOverlay } from '../src/overlay/msp-overlay';

describe('MSPOverlay', () => {
  let overlay: MSPOverlay;
  let videoElement: HTMLVideoElement;

  beforeEach(() => {
    overlay = new MSPOverlay({
      boxColor: '#30d6b0',
      lineWidth: 2,
      labelFields: ['object_id', 'type', 'confidence']
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

    document.body.appendChild(videoElement);
  });

  afterEach(() => {
    overlay.detachMedia();
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
          type: 1,
          confidence: 0.95,
          bbox: { x: 0.1, y: 0.1, width: 0.2, height: 0.15 }
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
          type: 1,
          confidence: 0.95,
          bbox: { x: 100, y: 100, width: 200, height: 150 }
        }
      ]
    };

    expect(() => overlay.pushData(mockData)).not.toThrow();
  });

  it('should configure overlay', () => {
    expect(() => overlay.configure({
      boxColor: '#ff0000',
      lineWidth: 3
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
});
