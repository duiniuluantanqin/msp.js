export function readUint16BE(data: Uint8Array, offset: number): number {
  return (data[offset] << 8) | data[offset + 1];
}

export function readUint32BE(data: Uint8Array, offset: number): number {
  return (((data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3]) >>> 0);
}

export function quantizedByteToUnit(value: number): number {
  return value / 255;
}

export function quantizedWordToUnit(value: number): number {
  return value / 65535;
}

export function buffersAreEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) {
    return false;
  }

  for (let i = 0; i < a.byteLength; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }

  return true;
}
