I need one decision from you: the token lifetimes.

I suggest 15 minutes for the access token.
I suggest 7 days for the refresh token.

## Plan

Move login from server sessions to JSON web tokens (JWTs).
Four phases, 7 days in total.

| Phase | Work                                     | Time   |
|-------|------------------------------------------|--------|
| 1     | Issue tokens next to the session cookie  | 2 days |
| 2     | API middleware accepts either credential | 1 day  |
| 3     | Move the client over                     | 3 days |
| 4     | Retire the session table                 | 1 day  |

Phase 3 is the largest. It has two extra tasks:

- Change the user store in a few places.
  It uses an object-to-table mapper (ORM).
- Change the cache rules on the content network (CDN).
  They must keep the `Authorization` header.

## Risk

About 1,200 active users will be logged out at cutover.
Their sessions cannot be turned into tokens.

## Rollback

The whole change sits behind the `AUTH_JWT` flag.
To roll back, turn the flag off.
