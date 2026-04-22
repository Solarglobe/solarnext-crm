/** clipper-lib n’expose pas de types officiels — module CJS utilisé pour unions 2D. */
declare module "clipper-lib" {
  const ClipperLib: Record<string, unknown>;
  export default ClipperLib;
}
