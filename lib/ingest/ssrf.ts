import { isIP } from "node:net";
/**
 * SSRF guards for user-supplied URLs.
 *
 * Knowledge Studio fetches arbitrary URLs on the server's behalf, so without these checks an
 * author could read cloud metadata endpoints, internal admin panels or anything else reachable
 * from the host. Kept pure and separately tested because a subtle gap here is invisible.
 */

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

/** Hostnames that must never be resolved, regardless of what DNS says. */
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata.goog",
  "instance-data",
]);

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    value = value * 256 + n;
  }
  return value;
}

const IPV4_BLOCKS: [string, number][] = [
  ["0.0.0.0", 8], // this network
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, includes cloud metadata at 169.254.169.254
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // TEST-NET-1
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, includes broadcast
];

export function isBlockedIpv4(ip: string): boolean {
  const value = ipv4ToInt(ip);
  if (value === null) return true; // unparseable is not safe
  return IPV4_BLOCKS.some(([base, bits]) => {
    const baseValue = ipv4ToInt(base)!;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (value & mask) === (baseValue & mask);
  });
}

export function isBlockedIpv6(ip: string): boolean {
  let addr = ip.toLowerCase().split("%")[0];
  if (isIP(addr) !== 6) return true;
  // Normalize expanded and hexadecimal IPv4-mapped addresses before classifying.
  addr = new URL(`http://[${addr}]/`).hostname.slice(1, -1);
  const hexMapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(addr);
  if (hexMapped) {
    const value = parseInt(hexMapped[1], 16) * 65536 + parseInt(hexMapped[2], 16);
    return isBlockedIpv4([value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join("."));
  }
  if (addr === "::" || addr === "::1") return true;
  // IPv4-mapped (::ffff:10.0.0.1) inherits the IPv4 rules.
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(addr);
  if (mapped) return isBlockedIpv4(mapped[1]);
  // Unique-local (fc00::/7), link-local (fe80::/10), multicast (ff00::/8).
  return /^f[cd]/.test(addr) || /^fe[89ab]/.test(addr) || /^ff/.test(addr);
}

export function isBlockedAddress(ip: string, family: 4 | 6): boolean {
  return family === 4 ? isBlockedIpv4(ip) : isBlockedIpv6(ip);
}

export interface UrlCheck {
  ok: boolean;
  reason?: string;
  url?: URL;
}

/** Structural checks that need no DNS. */
export function checkUrlShape(raw: string): UrlCheck {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "Not a valid URL" };
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    return { ok: false, reason: `Only http and https are allowed, got ${url.protocol}` };
  }
  if (url.username || url.password) return { ok: false, reason: "URLs containing credentials are not allowed" };
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (BLOCKED_HOSTNAMES.has(host) || host.endsWith(".localhost") || host.endsWith(".internal")) {
    return { ok: false, reason: `Blocked hostname: ${host}` };
  }
  // A literal IP can be judged immediately, before any lookup.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) && isBlockedIpv4(host)) {
    return { ok: false, reason: `Blocked address: ${host}` };
  }
  if (host.includes(":") && isBlockedIpv6(host)) {
    return { ok: false, reason: `Blocked address: ${host}` };
  }
  return { ok: true, url };
}
