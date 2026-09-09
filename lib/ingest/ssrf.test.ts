import { describe, expect, it } from "vitest";
import { checkUrlShape, isBlockedIpv4, isBlockedIpv6 } from "@/lib/ingest/ssrf";

describe("isBlockedIpv4", () => {
  it("blocks the cloud metadata endpoint", () => {
    // The single most valuable SSRF target on any cloud host.
    expect(isBlockedIpv4("169.254.169.254")).toBe(true);
  });

  it("blocks loopback and private ranges", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1"]) {
      expect(isBlockedIpv4(ip), ip).toBe(true);
    }
  });

  it("blocks carrier-grade NAT, multicast, reserved and broadcast", () => {
    for (const ip of ["100.64.0.1", "224.0.0.1", "240.0.0.1", "255.255.255.255", "0.0.0.0"]) {
      expect(isBlockedIpv4(ip), ip).toBe(true);
    }
  });

  it("allows ordinary public addresses", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "192.167.1.1", "93.184.216.34"]) {
      expect(isBlockedIpv4(ip), ip).toBe(false);
    }
  });

  it("treats anything unparseable as unsafe", () => {
    for (const ip of ["not-an-ip", "999.1.1.1", "10.0.0", "1.2.3.4.5", ""]) {
      expect(isBlockedIpv4(ip), ip).toBe(true);
    }
  });
});

describe("isBlockedIpv6", () => {
  it("blocks loopback, unspecified, unique-local, link-local and multicast", () => {
    for (const ip of ["::1", "::", "fc00::1", "fd12:3456::1", "fe80::1", "ff02::1"]) {
      expect(isBlockedIpv6(ip), ip).toBe(true);
    }
  });

  it("applies the IPv4 rules to IPv4-mapped addresses", () => {
    expect(isBlockedIpv6("::ffff:169.254.169.254")).toBe(true);
    expect(isBlockedIpv6("::ffff:127.0.0.1")).toBe(true);
    expect(isBlockedIpv6("::ffff:8.8.8.8")).toBe(false);
  });

  it("ignores a zone index when judging link-local", () => {
    expect(isBlockedIpv6("fe80::1%eth0")).toBe(true);
  });

  it("allows public IPv6", () => {
    expect(isBlockedIpv6("2606:4700:4700::1111")).toBe(false);
  });
});

describe("checkUrlShape", () => {
  it("rejects non-http schemes", () => {
    for (const raw of ["file:///etc/passwd", "gopher://x", "ftp://x", "data:text/html,x"]) {
      expect(checkUrlShape(raw).ok, raw).toBe(false);
    }
  });

  it("rejects localhost and internal hostnames", () => {
    for (const raw of [
      "http://localhost/admin",
      "http://foo.localhost/",
      "http://metadata.google.internal/computeMetadata/v1/",
      "http://api.internal/",
    ]) {
      expect(checkUrlShape(raw).ok, raw).toBe(false);
    }
  });

  it("rejects literal private and metadata addresses without needing DNS", () => {
    for (const raw of [
      "http://169.254.169.254/latest/meta-data/",
      "http://127.0.0.1:8080/",
      "http://192.168.0.1/",
      "http://[::1]/",
      "http://[fd00::1]/",
      "http://[::ffff:7f00:1]/",
      "http://[0:0:0:0:0:ffff:a9fe:a9fe]/",
    ]) {
      expect(checkUrlShape(raw).ok, raw).toBe(false);
    }
  });

  it("accepts ordinary public URLs", () => {
    const r = checkUrlShape("https://example.com/docs/vpn?x=1");
    expect(r.ok).toBe(true);
    expect(r.url?.hostname).toBe("example.com");
  });

  it("rejects malformed input", () => {
    expect(checkUrlShape("not a url").ok).toBe(false);
    expect(checkUrlShape("").ok).toBe(false);
  });
});
