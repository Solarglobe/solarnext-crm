/**
 * Types minimaux pour `phase2RoofDerivedModel.js` (P0 compilation).
 */

export declare const DERIVED_ROOF_TOPOLOGY_SOURCE: string;

export function deriveRoofPlanesFromPans(state: unknown): unknown[];

export function deriveRoofPlanesFallbackFromContoursOnly(state: unknown): unknown[];

export function syncRoofPansMirrorFromPans(state: unknown): void;

export function applyDerivedRoofTopologyAfterPans(state: unknown, opts?: { skipFallback?: boolean }): unknown[];
