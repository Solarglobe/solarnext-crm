/**
 * Constants for the visual PV panel layer.
 *
 * Business geometry stays seated on the roof plane for calculations. Rendering is
 * lifted a few centimeters along the roof normal so the GPU no longer has to
 * solve a coplanar roof/panel depth fight with polygonOffset alone.
 */
export const PV_PANEL_THICKNESS_M = 0.03;
export const PV_PANEL_ROOF_GAP_M = 0.06;

// Top glass surface lift. The panel underside sits PV_PANEL_ROOF_GAP_M above the roof.
export const PV_PANEL_RENDER_LIFT_M = PV_PANEL_ROOF_GAP_M + PV_PANEL_THICKNESS_M;
export const PV_PANEL_LIVE_FILL_LIFT_M = PV_PANEL_RENDER_LIFT_M + 0.012;
export const PV_PANEL_LIVE_LINE_LIFT_M = PV_PANEL_RENDER_LIFT_M + 0.026;
export const PV_PANEL_GHOST_FILL_LIFT_M = PV_PANEL_RENDER_LIFT_M + 0.014;
export const PV_PANEL_GHOST_LINE_LIFT_M = PV_PANEL_RENDER_LIFT_M + 0.028;
