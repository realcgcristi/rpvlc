# rpvlc

[![license](https://img.shields.io/badge/license-mit-6d5dfc?style=flat-square)](LICENSE)
[![node](https://img.shields.io/badge/node-18%2B-22c55e?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![vlc](https://img.shields.io/badge/vlc-2.x--3.x-f38020?style=flat-square&logo=vlc&logoColor=white)](https://www.videolan.org)
[![discord](https://img.shields.io/badge/discord-rich_presence-5865f2?style=flat-square&logo=discord&logoColor=white)](https://discord.com)
[![lastfm](https://img.shields.io/badge/lastfm-scrobbling-d51007?style=flat-square&logo=lastdotfm&logoColor=white)](https://www.last.fm)
[![platform](https://img.shields.io/badge/platform-linux_tested-ff8e72?style=flat-square&logo=linux&logoColor=white)](#rough-edges)
[![prs welcome](https://img.shields.io/badge/prs-welcome-22c55e?style=flat-square&logo=github&logoColor=white)](https://github.com/realcgcristi/rpvlc/issues)
[![made in romania](https://img.shields.io/badge/made_in-romania-002b7f?style=flat-square)](https://github.com/realcgcristi)

so this is rpvlc, a discord rich presence for vlc with a tui to drive it. i got tired of every "vlc rpc" project out there being two years old and half broken, so i built my own. it talks to vlc over the http interface, which is why it works with basically any vlc version (2.x through 3.x) and any discord client, including vesktop/vencord (it sniffs out the arrpc protocol those use and speaks it automatically).

it's a node cli. no build step, two runtime deps, runs on linux, windows and macos.

<p align="center">
  <img src="screenshot.png" alt="rpvlc tui" width="720" />
</p>

## what it does

- discord "listening to" activity with cover art, artist, album, and a live progress timer bar
- finds a running vlc on its own, or launches one for you with the http interface already on. if vlc is on a weird port it scans 8080 to 8090 until it finds it
- metadata: local file tags first, then filename parsing, then a provider lookup (itunes, deezer, musicbrainz, all keyless)
- smart matching so your songs don't show up as ai covers. title similarity, album/playlist hints, duration, and a second provider double checking the uncertain ones
- cover art gets cached locally so discord doesn't 404 when provider urls rotate out
- last.fm scrobbling with configurable thresholds
- a tui with now playing, progress, volume, recent tracks, live logs, and a settings overlay
- headless mode if you just want the rpc and no ui
- optional desktop notifications on track change
- album art rendered right in the terminal if you're on kitty

## install

```bash
git clone https://github.com/realcgcristi/rpvlc.git
cd rpvlc
npm install
npm start
```

or globally:

```bash
npm install -g .
rpvlc
```

needs node 18+ and vlc with the http interface (rpvlc turns it on itself when it launches vlc). vlc 4.x isn't supported since its http interface changed, and if the http interface won't turn on at all, check that your vlc build actually ships the lua scripts. some distro packages strip them out.

## usage

```
rpvlc [options]

options:
  --port <n>        vlc http port (default: from config or 8080)
  --password <s>    vlc http password (default: from config)
  --provider <p>    metadata provider: itunes, deezer, musicbrainz
  --no-rpc          disable discord rpc
  --headless        no tui, just rpc in the terminal
  --debug           verbose logging
  --version         print version
  --help            this message
```

## keys

| key | action |
|-----|--------|
| `p` / `space` | play/pause |
| `n` | next track |
| `b` | previous track |
| `←` / `→` | seek -10s / +10s |
| `↑` / `↓` / `[` / `]` | volume |
| `r` | toggle shuffle |
| `t` | toggle repeat |
| `s` | settings |
| `l` | launch vlc |
| `q` | quit |

## settings

press `s` in the tui. everything saves instantly to `~/.config/rpvlc/config.json`.

- **provider**: which metadata provider to prefer (itunes, deezer, musicbrainz)
- **local first**: prefer embedded file tags over provider lookup
- **art lookup**: search for cover art when none is embedded
- **notifications**: desktop notification on track change
- **accent**: tui color theme (mint, ocean, violet, ember, rose)
- **vlc password/port**: http interface credentials
- **discord client id**: your discord application id
- **lastfm**: connect, scrobble thresholds

## last.fm

1. create an api account at last.fm/api/account/create
2. in settings (`s`), enter your api key, api secret, username, password
3. select "lastfm connect" and rpvlc authenticates and stores the session key
4. scrobbling happens on its own from there based on your thresholds

defaults: min song duration 60s, scrobble after 60s listened or 50% of the song, whichever comes first. the floor per last.fm's own spec is 30s/30s/30%.

note: your last.fm api secret, password and session key are encrypted at rest in `config.json` (aes-256-gcm, key derived from your machine id, with a local key file as fallback). if you copy your config to another machine you'll need to re-enter them.

## how the metadata guessing works

1. **local tags**: if `local_first` is on and the file has embedded id3/vorbis tags, those win
2. **filename parsing**: tells apart `Artist - Title` from `<playlist> - <NNN> <title>` rips
3. **provider lookup**: searches your preferred provider and scores candidates by title similarity (the big one), album/playlist hint, artist, duration (breaks ties between songs with the same name), and provider ranking (real songs rank above ai covers)
4. **consensus**: for shaky matches it asks a second provider, and both have to agree on the artist
5. **art fallback**: if your preferred provider has no cover, it tries the other two

## config location

- linux/macos: `~/.config/rpvlc/config.json`
- windows: `%APPDATA%/rpvlc/config.json`

history: `~/.config/rpvlc/history.json`
art cache: `~/.cache/rpvlc/art/`

## run as a service (systemd)

```ini
# ~/.config/systemd/user/rpvlc.service
[Unit]
Description=rpvlc - discord rpc for vlc
After=graphical-session.target

[Service]
ExecStart=/usr/bin/node /path/to/rpvlc/src/index.js --headless
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
```

```bash
systemctl --user daemon-reload
systemctl --user enable --now rpvlc
```

## discord client id

rpvlc ships with a default client id (my app). to use your own:

1. go to discord.com/developers/applications
2. create an application
3. paste the application id into settings, "discord client id"

## rough edges

being honest since someone's gonna go looking

- developed and tested on linux only. windows and macos should work, the code paths are there, but nobody's actually tried them yet. if something's off there, open an issue and i'll take a look
- the metadata is a best effort guess for files with no tags. it's right most of the time but it's not magic
- blessed, the tui library, is ancient and unmaintained. it works, but i'm one weird terminal edge case away from problems
- the whole thing depends on vlc's http interface, which vlc 4.x messed with. hence the 2.x/3.x scope
- there's probably a race condition or two in the rpc reconnect path i haven't caught yet

if you find something broken, fair, open an issue and i'll probably fix it.

## license

mit, see [LICENSE](LICENSE)