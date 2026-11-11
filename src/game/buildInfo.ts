/**
 * The build's version line for feedback notes: package version, sim version and short commit.
 * Vite defines the two globals (vite.config.ts); tests and unbundled code see 'dev'.
 */
import { SIM_VERSION } from '../net/simVersion';

declare const __PB_VERSION__: string | undefined;
declare const __PB_COMMIT__: string | undefined;

export const APP_VERSION: string = typeof __PB_VERSION__ === 'string' ? __PB_VERSION__ : 'dev';
export const APP_COMMIT: string = typeof __PB_COMMIT__ === 'string' ? __PB_COMMIT__ : '';

export const BUILD_ID: string = [APP_VERSION, `sim ${SIM_VERSION}`, APP_COMMIT]
  .filter((part) => part.length > 0)
  .join(' · ');
