/**
 * Constants for the visual PV panel layer.
 *
 * Business geometry stays seated on the roof plane for calculations. Rendering is
 * lifted a few centimeters along the roof normal so the GPU no longer has to
 * solve a coplanar roof/panel depth fight with polygonOffset alone.
 */
export const PV_PANEL_RENDER_LIFT_M = 0.045;
export const PV_PANEL_LIVE_FILL_LIFT_M = 0.06;
export const PV_PANEL_LIVE_LINE_LIFT_M = 0.074;
export const PV_PANEL_GHOST_FILL_LIFT_M = 0.062;
export const PV_PANEL_GHOST_LINE_LIFT_M = 0.076;
