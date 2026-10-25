import "server-only";
// Next's server-only boundary plus the package's node-only export keep this fixture out of client bundles.
export { polatOfflineRuntimeProvider, type PolatOfflineRuntimeModel } from "../../../../../packages/domain/src/polat-runtime-model";
