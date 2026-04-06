/**
 * Tolérances image (px) alignées sur la Phase 2 shell / legacy calpinage
 * (`HEIGHT_EDIT_EPS_IMG` ≈ 15 px pour le rattachement hauteur côté module).
 *
 * heightConstraints.ts et la philosophie « point sur ligne structurante » doivent
 * rester du même ordre que l’UI / le hit-test legacy pour éviter :
 * « accroché en 2D » vs « trop loin pour Z » sur le même cas nominal.
 */
export const PHASE2_IMAGE_SNAP_PX_FOR_HEIGHT = 14;
export const PHASE2_ON_SEGMENT_TOL_PX_FOR_HEIGHT = 9;
