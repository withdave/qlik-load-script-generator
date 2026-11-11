// Per-tab state lives in localStorage (a convenience) and can be shared via a compressed URL hash.

const KEY = 'qlik-load-script-generator:v1';

export function loadState<T>(fallback: T): T {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

let timer: ReturnType<typeof setTimeout> | undefined;
export function saveState(state: unknown) {
  clearTimeout(timer);
  timer = setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* storage unavailable or full */
    }
  }, 300);
}

function b64url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const unb64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([data as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

export async function encodeShare(state: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(state));
  return b64url(await pipe(bytes, new CompressionStream('deflate-raw')));
}

export async function decodeShare<T>(hash: string): Promise<T | null> {
  try {
    const bytes = await pipe(unb64url(hash), new DecompressionStream('deflate-raw'));
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    return null;
  }
}
