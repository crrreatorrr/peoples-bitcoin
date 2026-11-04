/**
 * The sim version the client and the server bundle must share. Vite and the
 * bundle script both define `__PB_SIM_VERSION__` from a hash of the sim
 * sources (scripts/simHash.mjs); tests and unbundled code see 'dev'.
 */
declare const __PB_SIM_VERSION__: string | undefined;

export const SIM_VERSION: string =
  typeof __PB_SIM_VERSION__ === 'string' ? __PB_SIM_VERSION__ : 'dev';
