# msp.js

Metadata over SEI Protocol (MSP) parsing and overlay rendering library for video streams.

## Install

```bash
npm install msp.js
```

## Basic Usage

```ts
import { MSPOverlay } from 'msp.js';

const video = document.getElementById('video') as HTMLVideoElement;

const overlay = new MSPOverlay();
overlay.attachMedia(video);
overlay.show();

overlay.pushData({
  type: 5,
  size: 0,
  uuid: new Uint8Array([
    0x83, 0xA1, 0x61, 0xC4,
    0x31, 0xA7, 0x4B, 0xD8,
    0xA6, 0x93, 0x52, 0x11,
    0x3A, 0x41, 0x10, 0x7E
  ]),
  user_data: new Uint8Array([
    // Compact Payload V2 binary payload
  ]),
  pts: video.currentTime * 1000
});
```

`pushData()` expects raw SEI payload data and parses it into detections internally.

For parsed detections, `bbox.cx` and `bbox.cy` are center coordinates.

## Build

```bash
npm install
npm run build
```

## Demo

Open [`examples/index.html`](examples/index.html) after building.
