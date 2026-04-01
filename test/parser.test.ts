import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MSPParser } from '../src/parser/parser';

const uuid = new Uint8Array([
  0x4D, 0x45, 0x54, 0x41,
  0x44, 0x41, 0x54, 0x41,
  0x53, 0x45, 0x49, 0x42,
  0x59, 0x43, 0x48, 0x42
]);

const encoder = new TextEncoder();

function encodeUnit(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * 65535);
}

function encodeConfidence(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * 255);
}

function encodeAngle(value: number): number {
  const normalized = ((((value % 360) + 360) % 360) / 360);
  return Math.round(normalized * 65535);
}

function uint16Bytes(value: number): number[] {
  return [(value >> 8) & 0xFF, value & 0xFF];
}

function uint32Bytes(value: number): number[] {
  return [
    (value >>> 24) & 0xFF,
    (value >>> 16) & 0xFF,
    (value >>> 8) & 0xFF,
    value & 0xFF
  ];
}

function createBBoxItem(input: {
  id: number;
  type: string;
  confidence: number;
  cx: number;
  cy: number;
  width: number;
  height: number;
  angle: number;
  distance: number;
}): Uint8Array {
  const typeBytes = encoder.encode(input.type);
  const itemSize = 18 + typeBytes.length;

  return new Uint8Array([
    0x01,
    itemSize,
    ...uint16Bytes(input.id),
    typeBytes.length,
    encodeConfidence(input.confidence),
    ...uint16Bytes(encodeUnit(input.cx)),
    ...uint16Bytes(encodeUnit(input.cy)),
    ...uint16Bytes(encodeUnit(input.width)),
    ...uint16Bytes(encodeUnit(input.height)),
    ...uint16Bytes(encodeAngle(input.angle)),
    ...uint32Bytes(input.distance),
    ...typeBytes
  ]);
}

function createTextItem(input: {
  text: string;
  flags: number;
  style: number;
  x: number;
  y: number;
  width: number;
  height: number;
  textColor: number;
  backgroundColor: number;
}): Uint8Array {
  const textBytes = encoder.encode(input.text);
  const itemSize = 20 + textBytes.length;

  return new Uint8Array([
    0x02,
    itemSize,
    input.flags,
    input.style,
    ...uint16Bytes(encodeUnit(input.x)),
    ...uint16Bytes(encodeUnit(input.y)),
    ...uint16Bytes(encodeUnit(input.width)),
    ...uint16Bytes(encodeUnit(input.height)),
    textBytes.length,
    0x00,
    ...uint32Bytes(input.textColor),
    ...uint32Bytes(input.backgroundColor),
    ...textBytes
  ]);
}

function createPayload(items: Uint8Array[]): Uint8Array {
  const totalLength = 4 + items.reduce((length, item) => length + item.byteLength, 0);
  const payload = new Uint8Array(totalLength);

  payload[0] = 0x01;
  payload[1] = 0x00;
  payload[2] = 0x00;
  payload[3] = items.length;

  let offset = 4;
  items.forEach((item) => {
    payload.set(item, offset);
    offset += item.byteLength;
  });

  return payload;
}

describe('MSPParser', () => {
  let parser: MSPParser;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    parser = new MSPParser();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('should create parser instance', () => {
    expect(parser).toBeDefined();
  });

  it('should parse already formatted data', () => {
    const mockData = {
      pts: 1.5,
      detections: [
        {
          object_id: 1,
          type: 'person',
          confidence: 0.95,
          bbox: { cx: 0.1, cy: 0.1, width: 0.2, height: 0.15, angle: 15 },
          distance: 2500
        }
      ],
      texts: [
        {
          text: 'OSD',
          flags: 0,
          style: 1,
          x: 0.2,
          y: 0.2,
          width: 0.1,
          height: 0.05,
          text_color: 0xFFFFFFFF,
          bg_color: 0x00000099
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

  it('should parse SEIData with a rotated bbox item and text item', () => {
    const userData = createPayload([
      createBBoxItem({
        id: 256,
        type: 'person',
        confidence: 240 / 255,
        cx: 0.25,
        cy: 0.25,
        width: 0.125,
        height: 0.125,
        angle: 30,
        distance: 1000000
      }),
      createTextItem({
        text: 'helmet',
        flags: 0b00000100,
        style: 2,
        x: 0.2,
        y: 0.15,
        width: 0.18,
        height: 0.05,
        textColor: 0xFFFFFFFF,
        backgroundColor: 0x00000099
      })
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
    expect(result?.texts).toHaveLength(1);

    const detection = result?.detections[0];
    expect(detection?.type).toBe('person');
    expect(detection?.confidence).toBeCloseTo(0.941, 2);
    expect(detection?.bbox.cx).toBeCloseTo(0.25, 2);
    expect(detection?.bbox.cy).toBeCloseTo(0.25, 2);
    expect(detection?.bbox.width).toBeCloseTo(0.125, 2);
    expect(detection?.bbox.height).toBeCloseTo(0.125, 2);
    expect(detection?.bbox.angle).toBeCloseTo(30, 0);

    const text = result?.texts[0];
    expect(text?.text).toBe('helmet');
    expect(text?.x).toBeCloseTo(0.2, 2);
    expect(text?.width).toBeCloseTo(0.18, 2);
  });

  it('should parse multiple detections', () => {
    const userData = createPayload([
      createBBoxItem({
        id: 256,
        type: 'person',
        confidence: 224 / 255,
        cx: 0.5,
        cy: 0.375,
        width: 0.1875,
        height: 0.25,
        angle: 0,
        distance: 500000
      }),
      createBBoxItem({
        id: 512,
        type: 'vehicle',
        confidence: 192 / 255,
        cx: 0.25,
        cy: 0.15,
        width: 0.094,
        height: 0.125,
        angle: 45,
        distance: 300000
      })
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
    expect(result?.detections[0].type).toBe('person');
    expect(result?.detections[1].type).toBe('vehicle');
  });

  it('should return null for wrong UUID', () => {
    const wrongUuid = new Uint8Array(16).fill(0xFF);
    const userData = new Uint8Array([0x01, 0x00, 0x00, 0x00]);

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
    const userData = new Uint8Array([0x63, 0x00, 0x00, 0x00]);

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

  it('should handle empty items', () => {
    const userData = new Uint8Array([0x01, 0x00, 0x00, 0x00]);

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

  it('should return null for invalid bbox item size', () => {
    const userData = new Uint8Array([
      0x01,
      0x00,
      0x00,
      0x01,
      0x01,
      0x12,
      ...uint16Bytes(1),
      0x04,
      encodeConfidence(0.9),
      ...uint16Bytes(encodeUnit(0.5)),
      ...uint16Bytes(encodeUnit(0.5)),
      ...uint16Bytes(encodeUnit(0.2)),
      ...uint16Bytes(encodeUnit(0.2)),
      ...uint16Bytes(encodeAngle(30)),
      ...uint32Bytes(1000),
      ...encoder.encode('bad')
    ]);

    const result = parser.parse({
      type: 5,
      size: uuid.byteLength + userData.byteLength,
      uuid,
      user_data: userData,
      pts: 1.0
    });

    expect(result).toBeNull();
  });
});
