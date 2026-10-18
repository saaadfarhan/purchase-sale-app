# Purchase Sale Office user stories

These stories turn the screenshots into testable workflows. They are provisional: the screenshots show the screens, but not every business rule.

## Actors

- **Office operator**: enters purchases, sales, payments, stock, and vouchers.
- **Accountant**: maintains the chart of accounts and checks reports.
- **Manager**: reviews profitability and stock movement.
- **Administrator**: manages users, rights, backups, and the SQLite database file.

## Clean-start walkthrough

Use this sequence to test the empty application:

1. Open the application. The dashboard should show zero transactions and no seeded accounts.
2. Open `Masters > Chart of Account`.
3. Add account code `1`, description `Assets`, then save it.
4. Select `Assets` in the account tree, choose `Add Subaccount`, enter account code `1101` and description `Cash`, then save it. Verify that Cash appears beneath Assets.
5. Open `Masters > Items`.
6. Add item `WIRE-001`, description `Copper Wire`, unit `MTR`, purchase rate `100`, sale rate `125`, and stock type `Regular`. Verify it appears in the Items table.
7. Open `Transactions > Purchase Challan`.
8. Enter challan number `P-001`, date `2026-10-17`, party `Test Supplier`, and location `Main`. Add one or more item lines with item code `WIRE-001`, quantity `10`, and rate `100`, then choose `Post Challan`. Verify the total and stock-updated status.
9. Open `Transactions > Sale Challan`.
10. Enter challan number `S-001`, date `2026-10-17`, party `Test Customer`, and location `Main`. Add a line for `WIRE-001`, quantity `3`, and rate `125`, then choose `Post Challan`. Verify the sale succeeds and a sale larger than the remaining stock is rejected.
11. Open `Reports > Item Profitability Report` and verify the report can filter by the item and date range.
12. Open `Reports > Transit` and choose `Preview Report`; verify the session's stock movements appear.

## Master data

### Create an account

As an accountant, I want to create a main or sub-account so that transactions can be posted to the correct ledger.

Acceptance checks:

- Account code is required and unique.
- Description is required.
- `Parent Account` defaults to `(Top-level account)`.
- A sub-account can be created by selecting an existing parent in the selector or selecting a tree node first.
- A sub-account cannot be saved without an existing parent.
- `Add Top-Level Account` resets the parent selection to the root level.
- Saving refreshes the account tree.
- If the same code and same parent/name arrive twice, the duplicate is ignored safely.
- If the same code contains different account details, the new account receives the next unused numeric code above the requested code (`1101` conflict tries `1102`, then `1103`), and the status bar reports the new code.
- Selecting an account loads its editable details.
- `Update Account` changes the selected account without creating a duplicate.
- `Delete Account` removes an account only when it has no child accounts.

### Create an item

As an operator, I want to define an item with a unit, stock type, and rates so that purchase and sale rows can reference it.

Acceptance checks:

- Item code is unique.
- Quantity and rates are numeric and non-negative.
- The item appears in the Items table and can be referenced by item code in purchase, sale, transfer, and opening-balance workflows.
- Selecting an item loads its editable details.
- `Update Item` changes the selected item.
- `Delete Item` removes the selected item from the current session.

### Maintain a bank

As an accountant, I want to record bank details and an opening balance so that payments can be reconciled.

Acceptance checks:

- Bank code and bank name are required.
- Bank code is unique.
- Opening balance cannot be negative and defaults to zero when left blank.
- Saving a bank adds it to the Bank table.
- The saved bank becomes available in Cheque Detail's bank selector.
- Duplicate bank codes are rejected.
- Selecting a bank loads its details for `Update Selected Bank` or `Delete Selected Bank`.

## Inventory workflows

### Set opening stock

As an operator, I want to enter starting quantity and rate by location so that the first stock report has a known baseline.

Acceptance checks:

- Item Code, Location, Opening Quantity, and Opening Rate are visible with clear labels.
- Selecting an Item Code fills Opening Rate from the item's Purchase Rate and makes the rate read-only.
- The form accepts a clean-start opening-balance entry and saves the opening stock movement.

### Transfer stock

As an operator, I want to transfer quantity from one location to another so that each location's stock remains accurate.

Acceptance checks:

- Source and destination locations are required and cannot be identical.
- Transfer quantity is positive.
- Source quantity cannot become negative.
- The available quantity refreshes after the transfer.
- The transfer appears in transit/history reporting once report persistence is implemented.

### Purchase challan

As an operator, I want to record received items from a party so that stock increases and the purchase amount is known.

Acceptance checks:

- Challan Number and Challan Date are available as header fields.
- Party choices are accounts under the Chart of Accounts parent named `Party`, plus `Cash in Hand`.
- Location offers values already used by stock movements and accepts a newly typed location.
- Add a row to the challan table for each item; choose its Item Code and enter its Quantity directly in the table.
- The Rate is filled from the selected item's Purchase Rate and is read-only.
- Amount equals quantity multiplied by rate.
- Use `Add Item Row` to add multiple editable lines, review `Total Amount`, remove mistakes with `Remove Selected Line`, then post the complete document.
- Debian demo mode holds challans in memory; Windows production mode stores them in SQLite when the JDBC driver is installed and startup succeeds.

### Sale challan

As an operator, I want to record sold items to a party so that stock decreases and sales revenue is known.

Acceptance checks:

- The sale cannot exceed available stock at the selected location.
- Enter quantity in each table row; the Sale Rate, line amount, and total are derived from the selected item.
- Use `Add Item Row` to add multiple editable lines, review `Total Amount`, remove mistakes with `Remove Selected Line`, then post the complete document.
- A sale document is validated as a whole, including combined quantity for repeated item lines.

## Accounting workflows

### Journal voucher

As an accountant, I want to enter balanced debit and credit lines so that the ledger remains mathematically consistent.

Acceptance checks:

- At least one debit and one credit line exist.
- Total debit equals total credit before saving.
- Voucher Number, Voucher Date, Account, Narration, and Reference fields are available.
- `Post Voucher` validates and retains the voucher during the session; SQLite persistence and account-ledger posting remain pending.

### Search payment

As an accountant, I want to filter payments by date, account, cheque, or amount so that I can investigate a transaction quickly.

## Reports and administration

### Dashboard

As a manager, I want to see today's sales, purchases, receivables, payables, stock alerts, and recent activity so that I know what needs attention.

Acceptance checks:

- The dashboard shows a time-based greeting such as `Good morning`, `Good afternoon`, or `Good evening`.
- The dashboard shows the current weekday, date, and time.
- The clock refreshes while the application remains open.
- Quick actions remain visible when the window is narrowed.

### Windows handover

As an administrator, I want clear installation and backup instructions so that the program is not mistaken for a durable database application before persistence is verified.

Acceptance checks:

- The handover identifies the Debian in-memory demo mode and the Windows SQLite production mode.
- It explains the Java runtime, SQLite JDBC driver, writable data folder, database file, and backup folder.
- It explains that SQLite is local-file storage, not automatic multi-computer synchronization.
- It includes a close/reopen persistence test and a backup/restore test.
- The same acceptance workflow is run on Windows 7 and Windows 10.

### Git-like document synchronization

As an administrator, I want business operations to be exchanged safely between installations so that I can synchronize work without merging or copying live SQLite files.

Acceptance checks:

- Each synchronized operation has a stable operation ID and origin device.
- Importing the same operation twice does not duplicate a record.
- Posted sales, purchases, vouchers, and stock movements are immutable; corrections create reversal documents.
- Conflicting master-data edits are shown for resolution instead of silently overwriting either side.
- A backup exists before import or conflict resolution.
- A first deployment can operate with one authoritative SQLite file while synchronization remains disabled.

### Profitability reports

As a manager, I want company-level and item-level profitability reports filtered by date and location so that I can compare performance.

### User rights

As an administrator, I want to grant menu permissions per user so that operators only access the work they are responsible for.

### Backup

As an administrator, I want to back up the SQLite database before risky work so that data can be restored after a failure.

Acceptance checks:

- Files > Backup creates a dated SQLite snapshot automatically in the application `backups` folder.
- The live database is not overwritten by the backup action.
- The status bar reports the created backup or a clear failure.

### SQLite database

As an administrator, I want the application to use a local SQLite file so that the Windows desktop installation does not require a database server.

Acceptance checks:

- The planned database file uses `.db`, `.sqlite`, or `.sqlite3`.
- The application creates the initial schema when the SQLite adapter is available.
- The database is stored in a writable application-data folder, not beside protected program files.
- A single workstation is the default supported deployment.
- Multi-computer synchronization is treated as an explicit import/export or server-database problem, not unsafe shared-file editing.
- The SQLite JDBC driver and Java runtime are selected for Windows 7 compatibility and tested on Windows 10 as well.

### User manual

As a new operator, I want an in-app manual so that I can understand the clean-start workflow without relying on the original office staff.

Acceptance checks:

- Help > User Manual opens the manual.
- The manual is an operator and administrator reference with manpage-style sections for overview, accounts, inventory, transactions, reports, toolbar commands, administration, and troubleshooting.
- The manual explains prerequisites, fields, workflows, validation failures, Wayland/Sway startup, SQLite backup, and prototype limitations.
- The manual distinguishes working prototype behavior from pending production behavior.

### Clear action labels

As an operator, I want buttons to name the object and action they affect so that I can work without guessing which record will be changed.

Acceptance checks:

- Master screens use labels such as `Save Account`, `Save Item`, and `Save Bank`.
- Transaction screens use labels such as `Post Challan`, `Validate Voucher`, `Search Payments`, and `Transfer Quantity`.
- Report screens use `Preview Report`, `Print Report`, and `Export Report`.
- Table controls use `Add Row`, `Delete Row`, `Save Table`, and `Clear Table`.
- Home quick actions use clear destinations such as `Record Sale`, `Record Purchase`, and `Manage Accounts`.

### Troubleshooting a clean installation

As a new operator, I want the manual to explain empty screens and common validation errors so that I can distinguish a clean installation from a broken application.

Acceptance checks:

- The manual explains that empty tables are expected before records are created.
- It explains insufficient-stock, unknown-item, unbalanced-voucher, and missing-bank situations.
- It explains that Debian demo data is cleared when the application closes and that Windows SQLite mode must pass the close/reopen test.

## Screenshot-confirmed report catalog

The Reports menu in the supplied screenshot explicitly names these reports:

- Ledger
- Purchase Report Date Wise
- Trial Balance
- Trial Balance Date Wise
- Stock Report Date Wise
- Stock Report Item Wise
- Voucher
- Post Dated Cheques
- Returned Cheques
- Aging Report
- Receivable
- Item Ledger
- Party Item Detail
- PC Profit Report
- Type Wise Item Report
- OS Cheques
- Party Activity Report

The prototype provides screens and report-specific columns for all of these. Stock movement, purchase/sales register, voucher, and general-ledger preview rows are now generated from session data; other report calculations remain pending until SQLite repositories and accounting rules are implemented.

## Current prototype behavior

Implemented now:

- Clean-start empty account repository.
- Account code and description validation and in-memory save.
- Parent Account selection for root and nested accounts, with tree refresh after save.
- Clean-start item repository with item validation and in-memory save.
- Opening balances update session inventory and appear in movement reports.
- Purchase challans support headers, multiple staged lines, totals, duplicate-number checks, and stock increases.
- Sale challans support headers, multiple staged lines, totals, whole-document insufficient-stock checks, and stock decreases.
- Failed challan validation leaves stock unchanged.
- Challan records are retained in the in-memory demo repository and have SQLite repository support in production mode.
- Vouchers are validated, duplicate-number checked, and retained in the in-memory demo repository with SQLite repository support in production mode.
- Stock, purchase/sales register, voucher, and general-ledger reports preview current session records.
- Stock transfer validates locations, quantity, and available stock.
- Journal Voucher validation rejects unbalanced debit and credit totals.
- Bank records are validated, saved, deleted, and exposed to Cheque Detail.
- Editable table rows with Add Row, Delete Row, Save Table, and Clear Table.
- Scoped action labels on master, transaction, report, dashboard, and table buttons.
- Screenshot-derived menus, report screens, toolbar, dashboard greeting/clock, Help manual, and SQLite-file backup copy.
- Manpage-style in-app Help manual with workflows and troubleshooting.
- SQLite database adapter seam and initial schema for accounts, items, banks, challans, vouchers, and stock movements.
- Dashboard greeting, live clock, and responsive quick actions.

Pending before production:

- Durable item, bank, voucher, challan, payment, and stock repositories.
- SQLite-backed repositories and synchronization/conflict rules.
- Full accounting posting, durable voucher/challan/stock history, tax, discount, receivables/payables, and profitability calculations.
- User authentication and enforced permissions.

## Unknowns to confirm later

- Whether a challan immediately posts accounting entries or requires a separate voucher.
- Whether purchase and sale use tax, discount, freight, or party-specific rates.
- Whether locations are warehouses, branches, or both.
- Whether one SQLite file is used by one computer or whether documents must be synchronized between several computers.
- Whether deletions are allowed or records are reversed through correcting vouchers.
- Whether opening balances should create an inventory transaction or only set an initial snapshot.
- Whether report preview, print, and export should produce PDF, spreadsheet, or printed output.
