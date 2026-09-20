import dns from "node:dns/promises";
import net from "node:net";
import { ToolError } from "./errors.js";

const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png"]);
const MAX_REDIRECTS = 3;

/**
 * Private, loopback, link-local and other non-routable IPv4 ranges.
 * 169.254.0.0/16 is the one that matters most: it holds the cloud metadata endpoint.
 */
function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  const [a, b] = parts;
  if (parts.length !== 4 || a === undefined || b === undefined) return true;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true; // link-local / cloud metadata
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast + reserved
  return false;
}

/**
 * Expand any legal IPv6 spelling into its eight 16-bit groups.
 *
 * The same address has many textual forms: `::1`, `0:0:0:0:0:0:0:1` and
 * `0000:...:0001` are one address, and an IPv4-mapped address can be written with a dotted
 * tail (`::ffff:127.0.0.1`) or in pure hex (`::ffff:7f00:1`). Matching on the text is how a
 * loopback address slips past a blocklist, so normalize first and decide on the numbers.
 */
function expandIPv6(ip: string): number[] | null {
  let addr = ip.toLowerCase().split("%")[0] ?? ""; // drop any zone index
  if (!addr) return null;

  // A dotted IPv4 tail occupies the final two groups; convert it to hex first.
  const dotted = addr.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (dotted?.[1]) {
    const octets = dotted[1].split(".").map(Number);
    if (octets.length !== 4 || octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) {
      return null;
    }
    const [a, b, c, d] = octets as [number, number, number, number];
    const hex = `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
    addr = addr.slice(0, dotted.index) + hex;
  }

  const halves = addr.split("::");
  if (halves.length > 2) return null;

  const parse = (part: string): number[] | null => {
    if (!part) return [];
    const out: number[] = [];
    for (const group of part.split(":")) {
      if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
      out.push(parseInt(group, 16));
    }
    return out;
  };

  const head = parse(halves[0] ?? "");
  if (head === null) return null;

  if (halves.length === 1) return head.length === 8 ? head : null;

  const tail = parse(halves[1] ?? "");
  if (tail === null) return null;

  const gap = 8 - head.length - tail.length;
  if (gap < 0) return null;
  return [...head, ...Array<number>(gap).fill(0), ...tail];
}

const ipv4FromGroups = (g6: number, g7: number): string =>
  [(g6 >> 8) & 0xff, g6 & 0xff, (g7 >> 8) & 0xff, g7 & 0xff].join(".");

function isPrivateIPv6(ip: string): boolean {
  const g = expandIPv6(ip);
  if (!g || g.length !== 8) return true; // unparseable — refuse

  const [g0, g1, g2, g3, g4, g5, g6, g7] = g as [
    number, number, number, number, number, number, number, number,
  ];

  // ::/128 (unspecified) and ::1/128 (loopback), in any spelling.
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0 && g6 === 0) {
    return g7 === 0 || g7 === 1;
  }
  // ::ffff:0:0/96 — IPv4-mapped. Inherits the embedded address's verdict.
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0xffff) {
    return isPrivateIPv4(ipv4FromGroups(g6, g7));
  }
  // ::/96 — deprecated IPv4-compatible, still routable text in some stacks.
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) {
    return isPrivateIPv4(ipv4FromGroups(g6, g7));
  }
  // 64:ff9b::/96 — NAT64 well-known prefix; the low 32 bits are the real IPv4 destination.
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) {
    return isPrivateIPv4(ipv4FromGroups(g6, g7));
  }
  if ((g0 & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g0 & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((g0 & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  return false;
}

export function isPrivateAddress(ip: string): boolean {
  const version = net.isIP(ip);
  if (version === 4) return isPrivateIPv4(ip);
  if (version === 6) return isPrivateIPv6(ip);
  return true; // not an IP we can reason about — refuse
}

/**
 * Reject a URL that points at us or at the private network before we ever open a socket.
 *
 * This is the SSRF gate. Without it, any URL reaching `set_thumbnail` — including one a
 * model picked up from an untrusted YouTube comment — could make this process probe
 * localhost services or a cloud metadata endpoint.
 *
 * DNS is resolved here and re-checked on every redirect hop. A hostname could still be
 * re-resolved to a different address between this check and the socket connect (a classic
 * DNS-rebinding race); closing that fully requires pinning the connection to the vetted IP,
 * which Node's fetch does not expose. This blocks the direct and redirect-based attacks.
 */
async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ToolError(`Not a valid URL: ${raw}`);
  }
  if (url.protocol !== "https:") {
    throw new ToolError(
      `Only https:// image URLs are accepted (got '${url.protocol}').`,
      "Host the image somewhere with HTTPS and pass that URL.",
    );
  }

  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host)) {
    if (isPrivateAddress(host)) {
      throw new ToolError(`Refusing to fetch from a private address: ${host}`);
    }
    return url;
  }

  let records: Array<{ address: string }>;
  try {
    records = await dns.lookup(host, { all: true });
  } catch {
    throw new ToolError(`Could not resolve host: ${host}`);
  }
  if (records.length === 0) throw new ToolError(`Host resolved to no addresses: ${host}`);

  // Every address must be public: one private answer is enough to make the fetch unsafe.
  for (const { address } of records) {
    if (isPrivateAddress(address)) {
      throw new ToolError(
        `Refusing to fetch '${host}': it resolves to the private address ${address}.`,
      );
    }
  }
  return url;
}

export type FetchedImage = { bytes: Buffer; mimeType: string };

/**
 * Fetch an image for upload, with the URL vetted, redirects re-vetted, the content type
 * checked against what YouTube accepts, and the body capped so a hostile or broken endpoint
 * cannot stream until the process runs out of memory.
 */
export async function fetchImage(
  rawUrl: string,
  maxBytes: number,
  timeoutMs = 15_000,
): Promise<FetchedImage> {
  let current = await assertPublicUrl(rawUrl);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const abort = AbortSignal.timeout(timeoutMs);
    const response = await fetch(current, { redirect: "manual", signal: abort });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new ToolError(`Redirect with no Location header from ${current.href}`);
      current = await assertPublicUrl(new URL(location, current).href);
      continue;
    }
    if (!response.ok) {
      throw new ToolError(`Image fetch failed: HTTP ${response.status} from ${current.href}`);
    }

    const mimeType = (response.headers.get("content-type") ?? "").split(";")[0]?.trim() ?? "";
    if (!ALLOWED_IMAGE_TYPES.has(mimeType)) {
      throw new ToolError(
        `Unsupported image type '${mimeType || "unknown"}'.`,
        "YouTube thumbnails must be image/jpeg or image/png.",
      );
    }

    const declared = Number(response.headers.get("content-length") ?? NaN);
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new ToolError(
        `Image is ${declared} bytes; the limit is ${maxBytes}.`,
        "YouTube rejects thumbnails over 2 MB.",
      );
    }

    const bytes = await readCapped(response, maxBytes);
    return { bytes, mimeType };
  }
  throw new ToolError(`Too many redirects (>${MAX_REDIRECTS}) starting from ${rawUrl}`);
}

/** Read a body chunk by chunk, aborting as soon as it exceeds the cap. */
async function readCapped(response: Response, maxBytes: number): Promise<Buffer> {
  const reader = response.body?.getReader();
  if (!reader) throw new ToolError("Image response had no body.");

  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        throw new ToolError(
          `Image exceeds the ${maxBytes}-byte limit.`,
          "YouTube rejects thumbnails over 2 MB.",
        );
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks);
}
