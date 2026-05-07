export interface RenderInspectorOptions {
  /** Cookie name that activates the inspector. Default: '__render_inspector__' */
  triggerCookie?: string;
  /** Re-render count threshold before a component is flagged. Default: 5 */
  threshold?: number;
  /** Auto-activate in Vite dev mode without the trigger cookie. Default: true */
  enableInDev?: boolean;
}
