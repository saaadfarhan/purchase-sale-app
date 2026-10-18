# SQLite deployment

SQLite is now the planned durable database for Purchase Sale Office. It is a good fit for a Windows 7 desktop installation because the database is one local file and does not require a server service. It is suitable for one operator or light shared use; it is not a replacement for a server database under heavy concurrent editing.

## Runtime dependency

The application expects the Xerial SQLite JDBC driver at runtime:

```text
org.sqlite.JDBC
```

The driver JAR must be placed on the application classpath. Choose a driver release that supports the Java 8 runtime used by the Windows 7 installation. Do not use the Debian JDK 24 installation as the production runtime.

## Database file

Use a writable application-data directory, for example:

```text
C:\Users\Public\PurchaseSaleOffice\data\purchase-sale.sqlite
```

Do not store the live database inside `Program Files`. Use `Files > Backup`; it creates a consistent dated snapshot in `backups` while the application is running.

SQLite is a single-office-file design. For multiple users, choose one authoritative office PC and let staff use that installation one at a time. Do not open independent copies and expect them to merge. Simultaneous multi-PC entry requires a server database or a future controlled import/export workflow.

## Synchronization policy

SQLite synchronization is not automatic. The safe initial policy is:

1. One authoritative database file per office installation.
2. A backup before upgrades or migrations.
3. No simultaneous editing of the same file from a network share.
4. If multiple computers are required, synchronize approved business documents through an explicit import/export process or move to a server database later.

The `SQLiteDatabase` class creates the initial schema. The production startup mode connects the account, item, bank, challan, voucher, and stock repositories to this adapter. Integration testing with the actual JDBC driver is still required before office rollout.

Run the local persistence smoke test with:

```bash
./scripts/test-sqlite.sh
```

This creates a temporary SQLite file, writes representative records, closes it, reopens it, verifies the records and stock, and removes the temporary file.

## Schema areas

The initial schema covers accounts, items, banks, challans, challan lines, vouchers, voucher lines, and stock movements. Tax, payments, cheques, users, audit history, and report-specific rules require additional approved fields.
