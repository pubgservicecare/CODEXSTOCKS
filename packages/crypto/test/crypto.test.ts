import { describe, expect, it } from "vitest";
import {
  backupCodeTag,
  changeVaultPassphrase,
  checkLoginPassword,
  createLoginVerifier,
  createVault,
  decryptBackup,
  decryptSecret,
  encryptBackup,
  encryptSecret,
  formatRecoveryKey,
  parseEnvelope,
  parseRecoveryKey,
  passphraseProblem,
  randomBytes,
  rotateRecoveryKey,
  secretAad,
  unlockWithPassphrase,
  unlockWithRecoveryKey,
  VaultError,
} from "../src";

const FAST = { m: 256, t: 1, p: 1 }; // tiny params for speed in tests only
const VID = "0190a5a0-0000-7000-8000-000000000001";

describe("secret encryption", () => {
  it("round-trips, uses unique nonces and never contains plaintext", async () => {
    const { key } = await createVault("Correct Horse 9!", { vaultId: VID, kdf: FAST });
    const aad = secretAad("credential", "c1");
    const a = encryptSecret(key, "hunter2-password", aad);
    const b = encryptSecret(key, "hunter2-password", aad);
    expect(a).not.toEqual(b);
    expect(a).not.toContain("hunter2");
    expect(a.startsWith("cx1.")).toBe(true);
    expect(decryptSecret(key, a, aad)).toBe("hunter2-password");
  });

  it("rejects tampering, wrong AAD (record swap) and wrong keys", async () => {
    const { key } = await createVault("Correct Horse 9!", { vaultId: VID, kdf: FAST });
    const { key: other } = await createVault("Another Pass 9!", { vaultId: VID, kdf: FAST });
    const ct = encryptSecret(key, "secret", secretAad("credential", "c1"));
    expect(() => decryptSecret(key, ct, secretAad("credential", "c2"))).toThrow(VaultError);
    expect(() => decryptSecret(other, ct, secretAad("credential", "c1"))).toThrow(VaultError);
    const body = ct.slice(4);
    const flipped = "cx1." + (body[10] === "A" ? body.slice(0, 10) + "B" : body.slice(0, 10) + "A") + body.slice(11);
    expect(() => decryptSecret(key, flipped, secretAad("credential", "c1"))).toThrow(VaultError);
  });
});

describe("vault", () => {
  it("unlocks with passphrase or recovery key and produces the same key", async () => {
    const { envelope, key, recoveryKey } = await createVault("Correct Horse 9!", { vaultId: VID, kdf: FAST });
    const ct = encryptSecret(key, "pw", secretAad("credential", "x"));
    const env = parseEnvelope(JSON.stringify(envelope));
    const k1 = await unlockWithPassphrase(env, "Correct Horse 9!");
    const k2 = unlockWithRecoveryKey(env, recoveryKey.toLowerCase());
    expect(decryptSecret(k1, ct, secretAad("credential", "x"))).toBe("pw");
    expect(decryptSecret(k2, ct, secretAad("credential", "x"))).toBe("pw");
    await expect(unlockWithPassphrase(env, "wrong passphrase")).rejects.toThrow(/Incorrect vault passphrase/);
    expect(JSON.stringify(envelope)).not.toContain("Correct Horse");
  });

  it("changing the passphrase keeps the data key (no silent key replacement)", async () => {
    const { envelope, key, recoveryKey } = await createVault("Old Passphrase 1!", { vaultId: VID, kdf: FAST });
    const ct = encryptSecret(key, "keep-me", secretAad("credential", "x"));
    const changed = await changeVaultPassphrase(envelope, { recoveryKey }, "New Passphrase 2!", { kdf: FAST });
    await expect(unlockWithPassphrase(changed, "Old Passphrase 1!")).rejects.toThrow();
    const k = await unlockWithPassphrase(changed, "New Passphrase 2!");
    expect(decryptSecret(k, ct, secretAad("credential", "x"))).toBe("keep-me");
    expect(decryptSecret(unlockWithRecoveryKey(changed, recoveryKey), ct, secretAad("credential", "x"))).toBe("keep-me");
  });

  it("rotating the recovery key invalidates the old one", async () => {
    const { envelope, recoveryKey } = await createVault("Old Passphrase 1!", { vaultId: VID, kdf: FAST });
    const r = await rotateRecoveryKey(envelope, "Old Passphrase 1!");
    expect(() => unlockWithRecoveryKey(r.envelope, recoveryKey)).toThrow();
    expect(() => unlockWithRecoveryKey(r.envelope, r.recoveryKey)).not.toThrow();
  });

  it("recovery key format round-trips", () => {
    const b = randomBytes(32);
    const f = formatRecoveryKey(b);
    expect(f).toMatch(/^([0-9A-Z]{4}-){12}[0-9A-Z]{4}$/);
    expect(parseRecoveryKey(f)).toEqual(b);
  });

  it("backup-code tags detect duplicates but differ per set and per vault", async () => {
    const { key } = await createVault("Correct Horse 9!", { vaultId: VID, kdf: FAST });
    const { key: k2 } = await createVault("Correct Horse 9!", { vaultId: VID, kdf: FAST });
    expect(backupCodeTag(key, "s1", "01234567")).toBe(backupCodeTag(key, "s1", "01234567"));
    expect(backupCodeTag(key, "s1", "01234567")).not.toBe(backupCodeTag(key, "s2", "01234567"));
    expect(backupCodeTag(key, "s1", "01234567")).not.toBe(backupCodeTag(k2, "s1", "01234567"));
  });

  it("default vault KDF parameters complete in reasonable time", async () => {
    const t0 = Date.now();
    const { envelope } = await createVault("Correct Horse 9!", { vaultId: VID });
    await unlockWithPassphrase(envelope, "Correct Horse 9!");
    expect(envelope.kdf.m).toBe(65536);
    expect(Date.now() - t0).toBeLessThan(30_000);
  });
});

describe("login verifier", () => {
  it("verifies the right password and rejects others", async () => {
    const { record } = await createLoginVerifier("My Login Pass 1!", FAST);
    expect(await checkLoginPassword("My Login Pass 1!", record)).toBeInstanceOf(Uint8Array);
    expect(await checkLoginPassword("my login pass 1!", record)).toBeNull();
    expect(JSON.stringify(record)).not.toContain("Login Pass");
  });
});

describe("encrypted backups", () => {
  it("round-trips and rejects the wrong password", async () => {
    const file = await encryptBackup("Backup Pass 123!", JSON.stringify({ hello: "world" }), { kdf: FAST });
    expect(file).not.toContain("world");
    expect(JSON.parse(await decryptBackup("Backup Pass 123!", file))).toEqual({ hello: "world" });
    await expect(decryptBackup("nope", file)).rejects.toThrow(/Incorrect backup password/);
  });
});

describe("passphrase policy", () => {
  it("rejects weak passphrases", () => {
    expect(passphraseProblem("short")).toBeTruthy();
    expect(passphraseProblem("alllowercaseletters")).toBeTruthy();
    expect(passphraseProblem("Str0ng!Passphrase")).toBeNull();
    expect(passphraseProblem("a very long passphrase made of words")).toBeNull();
  });
});
