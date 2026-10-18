# Windows 7 / Windows 10 handover

## First, know which build you are handing over

The Debian development launcher still uses in-memory repositories. The Windows handover launcher now requests SQLite mode. In the Windows build:

- the SQLite JDBC driver must be present;
- the screen repositories use the SQLite database when startup succeeds;
- the build must still pass the close/reopen and backup/restore tests below before live use.

If startup reports that the SQLite driver is missing, do not use that build for live records.

## Recommended handover contents

```text
run.bat                      Windows launcher created by prepare-windows.bat
restore-windows.bat         Safe database restore helper
app/                          application JAR/classes
lib/sqlite-jdbc.jar           SQLite JDBC driver
jre/                          Java 8 runtime, if bundling one
data/                         writable database directory
backups/                      dated backup copies
README.txt                    operator instructions
```

Use Java 8-compatible application code and a Java runtime that supports Windows 7. The same build should run on Windows 10, but test both systems before delivery. A real `.exe` wrapper can be added later; `run.bat` is the honest launcher produced by this repository today.

## Installation steps

1. Run `scripts\prepare-windows.bat` from the source handover folder. It installs the application for the current user at `%LOCALAPPDATA%\PurchaseSaleOffice` and creates Desktop and Start Menu shortcuts.
2. The installed `data` folder is writable and contains `purchase-sale.sqlite` after first launch.
3. The installed `lib` folder contains the SQLite JDBC driver and the launcher includes it in the classpath.
4. Start the Desktop or Start Menu shortcut and create a test account, item, opening balance, purchase, sale, and voucher.
5. Close and reopen the application. Confirm the records remain. If they disappear, the SQLite repositories are not connected and the build is not ready for live use.
6. Test printing, backup, `restore-windows.bat`, and the reports used by the office.

If the extracted folder is under a path containing spaces, that is supported. The build script quotes every Java source path. If an older ZIP reports `javac: invalid flag` and the path contains spaces, replace it with the latest handover ZIP and rerun the script with the application closed.

The Debian-side equivalent smoke test is `./scripts/test-sqlite.sh`; it is evidence that the repositories persist records with the supplied driver, but it does not replace Windows testing.

## What SQLite synchronization means here

SQLite is a local database file, not a synchronization service.

Safe initial deployment:

- one authoritative database file on one office computer;
- regular backups using `Files > Backup`;
- no simultaneous editing of the same file from multiple computers or a network share.

If two computers must work independently, they need an explicit export/import process with conflict handling. Copying both database files back and forth is unsafe and can lose records. If many users need live concurrent access, use a server database instead of shared SQLite.

## Release 1 parallel-pilot model

This first release is intended to run beside the office’s current software. The current software remains authoritative for official work while this application is tested with a separate clean SQLite database.

Do not connect this application to the current software’s database, overwrite official records, or treat guessed tax/report results as official until the office reviews them.

## Backup and restore test

1. Open `Files > Backup` while the application is running.
2. Confirm a dated `backups\purchase-sale-YYYYMMDD-HHMMSS.sqlite` file appears.
3. Keep the live `data\purchase-sale.sqlite` unchanged.
4. Close the application.
5. Run `scripts\restore-windows.bat backups\purchase-sale-YYYYMMDD-HHmmssSSS.sqlite`.
6. The script creates `backups\before-restore.sqlite` before replacing the live database.
7. Start the application, choose Files > Verify Database, and confirm the restored records.

SQLite is not a multi-user server. For the first revision, designate one office PC as the authoritative database machine. Other users must not maintain separate live copies expecting automatic merge. If simultaneous entry becomes necessary, plan a server database migration rather than sharing the SQLite file over a network folder.

Never test restore by overwriting the only live database.

## Minimum acceptance test

The handover is not accepted until an operator can:

- create and update an account, item, and bank;
- create a parent and child account;
- enter opening stock;
- post a multi-line purchase;
- post a sale and see insufficient stock rejected;
- post a balanced voucher;
- close and reopen without losing data;
- restore a backup;
- run the office's required reports;
- repeat the test on Windows 7 and Windows 10.
