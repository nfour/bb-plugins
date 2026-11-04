import assert from "node:assert/strict";
import { test } from "node:test";
import { CLOUDFLARED_VERSION, downloadPinned, manualCommand, pinnedAsset, sha256Hex, verifyAsset, type PinnedAsset } from "./install.ts";

/** A small stand-in asset: the check is the same whatever the size. */
function fake(bytes: Uint8Array): PinnedAsset {
  return { file: "x", url: "https://example.test/x", sha256: sha256Hex(bytes), size: bytes.length };
}

test("pins one release with a hash for each Linux build", () => {
  for (const arch of ["x64", "arm64"]) {
    const asset = pinnedAsset(arch)!;
    assert.match(asset.sha256, /^[0-9a-f]{64}$/);
    assert.ok(asset.size > 1_000_000);
    assert.equal(asset.url, `https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}/${asset.file}`);
    assert.ok(!asset.url.includes("latest"));
  }
  assert.notEqual(pinnedAsset("x64")!.sha256, pinnedAsset("arm64")!.sha256);
  assert.equal(pinnedAsset("ia32"), null);
});

test("verifyAsset accepts the exact bytes", () => {
  const bytes = new Uint8Array([1, 2, 3, 4]);
  verifyAsset(bytes, fake(bytes));
});

test("verifyAsset refuses changed bytes of the same size", () => {
  const good = new Uint8Array([1, 2, 3, 4]);
  assert.throws(() => verifyAsset(new Uint8Array([1, 2, 3, 5]), fake(good)), /SHA-256 does not match/);
});

test("verifyAsset refuses a different size", () => {
  const good = new Uint8Array([1, 2, 3, 4]);
  assert.throws(() => verifyAsset(new Uint8Array([1, 2, 3]), fake(good)), /not the expected 4/);
});

test("downloadPinned refuses a download that is not the pinned build", async () => {
  const html = new TextEncoder().encode("<html>not a binary</html>");
  const fetcher = (async () => new Response(html)) as typeof fetch;
  await assert.rejects(downloadPinned("x64", fetcher), /Nothing was installed/);
});

test("downloadPinned asks for the pinned url and reports a failed request", async () => {
  const seen: string[] = [];
  const fetcher = (async (input: unknown) => {
    seen.push(String(input));
    return new Response("nope", { status: 404 });
  }) as typeof fetch;
  await assert.rejects(downloadPinned("arm64", fetcher), /failed \(404\)/);
  assert.deepEqual(seen, [pinnedAsset("arm64")!.url]);
});

test("downloadPinned has no build for other architectures", async () => {
  await assert.rejects(downloadPinned("ppc64", (async () => new Response("")) as typeof fetch), /no pinned cloudflared build/);
});

test("the manual command pins the release and checks the hash before chmod", () => {
  const command = manualCommand("x64");
  const asset = pinnedAsset("x64")!;
  assert.ok(command.includes(asset.url));
  assert.ok(command.includes(asset.sha256));
  assert.ok(command.indexOf("sha256sum -c") < command.indexOf("chmod +x"));
  assert.ok(!command.includes("latest"));
});
