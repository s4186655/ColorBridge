# ColorBridge website

A simple local marketing/account page for the extension. No server-side
database — the "backend" is two hardcoded accounts and `localStorage`.

## Run

```bash
cd website
node server.js
```

Open http://localhost:5500. The port is fixed on purpose — see
[How the Pro link works](#how-the-pro-link-works) below.

## Demo accounts

| Email | Password | Tier |
|---|---|---|
| `free@colorbridge.app` | `free1234` | Free — 10 analyses / 24h |
| `pro@colorbridge.app` | `pro1234` | Pro — unlimited |

Both are also available as one-click buttons on the sign-in form.

## Editing the empty section

`index.html` has a **"What is ColorBridge?"** section left intentionally
empty (a dashed placeholder box) for you to write yourself. It's marked with
a `<!-- TODO -->` comment.

## How the Pro link works

The extension does **not** talk to this website over the network — there is
no account server. Instead, `extension/content/accountSync.js` is a content
script that runs *only* on `http://localhost:5500/*` (see the second entry in
`extension/manifest.json`'s `content_scripts`). It reads this site's own
`localStorage` session every ~1.5s and copies just the tier
(`free`/`pro`/signed-out) into `chrome.storage.local`.

`usageTracker.checkQuota()` in the extension checks that value: if it's
`"pro"`, the 10-per-day limit is lifted. Everything else about the account
(name shown in the header, the upgrade box, sign-out) is purely cosmetic and
never reaches the extension.

Practical effect: sign in with the Pro demo account on this site, in the same
browser as the extension, and unlimited analyses turn on within ~2 seconds.
Sign out (or use the Free account) and the normal 10/24h limit is back.

If you move the site to a real domain later, update the `matches` pattern in
`extension/manifest.json`'s second `content_scripts` entry to that domain.
