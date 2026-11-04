declare module 'node:fs' {
  export function readFileSync(path: string): Uint8Array;
  export function readdirSync(path: string): string[];
  export function statSync(path: string): { isDirectory(): boolean };
}

declare module 'node:crypto' {
  export interface Sha256 {
    update(data: Uint8Array | string): Sha256;
    digest(encoding: 'hex'): string;
  }
  export function createHash(algorithm: 'sha256'): Sha256;
}

declare module 'node:vm' {
  interface Context {
    readonly __context: unique symbol;
  }
  const vm: {
    createContext(sandbox: Record<string, unknown>): Context;
    runInContext(code: string, context: Context): unknown;
  };
  export default vm;
}
