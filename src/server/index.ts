/**
 * Entry of the server bundle (`npm run build:sim` → global `PbSim`), loaded by
 * metaverse-hub's `pb_world` match. Nothing heavy runs at load: content is
 * parsed on the first createWorldHost.
 */
export { createWorldHost, GAME_ID } from './host';
export { benchWorld } from './bench';
export type { HostIO, HostOptions, LoopResult, Outbound, Presence, WorldHost } from './host';
export { PROTOCOL_VERSION, OP } from '../net/protocol';
export { SIM_VERSION } from '../net/simVersion';
