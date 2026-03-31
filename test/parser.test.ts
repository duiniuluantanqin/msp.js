import { describe, it, expect, beforeEach } from 'vitest';
import { MSPParser } from '../src/parser/parser';

describe('MSPParser', () => {
  let parser: MSPParser;

  beforeEach(() => {
    parser = new MSPParser();
  });

  it('should create parser instance', () => {
    expect(parser).toBeDefined();
  });

  it('should parse already formatted data', () => {
    const mockData = {
      pts: 1.5,
      detections: [
        {
          type: 1,
          confidence: 0.95,
          bbox: { x: 0.1, y: 0.1, width: 0.2, height: 0.15 }
        }
      ]
    };

    const result = parser.parse(mockData);
    expect(result).toEqual(mockData);
  });

  it('should return null for invalid data', () => {
    expect(parser.parse(null)).toBeNull();
    expect(parser.parse(undefined)).toBeNull();
    expect(parser.parse({})).toBeNull();
    expect(parser.parse('invalid')).toBeNull();
  });

  it('should parse mpegts.js SEIData format', () => {
    const uuid = new Uint8Array([
      0x4D, 0x45, 0x54, 0x41,
      0x44, 0x41, 0x54, 0x41,
      0x53, 0x45, 0x49, 0x42,
      0x59, 0x43, 0x48, 0x42
    ]);

    // payload: version=1, timestamp=100ms, reserved1=0, reserved2=0, object_count=1
    // obj[0]: id=256, type=1, confidence=240/255≈0.941, cx=16384/65535≈0.25,
    //         cy=16384/65535≈0.25, w=8192/65535≈0.125, h=8192/65535≈0.125, distance=1000000
    const userData = new Uint8Array([
      0x01,                               // version
      0x00, 0x00, 0x00, 0x64,             // timestamp (big-endian)
      0x00,                               // reserved1
      0x00,                               // reserved2
      0x01,                               // object_count
      0x01, 0x00,                         // id = 256
      0x01,                               // type = 1
      0xF0,                               // confidence = 240
      0x40, 0x00,                         // cx = 16384
      0x40, 0x00,                         // cy = 16384
      0x20, 0x00,                         // w = 8192
      0x20, 0x00,                         // h = 8192
      0x00, 0x0F, 0x42, 0x40              // distance = 1000000 (big-endian)
    ]);

    const seiData = {
      type: 5,
      size: uuid.byteLength + userData.byteLength,
      uuid,
      user_data: userData,
      pts: 1.5
    };

    const result = parser.parse(seiData);

    expect(result).not.toBeNull();
    expect(result?.pts).toBe(1.5);
    expect(result?.detections).toHaveLength(1);

    const detection = result?.detections[0];
    expect(detection?.type).toBe(1);
    expect(detection?.confidence).toBeCloseTo(0.941, 2);
    expect(detection?.bbox.cx).toBeCloseTo(0.25, 2);
    expect(detection?.bbox.cy).toBeCloseTo(0.25, 2);
    expect(detection?.bbox.width).toBeCloseTo(0.125, 2);
    expect(detection?.bbox.height).toBeCloseTo(0.125, 2);
  });

  it('should parse multiple detections', () => {
    const uuid = new Uint8Array([
      0x4D, 0x45, 0x54, 0x41,
      0x44, 0x41, 0x54, 0x41,
      0x53, 0x45, 0x49, 0x42,
      0x59, 0x43, 0x48, 0x42
    ]);

    // payload: version=1, timestamp=200ms, reserved1=0, reserved2=0, object_count=2
    // obj[0]: id=256, type=1, confidence=224/255≈0.878, cx=32768/65535≈0.5,
    //         cy=24576/65535≈0.375, w=12288/65535≈0.187, h=16384/65535≈0.25, distance=500000
    // obj[1]: id=512, type=2, confidence=192/255≈0.753, cx=16384/65535≈0.25,
    //         cy=9830/65535≈0.15, w=6144/65535≈0.094, h=8192/65535≈0.125, distance=300000
    const userData = new Uint8Array([
      0x01,                               // version
      0x00, 0x00, 0x00, 0xC8,             // timestamp (big-endian)
      0x00,                               // reserved1
      0x00,                               // reserved2
      0x02,                               // object_count
      0x01, 0x00,                         // id = 256
      0x01,                               // type = 1
      0xE0,                               // confidence = 224
      0x80, 0x00,                         // cx = 32768
      0x60, 0x00,                         // cy = 24576
      0x30, 0x00,                         // w = 12288
      0x40, 0x00,                         // h = 16384
      0x00, 0x07, 0xA1, 0x20,            // distance = 500000 (big-endian)
      0x02, 0x00,                         // id = 512
      0x02,                               // type = 2
      0xC0,                               // confidence = 192
      0x40, 0x00,                         // cx = 16384
      0x26, 0x66,                         // cy = 9830
      0x18, 0x00,                         // w = 6144
      0x20, 0x00,                         // h = 8192
      0x00, 0x04, 0x93, 0xE0             // distance = 300000 (big-endian)
    ]);

    const seiData = {
      type: 5,
      size: uuid.byteLength + userData.byteLength,
      uuid,
      user_data: userData,
      pts: 2.0
    };

    const result = parser.parse(seiData);
    expect(result?.detections).toHaveLength(2);
    expect(result?.detections[0].type).toBe(1);
    expect(result?.detections[1].type).toBe(2);
  });

  it('should return null for wrong UUID', () => {
    const wrongUuid = new Uint8Array(16).fill(0xFF);
    // payload byteLength >= 8 so it passes the length check
    const userData = new Uint8Array([0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);

    const seiData = {
      type: 5,
      size: wrongUuid.byteLength + userData.byteLength,
      uuid: wrongUuid,
      user_data: userData,
      pts: 1.0
    };

    const result = parser.parse(seiData);
    expect(result).toBeNull();
  });

  it('should return null for wrong version', () => {
    const uuid = new Uint8Array([
      0x4D, 0x45, 0x54, 0x41,
      0x44, 0x41, 0x54, 0x41,
      0x53, 0x45, 0x49, 0x42,
      0x59, 0x43, 0x48, 0x42
    ]);

    // version=99 (unsupported), followed by 7 bytes of zeros (total 8)
    const userData = new Uint8Array([0x63, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);

    const seiData = {
      type: 5,
      size: uuid.byteLength + userData.byteLength,
      uuid,
      user_data: userData,
      pts: 1.0
    };

    const result = parser.parse(seiData);
    expect(result).toBeNull();
  });

  it('should handle empty detections', () => {
    const uuid = new Uint8Array([
      0x4D, 0x45, 0x54, 0x41,
      0x44, 0x41, 0x54, 0x41,
      0x53, 0x45, 0x49, 0x42,
      0x59, 0x43, 0x48, 0x42
    ]);

    // version=2, timestamp=0, reserved1=0, reserved2=0, object_count=0
    const userData = new Uint8Array([0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);

    const seiData = {
      type: 5,
      size: uuid.byteLength + userData.byteLength,
      uuid,
      user_data: userData,
      pts: 1.0
    };

    const result = parser.parse(seiData);
    expect(result).toBeNull();
  });
});
