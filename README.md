# Purchase Sale Office

Screenshot-derived desktop prototype for the legacy purchase/sale office.

## Run

```bash
./scripts/test.sh
./scripts/run.sh
```

With `lib/sqlite-jdbc.jar` present, run `./scripts/test-sqlite.sh` to verify real SQLite close/reopen persistence.

On a Windows JDK 8 machine, `scripts\prepare-windows.bat` creates a handover folder under `build-windows\PurchaseSaleOffice`. It does not download the SQLite JDBC driver; place a Java 8-compatible `sqlite-jdbc.jar` in `lib` first.

This first version starts clean and uses in-memory records for predictable workflow testing. The screens and menu are based on the supplied screenshots. The home page includes an operational dashboard, greeting, live clock, empty-state metrics, and workflow shortcuts. SQLite is the planned durable database; see [SQLITE_SETUP.md](SQLITE_SETUP.md).

Use the in-app `Help > User Manual` page, read [USER_STORIES.md](USER_STORIES.md) for workflows, and read [WINDOWS_HANDOVER.md](WINDOWS_HANDOVER.md) before installing on an office computer. The synchronization approach is documented in [SYNC_DESIGN.md](SYNC_DESIGN.md).

The first production revision is tracked in [V1_RELEASE_PLAN.md](V1_RELEASE_PLAN.md). Release 1 is a parallel pilot beside the current office software, not a one-step replacement. The normal Debian launcher remains an in-memory development mode; the Windows handover launcher explicitly selects SQLite mode and requires the JDBC driver. Close/reopen persistence still needs Windows integration testing.

## Java concepts used

- `class`: a named kind of object, such as `Account` or `Main`.
- `List`: an ordered collection of values.
- `JPanel`: a visual container.
- `CardLayout`: switches between screens without opening many windows.
- `TableModel`: the data displayed by a Swing table.
- Repository: a small interface that hides where data comes from. Demo mode uses memory; the Windows pilot uses SQLite-backed repositories.
- Bank data is currently stored by `BankRepository` and is available to the Cheque Detail bank selector; durable SQLite persistence is a deployment task.
