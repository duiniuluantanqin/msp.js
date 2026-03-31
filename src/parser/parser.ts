import {
  buffersAreEqual,
  quantizedByteToUnit,
  quantizedWordToUnit,
  readUint16BE,
  readUint32BE
} from '../utils/utils';

export interface MSPDetection {
  object_id: number;
  type: number;
  confidence: number;
  bbox: {
    cx: number;
    cy: number;
    width: number;
    height: number;
  };
  distance: number; // mm
}

export interface MSPData {
  pts: number;
  detections: MSPDetection[];
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

export class MSPParser {
  parse(data: any): MSPData | null {
    if (data && typeof data === 'object' && 'pts' in data && 'detections' in data) {
      return data as MSPData;
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

      const detections = this.parseMSP_V1(seiData.user_data);
      if (!detections || detections.length === 0) {
        return null;
      }

      return {
        pts: seiData.pts || 0,
        detections
      };
    } catch (error) {
      console.error('MSP parsing error:', error);
      return null;
    }
  }

  private parseMSP_V1(payload: Uint8Array): MSPDetection[] | null {
    if (!payload || payload.byteLength < 8) {
      return null;
    }

    const version = payload[0];
    if (version !== MSP_VERSION_V1) {
      console.warn(`Unsupported Compact Payload version: ${version}`);
      return null;
    }

    // const timestamp = readUint32BE(payload, 1);
    // const reserved1 = payload[5]; const reserved2 = payload[6];
    const objectCount = payload[7];

    const detections: MSPDetection[] = [];
    let offset = 8;

    for (let i = 0; i < objectCount; i++) {
      const objectID = readUint16BE(payload, offset);
      const objectType = payload[offset + 2];
      const confidenceQ = payload[offset + 3];
      const xQ = readUint16BE(payload, offset + 4);
      const yQ = readUint16BE(payload, offset + 6);
      const wQ = readUint16BE(payload, offset + 8);
      const hQ = readUint16BE(payload, offset + 10);
      const d = readUint32BE(payload, offset + 12);

      detections.push({
        object_id: objectID,
        type: objectType,
        confidence: quantizedByteToUnit(confidenceQ),
        bbox: {
          cx: quantizedWordToUnit(xQ),
          cy: quantizedWordToUnit(yQ),
          width: quantizedWordToUnit(wQ),
          height: quantizedWordToUnit(hQ)
        },
        distance: d
      });

      offset += 16;
    }

    return detections;
  }
}
