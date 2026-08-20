import test from "node:test";
import assert from "node:assert/strict";
import { __test } from "../services/mail/mailNetworkGuard.service.js";

test("mail network guard blocks local and private IPv4 ranges", () => {
  for (const ip of ["127.0.0.1", "10.0.0.4", "172.16.2.3", "192.168.1.9", "169.254.169.254", "100.64.1.1"]) {
    assert.equal(__test.isBlockedIp(ip), true, ip);
  }
});

test("mail network guard allows public IPv4 and blocks local IPv6", () => {
  assert.equal(__test.isBlockedIp("8.8.8.8"), false);
  assert.equal(__test.isBlockedIp("::1"), true);
  assert.equal(__test.isBlockedIp("fc00::1"), true);
  assert.equal(__test.isBlockedIp("fe80::1"), true);
  assert.equal(__test.isBlockedIp("::ffff:127.0.0.1"), true);
  assert.equal(__test.isBlockedIp("::ffff:172.16.0.1"), true);
  assert.equal(__test.isBlockedIp("::ffff:8.8.8.8"), false);
});

test("mail network guard refuse une reponse DNS multiple si une adresse est privee", () => {
  assert.throws(
    () => __test.assertResolvedAddressesSafe([{ address: "8.8.8.8" }, { address: "169.254.169.254" }]),
    /bloque/
  );
  assert.doesNotThrow(() => __test.assertResolvedAddressesSafe([{ address: "8.8.8.8" }, { address: "1.1.1.1" }]));
});
