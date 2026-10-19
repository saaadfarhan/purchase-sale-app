# Purchase Sale Office

An offline-first desktop application for purchase/sale challans, stock, accounts, and office records.

The active UI migration is Electron + React + TypeScript + Vite, with shadcn/ui components styled by Tailwind CSS. SQLite access stays in Electron’s main process; the renderer receives a small, typed API through a sandboxed preload. Shared-office mode keeps the database on one host PC and sends operations over HTTPS. The host authenticates each operator and enforces page permissions. The original Java/Swing app is retained during the transition and is not yet removed.

## Develop

Requirements: Node.js 24 LTS/current and pnpm.

```bash
pnpm install
pnpm dev
```

`pnpm dev` starts the Vite renderer and Electron. To verify the current migration slice:

```bash
pnpm test
pnpm build
```

To package for Windows, run `pnpm package:win` on a supported Windows build machine. It creates an NSIS installer in `build-electron/`; test that installer on a clean Windows 10/11 account before office use. Linux packaging is available with `pnpm package:linux`.

The local Electron database is stored at `%LOCALAPPDATA%\PurchaseSaleOffice\data\purchase-sale.sqlite` on Windows and in Electron’s user-data directory on Linux. In shared-office mode, only the host PC opens this file; client PCs do not maintain or merge local business-data copies. Configure the host from Database Tools, then give client operators the HTTPS address and SHA-256 certificate fingerprint through a trusted, separate channel. Each person signs in with their own account created under User Rights; never share an admin session or password.

Shared-office mode is designed for a trusted private office network. Do not port-forward its port or expose it directly to the public internet. Remote access requires an office-approved VPN. On Windows, permit the app through the firewall only on the Private network profile. The host must remain running and connected while clients work. Make backups on the host. Enable Windows device encryption/BitLocker and restrict the Windows account that owns the database; this application does not encrypt the live SQLite file at rest.

The host validates operations and roles, but a person with administrator control of the host PC can still access its local files. This is an office LAN pilot, not a hardened internet service. Back up the local file before testing, and do not operate the Java and Electron apps against the same live database concurrently until migration is validated.

## Migration status

The Electron UI includes first-run administrator registration, admin-only company-profile editing, user page permissions, audit history, dashboard, Chart of Accounts, Items, Stock Types, opening stock balances, inter-location transfers, Banks, Cheque Detail, purchase/sale challans, vouchers, payments/receipts, Search Payment, and the report menu. Database Tools provides consistent SQLite backups, a JSON business-data export without credential hashes, and integrity/foreign-key verification. Challans, vouchers, and reports have print-only layouts with company details and an optional supported logo. Master and transaction edit/delete safeguards, transactional writes, stock checks, and balanced voucher validation are implemented.

Still missing or intentionally deferred: an in-app restore picker, business-operation conflict merging, verified legacy migration, invoice-level payment allocation, and accounting validation. Shared-office mode serializes database operations on one host; it is not multi-master synchronization or an internet-hosted service. Some report labels cannot produce trustworthy balances because the app does not yet capture due dates, payment allocations, account classifications, or automatic accounting entries for challans. This remains a pilot application, not an accounting-validated replacement; use the current office system for official records until Windows testing and office acceptance.

The Java source and scripts remain available as a legacy reference (`./scripts/test.sh`, `./scripts/run.sh`); they are not used by the Electron installer. The current pilot instructions are in `HOME_WINDOWS10_PILOT.md` and `V1_RELEASE_PLAN.md`.
