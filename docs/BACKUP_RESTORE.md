# Backup & restore

## What to keep safe (offline, e.g. printed + USB)
1. **Recovery key** (shown once at setup / when rotated).
2. A recent **encrypted backup file** (`.cxbackup`).
3. Your vault passphrase and login password (in your head or a password manager).

## Desktop backup
Desktop app → **Backup** → choose a backup password (12+ chars) → **Export backup…** → save the `.cxbackup`.
Contains the whole local database, including changes not yet synced. Not included: images still waiting to
upload (uploaded images live on ImageKit).

## Restore
Desktop app → **Backup** → backup password → **Choose file and restore…**. Replaces this PC's inventory in one
transaction (if anything fails, nothing changes). You are signed out; sign in with the login password that
was valid when the backup was made, then unlock the vault with the vault passphrase or recovery key.
New PC: install, then on the welcome screen choose **Restore from an encrypted backup file**.

## Cloud
Neon keeps point-in-time history (configure retention in the Neon console → Project settings). Neon
branches give an instant copy before risky operations. Encrypted secrets in Neon can only be read with the
vault passphrase or recovery key.
