export interface ComponentData {
  count: number;
  reasons: string[];
}

export interface RenderInspectorWindow {
  version: string;
  page: string;
  startTime: number;
  threshold: number;
  components: Record<string, ComponentData>;
}

declare global {
  interface Window {
    __renderInspector__: RenderInspectorWindow;
  }
}
