Postgres is not running. Start it:

```sh
brew services start postgresql@16
```

Then check it:

```sh
pg_isready
```

You should see "accepting connections".

## Why

The error is `ECONNREFUSED 127.0.0.1:5432`.
It means nothing is listening on the default Postgres port.

The `postgresql@16` service did not start after your reboot.
This is not a bug in the app code.

Your `.env` is fine.
`DATABASE_URL` points at localhost:5432, which is the right place.

## If it still fails

Read the Postgres log:

```text
/opt/homebrew/var/log/postgresql@16.log
```

A second Postgres may be holding port 5432. See what has it:

```sh
lsof -i :5432
```
