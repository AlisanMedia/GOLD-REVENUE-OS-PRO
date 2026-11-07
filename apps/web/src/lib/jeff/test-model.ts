import "server-only";
// Next's server-only boundary plus the package's node-only export keep this fixture out of client bundles.
export { jeffOfflineRuntimeProvider, type JeffOfflineRuntimeModel } from "../../../../../packages/domain/src/jeff-runtime-model";
