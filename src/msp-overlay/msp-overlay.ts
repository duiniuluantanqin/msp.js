import { MSPParser } from '../parser/parser';
import { DebugInfo, Renderer, RendererConfig } from '../renderer/renderer';

export class MSPOverlay {
  private parser: MSPParser;
  private renderer: Renderer;

  constructor(config?: RendererConfig) {
    this.parser = new MSPParser();
    this.renderer = new Renderer(config);
  }

  attachMedia(mediaElement: HTMLVideoElement): void {
    this.renderer.attachMedia(mediaElement);
  }

  detachMedia(): void {
    this.renderer.detachMedia();
  }

  pushData(data: any): void {
    const frame = this.parser.parse(data);
    if (frame) {
      this.renderer.pushFrame(frame);
    }
  }

  configure(config: RendererConfig): void {
    this.renderer.configure(config);
  }

  show(): void {
    this.renderer.show();
  }

  hide(): void {
    this.renderer.hide();
  }

  clear(): void {
    this.renderer.clear();
  }

  getDebugInfo(): DebugInfo {
    return this.renderer.getDebugInfo();
  }
}
