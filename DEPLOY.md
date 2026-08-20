# Putting the shared world online

The live link is static hosting. It serves the game and nothing else — no
WebSockets, ever. The shared world needs a room process somewhere, and the page
needs to be told where that is.

Everything below is already in the code. What is left is an account somewhere
that runs a container, and three commands.

## What the room needs

| | |
|---|---|
| runtime | Node **22.5+** (`node:sqlite` is a built-in, and it did not exist before) |
| dependencies | none — the game has zero, and so does the server |
| build step | none |
| disk | one small volume for `veloria.db` |
| ports | one HTTP port; the same port serves the WebSocket upgrade |

## Environment

| variable | default | what it does |
|---|---|---|
| `PORT` | `8123` | HTTP and WebSocket |
| `VELORIA_DB` | `./data/veloria.db` | accounts, characters, depth records |
| `VELORIA_ORIGINS` | *(empty)* | comma-separated list of sites allowed to reach the room from a browser |
| `ROOM_MAX` | `50` | players per room — the number that was measured, not guessed |
| `RESPAWN_SEC` | `45` | how long the fallen stay down |

`VELORIA_ORIGINS` is the one you must not forget. Without it a browser on any
other address is refused — both the sign-in requests and the socket. With it,
only the sites you name get through; there is no wildcard and there will not be
one, because a wildcard means any page on the internet can open sockets into
your room and keep its own bots there.

## Deploy

Any host that runs a container works. Fly.io is used below because it gives a
persistent volume and TLS without extra parts; Railway, Render and a plain VPS
take the same three steps.

```bash
fly launch --no-deploy --name veloria
```

```bash
fly volumes create veloria_data --size 1 && fly secrets set VELORIA_ORIGINS=https://therealden4700.github.io
```

```bash
fly deploy
```

Then point the page at it. In [`index.html`](index.html):

```html
<meta name="veloria-server" content="https://veloria.fly.dev">
```

Commit that and the live link joins the shared world. Leave it empty and the
game runs single-player against nothing — which is the honest fallback, not a
failure.

## Checking it without guessing

```bash
node tools/cross-origin-check.js 3000
```

Fifteen checks: that the page can work out where the room is, that a named site
gets a preflight answer and a permission header, that an unknown site gets
neither, and that the socket refuses strangers while still letting the stands in.

The room must be up with the origin you are testing:

```bash
PORT=3000 VELORIA_ORIGINS=https://therealden4700.github.io node server/server.js
```

To try the whole thing locally, serve the page from one port and the room from
another — that is exactly the split that production has, and it is the only way
to see it work before it is live.

## What the room stores about a player

Three things, and nothing else: the wallet address (as the primary key), when
they first and last signed in with how many logins, and the hero the world keeps
for them. Guests are stored as nothing at all — they have no address, so there
is nowhere to write.

Players are told this on the entry screen, before they sign in rather than after.
A player can delete all of it at any time:

```bash
curl -X POST https://veloria.fly.dev/account/forget -H 'content-type: application/json' -d '{"token":"<their session token>"}'
```

The token proves it is their own account — an address alone would let anyone
erase anyone's hero. Deletion removes the account row, the character and every
session; it does not mark anything deleted, because marked-as-deleted is still
stored. They are disconnected from the world first, or the room would write the
hero back with its next save and undo it.

## Two things to know before you go live

**Stopping is not free.** The room writes characters every eight seconds, so a
deploy used to cost everyone in the world up to eight seconds of play — a killed
guardian, a picked-up legendary, a handed-in quest. `SIGTERM` now writes
everyone first, then says goodbye, then closes the database. Any host sends
`SIGTERM`; all of them allow the second it takes.

**Sign-in text names the site, not the machine.** The message a player signs in
their wallet carries the domain they can see in their address bar, not the host
the room happens to run on. A player confirms a sign-in to a site they know —
that is the whole point of signing readable text instead of opaque bytes.
