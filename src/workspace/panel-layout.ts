export const LEFT_PANEL_DEFAULT_WIDTH = 300;
export const RIGHT_PANEL_DEFAULT_WIDTH = 380;

const PANEL_MIN_WIDTH = 220;
const PANEL_MAX_WIDTH = 560;

export function clampPanelWidth(width: number) {
  return Math.round(Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, width)));
}
