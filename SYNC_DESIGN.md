# Shared-office access and synchronization

## Current shared-office mode

SQLite remains local to one designated host PC. Client apps call the host over HTTPS; they do not open or copy the live SQLite file. The host serializes RPC operations, authenticates each user, and checks the required page permission before dispatching each operation. Sessions are random bearer tokens held in app memory and expire after eight hours. The client pins the host certificate by its SHA-256 fingerprint before sending credentials.

The administrator starts/stops the host from Database Tools. Clients configure the HTTPS address and fingerprint on the sign-in screen and then use their own accounts. The server listens on port `48391`; restrict Windows Firewall to the Private network profile. Do not port-forward this port or expose it to the public internet. Use an approved VPN for remote access.

This is one authoritative database, not Git-like multi-master sync. The host must be running for clients to work. If an operator goes offline, the app does not queue writes for later merge. Take and verify backups on the host.

The host app uses a self-signed TLS certificate stored under its Electron user-data directory. The fingerprint is displayed in Database Tools and must be shared with clients through a separate trusted channel. A client rejects a server whose fingerprint differs. The private key stays on the host PC.

## Security limits

Separate app accounts and server-side permission checks prevent ordinary non-admin accounts from invoking unauthorized app operations. They do not protect a PC controlled by its local administrator from direct file access or app modification. The live SQLite file and local backups are not database-encrypted; protect the host with Windows account ACLs and BitLocker/device encryption. Never distribute the database file or an admin session to clients.

## Deferred work

Offline queued writes and conflict merging remain deferred. If independent offline editing becomes mandatory, the operation journal and conflict model below can be developed after the office approves record-level merge rules. SQLite files must never be shared live over a network drive or merged through Git.
