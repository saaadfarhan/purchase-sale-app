# Windows 10 pilot and office handoff

This is a clean, parallel pilot. Keep the office's existing system as the official record. This Electron app creates its own SQLite database; do not connect it to Access, Oracle, or the existing application's files.

## 1. Build the Windows installer

The dependable path is to build on a Windows x64 computer. Copy the project source there (not the app's live database), install Node.js 24 and pnpm, open a terminal in the project directory, then run:

```powershell
corepack enable
pnpm install --frozen-lockfile
pnpm test
pnpm package:win
```

The Windows x64 NSIS installer is generated under `build-electron/`. Install and test that exact `.exe` on Windows before handing it to the office; do not send the `dist/` web files as if they were a desktop installer. Debian can cross-build Windows packages, but electron-builder needs Wine for the NSIS installer and the SQLite native module must be packaged for Windows. The current workspace does not have Wine or Docker configured, so a Debian Windows package has not been verified here.

## 2. Install on the Windows 10 test computer

1. Transfer the generated setup `.exe` to the Windows computer.
2. Run it as the intended Windows user and follow the installer prompts. Java is not required; the app uses its bundled Electron runtime.
3. Launch Purchase Sale Office from its installed shortcut.
4. On the designated host PC, first create the administrator with a unique password and complete Company Profile. Company name is required; address, phone, fiscal year, and optional logo are used in print headers.
5. The local database is stored at:

   ```text
   %LOCALAPPDATA%\PurchaseSaleOffice\data\purchase-sale.sqlite
   ```

   Database backups are written to the adjacent `backups` directory. Do not move, share, or open the live database with another program while the app is running.

## 3. Enable shared office access

1. Keep the database on the designated host PC. In **User Rights**, create an individual account for every operator and grant only the necessary pages. Do not share the administrator's account or session.
2. On the host, open **Database Tools** and choose **Start shared office server**. The host displays one or more HTTPS addresses and a SHA-256 certificate fingerprint.
3. Give each client operator the selected HTTPS address and fingerprint through a separate trusted channel. The fingerprint lets each client verify the host before sending sign-in details.
4. Install the same app release on each client PC. At sign-in, expand **Connect to a shared office**, enter the address and fingerprint, and connect. The operator then signs in using their own username and password.
5. On Windows, allow the app through Defender Firewall only on the **Private** network profile. If the host isn't reachable, check that both PCs are on the same trusted office LAN and that the host app/server is running. Do not create an internet port-forward rule; use an office-approved VPN for any remote access.
6. Keep the host PC on and connected while clients are working. All writes go to the host database. If the host goes offline, clients cannot continue with an independent copy or merge changes later.

## 4. Use a clean test workflow

Use clearly artificial test records and never copy live office data into the pilot without approval.

1. **Chart of Accounts:** create parent accounts before child accounts. Add a `Party` parent with supplier/customer test accounts; add cash/bank accounts needed for voucher tests. Generated codes are read-only.
2. **Items:** add one test item with unit, stock type, purchase rate, and sale rate. Confirm the item appears in challan selectors.
3. **Banks:** add a test bank only if exercising cheque entry.
4. **Opening Balances:** add a starting quantity at a test location.
5. **Purchase Challans:** create a multi-line purchase. Confirm selected item rates, total, saved row, and stock increase.
6. **Sale Challans:** sell within available stock, confirm the sale rate and stock decrease, then try an over-sale and confirm it is rejected.
7. **Voucher / Payment / Receipt:** post a balanced test entry. The current payment mapping is an assumption and must not be treated as official until the office confirms it.
8. **Reports:** apply a date/text filter, export CSV, and compare only against authorized examples. Several accounting reports are explicitly provisional or incomplete without office rules.
9. **Print:** print or save as PDF one challan, voucher, and report. Check page breaks, company header/logo, totals, and printer legibility.
10. **Administration:** update Company Profile as the administrator. Sign in with a non-administrator and confirm company editing is unavailable.
11. **Shared access:** from a client, post one test transaction. Confirm it appears after refresh on another client. Sign in as an operator without the relevant page right and confirm the host rejects their operation.

## 5. Test backup, export, and verification

Open **File → Database tools** or **Administration → Database Tools**:

- **Create backup now** makes a consistent SQLite snapshot in the local `backups` directory while the app is open. Copy the completed file to separate storage and record its location.
- **Export data as JSON** prompts for a destination. This readable business-data export omits password hashes, but it is not a restorable database.
- **Verify database now** runs SQLite integrity and foreign-key checks. It reports problems; it does not repair them.

For a restore test, close the app completely, copy the active database to a separate safety location, then replace it with a known-good `.sqlite` backup. Reopen and inspect records. Never perform this test on the only copy of valuable data. Confirm the app is closed before replacing the database file.

## 6. Close/reopen and record the result

1. Close the app normally and launch it again.
2. Sign in and verify the test company, accounts, items, stock, challans, vouchers, and audit events remain.
3. Run database verification again.
4. Record the Windows version, installer version, backup/restore result, print/PDF result, and any error text. Keep the old office system authoritative until the office reviews and accepts the test.

## Known release limits

- Shared mode supports multiple clients through one host process and one authoritative SQLite database. It is not offline multi-master sync; it queues no disconnected edits and merges no copies.
- Live SQLite data and local backups are not encrypted by the app. Use Windows account restrictions and BitLocker/device encryption on the host. A local administrator of the host PC can access its data outside the app.
- Do not claim Windows 7 support. Windows 10 is the intended pilot target, and the installer must still be tested on the actual Windows machine.
- Tax rules, payment-to-invoice allocation, bank reconciliation, official numbering/cancellation rules, and formal financial-statement formulas need office decisions.
- A successful Debian build is not a substitute for a Windows install, backup/restore, permission, and printer test.
