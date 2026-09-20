import { describe, it, expect } from "vitest";
import { isPrivateAddress, fetchImage } from "../src/lib/safeFetch.js";

describe("isPrivateAddress", () => {
  it("rejects the ranges an SSRF payload would target", () => {
    for (const ip of [
      "127.0.0.1",
      "10.0.0.5",
      "172.16.3.4",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254", // cloud metadata
      "0.0.0.0",
      "100.64.0.1", // CGNAT
      "224.0.0.1", // multicast
      "::1",
      "fe80::1",
      "fd00::1",
      "::ffff:127.0.0.1", // IPv4-mapped loopback
    ]) {
      expect(isPrivateAddress(ip), `${ip} should be private`).toBe(true);
    }
  });

  it("accepts routable public addresses", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "192.167.1.1", "2606:4700::1111"]) {
      expect(isPrivateAddress(ip), `${ip} should be public`).toBe(false);
    }
  });

  it("refuses anything that is not an IP", () => {
    expect(isPrivateAddress("not-an-ip")).toBe(true);
    expect(isPrivateAddress("")).toBe(true);
  });
});

describe("fetchImage", () => {
  it("refuses non-https URLs", async () => {
    await expect(fetchImage("http://example.com/a.png", 1000)).rejects.toThrow(/Only https/);
  });

  it("refuses a literal private address without touching the network", async () => {
    await expect(fetchImage("https://169.254.169.254/latest/meta-data", 1000)).rejects.toThrow(
      /private address/,
    );
    await expect(fetchImage("https://127.0.0.1/x.png", 1000)).rejects.toThrow(/private address/);
  });

  it("refuses a hostname that resolves to loopback", async () => {
    // localhost resolves to 127.0.0.1 / ::1 — the DNS path, not the literal-IP path.
    await expect(fetchImage("https://localhost/x.png", 1000)).rejects.toThrow(
      /private address|resolve/,
    );
  });

  it("rejects a malformed URL", async () => {
    await expect(fetchImage("not a url", 1000)).rejects.toThrow(/valid URL/);
  });
});
