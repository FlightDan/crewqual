// Compatibility implementation: the member contract currently delegates to
// the hardened pilot handler while the domain service is migrated.
// The delegated handler owns parseJson/jsonError envelope handling.
export { POST } from "@/app/api/pilot/access-link/route";
