// The guided cloudflared install (Linux). One release is pinned, with the SHA-256
// of each asset taken from Cloudflare's release notes for that tag (they match the
// digests GitHub shows). A download is only written to disk after its hash matches.
import { createHash } from "node:crypto";

/** The one cloudflared release the install button downloads. Bump together with the hashes. */
export const CLOUDFLARED_VERSION = "2026.10.7";

export interface PinnedAsset {
  /** Release asset name. */
  file: string;
  url: string;
  sha256: string;
  /** Exact size in bytes. */
  size: number;
}

const ASSETS: Record<string, { file: string; sha256: string; size: number }> = {
  x64: { file: "cloudflared-linux-amd64", sha256: "1f99fb518b83dec2ba8d870a7cc991d82a77e6196295a3d2754ba17ab9f91872", size: 40_274_445 },
  arm64: { file: "cloudflared-linux-arm64", sha256: "3df43aedc9ff291d1735b5cb576cb97e0b157488796db2e32b28aecabb445775", size: 37_667_293 },
};

/** The pinned Linux asset for a Node `process.arch` value, or null when there is none. */
export function pinnedAsset(arch: string): PinnedAsset | null {
  const asset = ASSETS[arch];
  if (!asset) return null;
  return { ...asset, url: `https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}/${asset.file}` };
}

/** Hex SHA-256 of the bytes. */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Throws unless the bytes are exactly the pinned asset. */
export function verifyAsset(bytes: Uint8Array, asset: PinnedAsset): void {
  if (bytes.length !== asset.size) throw new Error(`The download is ${bytes.length} bytes, not the expected ${asset.size}. Nothing was installed.`);
  if (sha256Hex(bytes) !== asset.sha256) throw new Error("The download's SHA-256 does not match the pinned release. Nothing was installed.");
}

/**
 * Downloads the pinned asset and returns its bytes, checked. `fetcher` is injectable
 * for tests. Redirects are followed (GitHub serves assets from another host); the
 * hash is what makes that safe.
 */
export async function downloadPinned(arch: string, fetcher: typeof fetch = fetch): Promise<{ bytes: Uint8Array; asset: PinnedAsset }> {
  const asset = pinnedAsset(arch);
  if (!asset) throw new Error(`There is no pinned cloudflared build for ${arch}. Install it with the command shown, then share again.`);
  const response = await fetcher(asset.url, { redirect: "follow" });
  if (!response.ok) throw new Error(`The download failed (${response.status}).`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  verifyAsset(bytes, asset);
  return { bytes, asset };
}

/** A shell command that does the same by hand: download, check the hash, then install. */
export function manualCommand(arch: string): string {
  const asset = pinnedAsset(arch) ?? pinnedAsset("x64")!;
  const tmp = '"$HOME/.local/bin/cloudflared.download"';
  return [
    "mkdir -p ~/.local/bin",
    `curl -fL -o ${tmp} ${asset.url}`,
    `echo "${asset.sha256}  $HOME/.local/bin/cloudflared.download" | sha256sum -c -`,
    `chmod +x ${tmp}`,
    `mv ${tmp} ~/.local/bin/cloudflared`,
  ].join(" && ");
}
