import {
  buffersAreEqual,
  quantizedByteToUnit,
  quantizedWordToUnit,
  readUint16BE,
  readUint32BE
} from '../utils/utils';

export interface MSPBoundingBox {
  cx: number;
  cy: number;
  width: number;
  height: number;
  angle: number;
}

export interface MSPDetection {
  object_id: number;
  type: string;
  confidence: number;
  bbox: MSPBoundingBox;
  distance: number; // mm
}

export interface MSPTextOverlay {
  text: string;
  flags: number;
  style: number;
  x: number;
  y: number;
  width: number;
  height: number;
  text_color: number;
  bg_color: number;
}

export interface MSPData {
  pts: number;
  detections: MSPDetection[];
  texts: MSPTextOverlay[];
}

export interface SEIData {
  type: number;
  size: number;
  uuid: Uint8Array;
  user_data: Uint8Array;
  pts?: number;
}

const MSP_VERSION_V1 = 1;
const MSP_UUID_V1 = new Uint8Array([
  0x4D, 0x45, 0x54, 0x41, 0x44, 0x41, 0x54, 0x41,
  0x53, 0x45, 0x49, 0x42, 0x59, 0x43, 0x48, 0x42
]);

const MSP_HEADER_SIZE_V1 = 4;
const MSP_BBOX_ITEM_TYPE = 1;
const MSP_TEXT_ITEM_TYPE = 2;
const MSP_BBOX_FIXED_SIZE = 18;
const MSP_TEXT_FIXED_SIZE = 20;

export class MSPParser {
  private readonly decoder = new TextDecoder();

  parse(data: any): MSPData | null {
    if (data && typeof data === 'object' && 'pts' in data && ('detections' in data || 'texts' in data)) {
      return this.normalizeFrameData(data);
    }

    if (data && typeof data === 'object' && 'uuid' in data && 'user_data' in data) {
      return this.parseFromSEIData(data as SEIData);
    }

    return null;
  }

  private parseFromSEIData(seiData: SEIData): MSPData | null {
    try {
      if (!buffersAreEqual(seiData.uuid, MSP_UUID_V1)) {
        return null;
      }

      const parsed = this.parseMSP_V1(seiData.user_data);
      if (!parsed) {
        return null;
      }

      return {
        pts: seiData.pts || 0,
        detections: parsed.detections,
        texts: parsed.texts
      };
    } catch (error) {
      console.error('MSP parsing error:', error);
      return null;
    }
  }

  private normalizeFrameData(data: any): MSPData | null {
    const detections = Array.isArray(data.detections)
      ? data.detections.map((detection: any) => this.normalizeDetection(detection)).filter(Boolean) as MSPDetection[]
      : [];
    const texts = Array.isArray(data.texts)
      ? data.texts.map((text: any) => this.normalizeTextOverlay(text)).filter(Boolean) as MSPTextOverlay[]
      : [];

    if (detections.length === 0 && texts.length === 0) {
      return null;
    }

    return {
      pts: typeof data.pts === 'number' ? data.pts : 0,
      detections,
      texts
    };
  }

  private parseMSP_V1(payload: Uint8Array): Omit<MSPData, 'pts'> | null {
    if (!payload || payload.byteLength < MSP_HEADER_SIZE_V1) {
      return null;
    }

    const version = payload[0];
    if (version !== MSP_VERSION_V1) {
      console.warn(`Unsupported MSP payload version: ${version}`);
      return null;
    }

    const itemCount = payload[3];

    const detections: MSPDetection[] = [];
    const texts: MSPTextOverlay[] = [];
    let offset = MSP_HEADER_SIZE_V1;

    for (let i = 0; i < itemCount; i++) {
      if (offset + 2 > payload.byteLength) {
        return null;
      }

      const itemType = payload[offset];
      const itemSize = payload[offset + 1];
      const itemOffset = offset + 2;
      const itemEnd = itemOffset + itemSize;

      if (itemEnd > payload.byteLength) {
        return null;
      }

      if (itemType === MSP_BBOX_ITEM_TYPE) {
        const detection = this.parseBBoxItem(payload, itemOffset, itemSize);
        if (!detection) {
          return null;
        }
        detections.push(detection);
      } else if (itemType === MSP_TEXT_ITEM_TYPE) {
        const text = this.parseTextItem(payload, itemOffset, itemSize);
        if (!text) {
          return null;
        }
        texts.push(text);
      }

      offset = itemEnd;
    }

    if (offset !== payload.byteLength) {
      return null;
    }

    if (detections.length === 0 && texts.length === 0) {
      return null;
    }

    return { detections, texts };
  }

  private parseBBoxItem(payload: Uint8Array, offset: number, itemSize: number): MSPDetection | null {
    if (itemSize < MSP_BBOX_FIXED_SIZE) {
      return null;
    }

    const typeLength = payload[offset + 2];
    if (itemSize !== MSP_BBOX_FIXED_SIZE + typeLength) {
      return null;
    }

    const typeStart = offset + MSP_BBOX_FIXED_SIZE;
    const typeEnd = typeStart + typeLength;
    if (typeEnd > payload.byteLength) {
      return null;
    }

    const objectID = readUint16BE(payload, offset);
    const confidenceQ = payload[offset + 3];
    const xQ = readUint16BE(payload, offset + 4);
    const yQ = readUint16BE(payload, offset + 6);
    const wQ = readUint16BE(payload, offset + 8);
    const hQ = readUint16BE(payload, offset + 10);
    const angleQ = readUint16BE(payload, offset + 12);
    const distance = readUint32BE(payload, offset + 14);
    const type = this.decoder.decode(payload.slice(typeStart, typeEnd));

    return {
      object_id: objectID,
      type,
      confidence: quantizedByteToUnit(confidenceQ),
      bbox: {
        cx: quantizedWordToUnit(xQ),
        cy: quantizedWordToUnit(yQ),
        width: quantizedWordToUnit(wQ),
        height: quantizedWordToUnit(hQ),
        angle: this.quantizedWordToDegrees(angleQ)
      },
      distance
    };
  }

  private parseTextItem(payload: Uint8Array, offset: number, itemSize: number): MSPTextOverlay | null {
    if (itemSize < MSP_TEXT_FIXED_SIZE) {
      return null;
    }

    const textLength = payload[offset + 10];
    if (itemSize !== MSP_TEXT_FIXED_SIZE + textLength) {
      return null;
    }

    const textStart = offset + MSP_TEXT_FIXED_SIZE;
    const textEnd = textStart + textLength;
    if (textEnd > payload.byteLength) {
      return null;
    }

    return {
      flags: payload[offset],
      style: payload[offset + 1],
      x: quantizedWordToUnit(readUint16BE(payload, offset + 2)),
      y: quantizedWordToUnit(readUint16BE(payload, offset + 4)),
      width: quantizedWordToUnit(readUint16BE(payload, offset + 6)),
      height: quantizedWordToUnit(readUint16BE(payload, offset + 8)),
      text_color: readUint32BE(payload, offset + 12),
      bg_color: readUint32BE(payload, offset + 16),
      text: this.decoder.decode(payload.slice(textStart, textEnd))
    };
  }

  private normalizeDetection(detection: any): MSPDetection | null {
    if (!detection || typeof detection !== 'object') {
      return null;
    }

    const bbox = detection.bbox || {};
    const cx = this.readNumber(bbox.cx ?? bbox.x);
    const cy = this.readNumber(bbox.cy ?? bbox.y);
    const width = this.readNumber(bbox.width ?? bbox.w);
    const height = this.readNumber(bbox.height ?? bbox.h);

    if (cx === null || cy === null || width === null || height === null) {
      return null;
    }

    return {
      object_id: this.readNumber(detection.object_id ?? detection.id) ?? 0,
      type: typeof detection.type === 'string' ? detection.type : String(detection.type ?? ''),
      confidence: this.readNumber(detection.confidence) ?? 0,
      bbox: {
        cx,
        cy,
        width,
        height,
        angle: this.readNumber(bbox.angle) ?? 0
      },
      distance: this.readNumber(detection.distance) ?? 0
    };
  }

  private normalizeTextOverlay(text: any): MSPTextOverlay | null {
    if (!text || typeof text !== 'object' || typeof text.text !== 'string') {
      return null;
    }

    const x = this.readNumber(text.x);
    const y = this.readNumber(text.y);

    if (x === null || y === null) {
      return null;
    }

    return {
      text: text.text,
      flags: this.readNumber(text.flags) ?? 0,
      style: this.readNumber(text.style) ?? 0,
      x,
      y,
      width: this.readNumber(text.width ?? text.w) ?? 0,
      height: this.readNumber(text.height ?? text.h) ?? 0,
      text_color: this.readNumber(text.text_color ?? text.textColor) ?? 0xFFFFFFFF,
      bg_color: this.readNumber(text.bg_color ?? text.bgColor) ?? 0x00000000
    };
  }

  private readNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  private quantizedWordToDegrees(value: number): number {
    return (value / 65535) * 360;
  }
}
