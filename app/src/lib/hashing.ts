/**
 * Browser-safe SHA-256 utilities for SwarmSettle (app/src/lib/hashing.ts)
 *
 * Computes SHA-256 digests over both canonical UTF-8 text (acceptance criteria)
 * and raw deliverable file bytes (Uint8Array / ArrayBuffer / File) so the UI
 * verifies byte-level integrity rather than copying a pre-filled string.
 */

export async function sha256HexFromBytes(bytes: Uint8Array | ArrayBuffer): Promise<string> {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const buffer = view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256HexFromText(text: string): Promise<string> {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  const encoded = new TextEncoder().encode(normalized);
  return sha256HexFromBytes(encoded);
}

export async function sha256HexFromFile(file: File): Promise<{ sha256: string; bytes: Uint8Array; textPreview: string }> {
  const arrayBuffer = await file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  const sha256 = await sha256HexFromBytes(bytes);
  const textPreview = new TextDecoder('utf-8', { fatal: false }).decode(bytes.slice(0, 4096));
  return { sha256, bytes, textPreview };
}
