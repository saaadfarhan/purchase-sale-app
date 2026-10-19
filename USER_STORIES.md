# Purchase Sale Office pilot stories

These are test scripts for the current Electron + SQLite application. They describe implemented assumptions, not verified office policy. Use only artificial records until an office representative approves the workflows. Keep the existing software authoritative.

## 1. First launch and administrator

As the administrator, I want to configure the company and access rights so that office users can work under the correct identity.

Acceptance checks:

- First launch lets me create a local administrator account; password must be at least eight characters.
- Company Profile requires a company name and accepts address, phone, fiscal year, and an optional supported image path.
- Saving the profile updates the dashboard and print headers.
- Company profile changes and Database Tools are available to administrator accounts with User Rights.
- A non-administrator cannot open the company editor or save a company-profile change.
- I can create an operator account, give it limited pages, log out, and verify its access is restricted.

## 2. Masters and opening stock

As an operator, I want linked account, item, stock-type, and bank masters so that transaction forms use existing records rather than mistyped codes.

Acceptance checks:

- Chart of Accounts supports top-level and child accounts; generated IDs are read-only and increment safely.
- Items require a valid Stock Type. Item rates are used by purchase/sale challans.
- Banks can be maintained for cheque workflows. A bank is not automatically a cash account and bank reconciliation is not implemented.
- Opening Balances uses an existing item, location, and positive quantity; its value is derived from the item's purchase rate.
- Referenced masters cannot be deleted when doing so would break stored transactions.

## 3. Purchase and sale

As an operator, I want multi-line challans to update stock consistently so that I can test receiving and issuing goods.

Acceptance checks:

- Purchase and sale challans have generated, disabled document IDs, a date, party, and location.
- Party choices use accounts under the `Party` account group, plus `Cash in Hand`.
- Item Code selections use existing Items; the rate is automatically derived and cannot be manually edited.
- I can add and remove several item lines before saving.
- Purchase increases stock; sale decreases it; a sale exceeding available stock is rejected without a partial save.
- A saved challan can be printed as a print-only business document with company heading/logo when configured.
- Editing a challan recalculates using current item-master rates. Confirm this behavior is acceptable before official use.

## 4. Vouchers, payments, and cheques

As an accountant, I want balanced entries and searchable payment records so that I can test the available accounting workflow.

Acceptance checks:

- Voucher and Journal Voucher require balanced debit and credit totals.
- Payment/Receipt creates a balanced two-line voucher using the selected party and cash/bank accounts.
- Saved vouchers can be edited, searched, and printed; their posting does not automatically settle challans.
- Cheque entries reference a bank and eligible party account, retain a check number and status, and appear in cheque reports.
- The payment mapping and cheque workflow are assumptions; they are not approved office accounting policy.

## 5. Reports, dashboard, and printing

As a manager, I want to inspect activity without mistaking provisional calculations for approved financial statements.

Acceptance checks:

- Dashboard greeting and clock update, company name is current, metric cards have visible spacing, and quick actions remain usable at narrower window widths.
- Ctrl+K searches permitted pages, loaded business records, report names, and common actions.
- Reports accept date/text filters and export CSV.
- Print Report opens a print-only A4 layout, not the application interface. Challan and voucher printouts also show the company identity and configured logo where available.
- Reports based on incomplete office rules are clearly described in the manual; compare results to authorized examples before relying on them.

## 6. Database protection

As an administrator, I want a restorable snapshot, a portable export, and a database check so that pilot data can be protected and inspected.

Acceptance checks:

- Create Backup produces a consistent SQLite snapshot while the application is open and records the action in the audit log.
- Export Office Data writes JSON business records to a user-selected path and does not include password hashes. It is not a restorable database.
- Verify Database checks SQLite integrity and foreign-key references and reports issues without modifying or repairing data.
- Close/reopen preserves test records. A restore test is performed only after closing the app and making a separate safety copy of the active database.
- The live SQLite database stays on one authoritative host PC. Clients use the host over HTTPS; they do not receive a database copy.
- Client operators configure the host address and verify its SHA-256 certificate fingerprint before sending credentials.
- Every operator signs in with an individual account. The host enforces permissions on data operations; an operator lacking the required page right is rejected even if they bypass the UI.
- The host must remain online. Offline writes and merging separate copies are not supported.
- The shared server is not exposed directly to the public internet; external access uses an office-approved VPN.

## 7. Windows 10 pilot acceptance

As the person preparing the pilot, I want to install and test the packaged Windows application before sharing it with the office.

Acceptance checks:

- Install and launch the Windows x64 Electron installer as a normal user; Java is not part of this stack.
- Verify first-run setup, access restrictions, close/reopen persistence, backup/restore, JSON export, database verification, and printing/PDF output.
- Run one purchase, one sale, one oversale rejection, one balanced voucher, and at least one report using artificial data.
- Record the Windows version, app version, results, and error text. Do not claim Windows 7 support or replace the office system based only on a Debian build.
- Defer tax rules, allocations, reconciliations, official document numbering/cancellation, and formal statement calculations until the office provides and approves the rules.
