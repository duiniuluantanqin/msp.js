import {
  buffersAreEqual,
  quantizedByteToUnit,
  quantizedWordToUnit,
  readUint16BE,
  readUint32BE
} from '../utils/utils';

export enum BBoxStyle {
  CornerOnly = 0,
  BorderSolid = 1
}

export interface MOSPBoundingBox {
  cx: number;
  cy: number;
  width: number;
  height: number;
  angle: number;
  style?: BBoxStyle;
  color?: number;
}

export interface MOSPDetection {
  item_id: number;
  item_duration: number; // ms
  object_id: number;
  type: string;
  confidence: number;
  bbox: MOSPBoundingBox;
  distance: number; // mm
}

export interface MOSPTextOverlay {
  item_id: number;
  item_duration: number; // ms
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

export interface MOSPData {
  pts: number;
  detections: MOSPDetection[];
  texts: MOSPTextOverlay[];
}

export interface SEIData {
  type: number;
  size: number;
  uuid: Uint8Array;
  user_data: Uint8Array;
  pts?: number;
}

const MOSP_VERSION_V1 = 1;
const MOSP_UUID_V1 = new Uint8Array([
  0x4D, 0x45, 0x54, 0x41, 0x44, 0x41, 0x54, 0x41,
  0x53, 0x45, 0x49, 0x42, 0x59, 0x43, 0x48, 0x42
]);

const MOSP_HEADER_SIZE_V1 = 4;
const MOSP_ITEM_HEADER_SIZE = 4; // item_id(1) + item_type(1) + item_duration(2)
const MOSP_BBOX_ITEM_TYPE = 1;
const MOSP_TEXT_ITEM_TYPE = 2;
const MOSP_BBOX_FIXED_SIZE = 23;
const MOSP_TEXT_FIXED_SIZE = 20;

export class MOSPParser {
  private readonly decoder = new TextDecoder();

  parse(data: any): MOSPData | null {
    if (data && typeof data === 'object' && 'uuid' in data && 'user_data' in data) {
      return this.parseFromSEIData(data as SEIData);
    }

    return null;
  }

  private parseFromSEIData(seiData: SEIData): MOSPData | null {
    try {
      if (!buffersAreEqual(seiData.uuid, MOSP_UUID_V1)) {
        return null;
      }

      const parsed = this.parseMOSP_V1(seiData.user_data);
      if (!parsed) {
        return null;
      }

      return {
        pts: seiData.pts || 0,
        detections: parsed.detections,
        texts: parsed.texts
      };
    } catch (error) {
      console.error('MOSP parsing error:', error);
      return null;
    }
  }

  private parseMOSP_V1(payload: Uint8Array): Omit<MOSPData, 'pts'> | null {
    if (!payload || payload.byteLength < MOSP_HEADER_SIZE_V1) {
      return null;
    }

    const version = payload[0];
    if (version !== MOSP_VERSION_V1) {
      console.warn(`Unsupported MOSP payload version: ${version}`);
      return null;
    }

    const itemCount = payload[3];

    const detections: MOSPDetection[] = [];
    const texts: MOSPTextOverlay[] = [];
    let offset = MOSP_HEADER_SIZE_V1;

    for (let i = 0; i < itemCount; i++) {
      if (offset + MOSP_ITEM_HEADER_SIZE > payload.byteLength) {
        return null;
      }

      const itemId = payload[offset];
      const itemType = payload[offset + 1];
      const itemDuration = readUint16BE(payload, offset + 2);
      const itemPayloadOffset = offset + MOSP_ITEM_HEADER_SIZE;

      if (itemType === MOSP_BBOX_ITEM_TYPE) {
        if (itemPayloadOffset + MOSP_BBOX_FIXED_SIZE > payload.byteLength) {
          return null;
        }
        const typeLength = payload[itemPayloadOffset + 22]; // UTF-8 byte length
        const detection = this.parseBBoxItem(payload, itemPayloadOffset, itemId, itemDuration);
        if (!detection) {
          return null;
        }
        detections.push(detection);
        offset = itemPayloadOffset + MOSP_BBOX_FIXED_SIZE + typeLength;
      } else if (itemType === MOSP_TEXT_ITEM_TYPE) {
        if (itemPayloadOffset + 11 > payload.byteLength) {
          return null;
        }
        const textLength = payload[itemPayloadOffset + 10]; // UTF-8 byte length
        const text = this.parseTextItem(payload, itemPayloadOffset, itemId, itemDuration);
        if (!text) {
          return null;
        }
        texts.push(text);
        offset = itemPayloadOffset + MOSP_TEXT_FIXED_SIZE + textLength;
      } else {
        // Unknown item type — cannot determine payload length, abort
        return null;
      }
    }

    if (offset !== payload.byteLength) {
      return null;
    }

    if (detections.length === 0 && texts.length === 0) {
      return null;
    }

    return { detections, texts };
  }

  private parseBBoxItem(payload: Uint8Array, offset: number, itemId: number, itemDuration: number): MOSPDetection | null {
    if (offset + MOSP_BBOX_FIXED_SIZE > payload.byteLength) {
      return null;
    }

    const objectID = readUint16BE(payload, offset);
    const confidenceQ = payload[offset + 2];
    const xQ = readUint16BE(payload, offset + 3);
    const yQ = readUint16BE(payload, offset + 5);
    const wQ = readUint16BE(payload, offset + 7);
    const hQ = readUint16BE(payload, offset + 9);
    const angleQ = readUint16BE(payload, offset + 11);
    const distance = readUint32BE(payload, offset + 13);
    const style = payload[offset + 17];
    const color = readUint32BE(payload, offset + 18);
    const typeLength = payload[offset + 22];
    
    const typeStart = offset + MOSP_BBOX_FIXED_SIZE;
    const typeEnd = typeStart + typeLength;

    if (typeEnd > payload.byteLength) {
      return null;
    }

    const type = this.decoder.decode(payload.slice(typeStart, typeEnd));

    return {
      item_id: itemId,
      item_duration: itemDuration,
      object_id: objectID,
      type,
      confidence: quantizedByteToUnit(confidenceQ),
      bbox: {
        cx: quantizedWordToUnit(xQ),
        cy: quantizedWordToUnit(yQ),
        width: quantizedWordToUnit(wQ),
        height: quantizedWordToUnit(hQ),
        angle: this.quantizedWordToDegrees(angleQ),
        style: style,
        color: color
      },
      distance
    };
  }

  private parseTextItem(payload: Uint8Array, offset: number, itemId: number, itemDuration: number): MOSPTextOverlay | null {
    if (offset + MOSP_TEXT_FIXED_SIZE > payload.byteLength) {
      return null;
    }

    const textLength = payload[offset + 10];
    const textStart = offset + MOSP_TEXT_FIXED_SIZE;
    const textEnd = textStart + textLength;

    if (textEnd > payload.byteLength) {
      return null;
    }

    return {
      item_id: itemId,
      item_duration: itemDuration,
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

  private quantizedWordToDegrees(value: number): number {
    return (value / 65535) * 360;
  }
}
