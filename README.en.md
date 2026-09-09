# QPlayer QQ Music source plugin

<p><a href="README.md">简体中文</a> · <b>English</b></p>

An independent, user-installed source plugin for QPlayer. It implements the public
QPlayer JavaScript plugin ABI (apiVersion 1.0) and keeps all QQ Music endpoints,
request transforms, login handling and credentials outside QPlayer core.

This project is not affiliated with, endorsed by or partnered with Tencent or QQ
Music. It distributes no audio, account credentials or copyrighted media. Users are
responsible for complying with the service terms and local law.

## Features

| Capability | Notes |
|---|---|
| `searchSongs` | song search (mobile endpoint, works anonymously) |
| `songDetails` | details by songmid |
| `playlistDetails` | playlist details and tracks, paged; private playlists need login |
| `artistDetails` / `albumDetails` | artist and album details |
| `home` | recommended playlists; uses `PlaylistSquare/GetRecommendFeed` when signed in |
| `userPlaylists` | own playlists (including Favourites) and followed playlists |
| `like` | read and update the Favourites list |
| `playlistMutation` | create/delete playlists, add/remove songs, follow/unfollow |
| `resolveStream` | M800/M500 MP3 stream URLs, **requires login** (anonymous vkeys were restricted from 2026) |
| `lyrics` | plain LRC, works anonymously |
| `login` / `account` | web login (QQ/WeChat), WeChat QR, pasted cookie |

The settings page also carries a plugin-owned **source unlock** switch: when a track
is unplayable on QQ Music, it attempts to match a stream URL from another source.
The entry is declared by the plugin and rendered by QPlayer.

Two implementation notes: write endpoints (favourites, playlist edits) must send
`ct=26` in `comm` — `ct=24` is rejected by the server with `80105`/`1101` — and the
parameter is the camel-cased `dirId`, with Favourites fixed at directory 201.

The public ABI and package format are documented in the
[QPlayer plugin template](https://github.com/TIMER-err/qplayer-plugin-template/blob/main/docs/ABI.en.md).

## Login

Stream resolution requires login. Any of three methods:

- **QQ / WeChat login** — the official QQ Music login page opens in-app and
  `qm_keyst` is captured on completion.
- **WeChat QR** — confirm with WeChat to sign in to the linked QQ Music account.
- **Pasted cookie** — take the cookie containing `musickey`/`qm_keyst` from the QQ
  Music client or website request headers and paste it in.

The plugin extracts only the fields needed for playback and account display and
stores them through QPlayer's namespaced encrypted vault; vkey requests use the real
uin and musickey. Cookies must not be committed to source, issues, logs or build
artifacts.

## Build

Produce an unsigned development package:

```bash
./scripts/package.sh
python3 scripts/verify-package.py dist/*.qplug
```

The default output is unsigned and intended for local development and manual import
testing; QPlayer shows a security warning for untrusted code packages. Import the
generated `.qplug` from **Settings → Source plugins** in QPlayer.

Release builds are signed with a P-256 key kept outside the repository:

```bash
QPLAYER_PLUGIN_SIGNING_KEY=/secure/path/publisher-private.pem ./scripts/package.sh
```

`publisher-key.pub` is the publisher public key pinned by QPlayer's built-in source
list and cannot be changed; the signing key exists only in the maintainer's offline
backup and the repository secret.

## Releasing

Pushing a `v<version>` tag matching the version in `plugin.json` triggers the release
workflow, which signs, verifies and creates a GitHub Release. QPlayer reads the
installable version from this repository's latest release, so the release must carry
exactly one `.qplug` and must not be a draft or pre-release.

## Lyrics

The QQ lyrics endpoint currently returns plain LRC, which the plugin uses directly.
`src/qrc.js` is a pure-JS decryptor for QRC-encrypted lyrics (custom S-box 3DES plus
zlib inflate); it is currently unused and kept in reserve.

The package is distributed independently and is neither bundled into nor hosted by
QPlayer. QQ Music is a trademark of its respective owner.
