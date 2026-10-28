import { backupCodeTag, decryptSecret, encryptSecret, secretAad, type VaultKey } from "@codex/crypto";
import { newId, validateBackupCodes, type BackupCode, type Credential } from "@codex/shared";

/**
 * Helpers that turn plaintext typed by the owner into command arguments carrying
 * ONLY ciphertext. Used by the desktop app and by the admin website (in the browser),
 * so plaintext secrets never travel to the server or into the database.
 */
export function sharedPasswordArgs(key: VaultKey, accountId: string, existing: Credential | null, plaintext: string) {
  if (!plaintext) throw new Error("Enter the password");
  if (plaintext.length > 500) throw new Error("Password is too long");
  const credential_id = existing?.id ?? newId();
  return {
    account_id: accountId,
    credential_id,
    secret_ct: encryptSecret(key, plaintext, secretAad("credential", credential_id)),
  };
}

export function revealCredential(key: VaultKey, c: Pick<Credential, "id" | "secret_ct">): string {
  return decryptSecret(key, c.secret_ct, secretAad("credential", c.id));
}

export function backupSetArgs(
  key: VaultKey,
  input: { accountId: string; linkId: string | null; label: string; codes: string[] },
) {
  const codes = validateBackupCodes(input.codes.map((c) => c.replace(/[\s-]/g, "")));
  const setId = newId();
  return {
    set: { id: setId, account_id: input.accountId, link_id: input.linkId, label: input.label.slice(0, 200) },
    codes: codes.map((code, i) => {
      const id = newId();
      return {
        id,
        position: i + 1,
        code_ct: encryptSecret(key, code, secretAad("backup_code", id)),
        code_tag: backupCodeTag(key, setId, code),
      };
    }),
  };
}

export function revealBackupCode(key: VaultKey, c: Pick<BackupCode, "id" | "code_ct">): string {
  return decryptSecret(key, c.code_ct, secretAad("backup_code", c.id));
}
