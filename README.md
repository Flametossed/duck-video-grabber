# Duck Video Grabber

A simple Windows app for downloading videos from the web. Paste a link, pick a quality, download.

It is a desktop front end for [yt-dlp](https://github.com/yt-dlp/yt-dlp), so it works with the same sites yt-dlp supports. It also looks after itself: the app installs and updates yt-dlp, ffmpeg and Deno on its own, and undoes an update that breaks things.

## Features

- **Paste and look up**: paste a link (or right-click the link box and choose **Paste and look up**) to see the title, uploader, length and thumbnail
- **Quality presets**: Best, 1080p, 720p, 480p, or Audio (MP3). Sizes the video doesn't have are greyed out
- **Subtitles**: a checkbox, on by default, that saves subtitles inside the video and as an `.srt` file next to it
- **Download queue**: two downloads at a time, with progress, speed, time left, cancel and "show in folder"
- **Cookies** for sign-in-only videos, read from your browser or a `cookies.txt` file
- **Self-maintaining tools**: yt-dlp, ffmpeg and Deno are installed and kept up to date automatically, checked against their publishers' checksums, and rolled back if an update fails a self-test
- **Dark theme**, with an AMOLED true-black option

Windows 10 or 11, 64-bit.

## Build it yourself

### What you need

- **Windows 10 or 11** (64-bit)
- **[Node.js](https://nodejs.org/) 20 or newer** (the LTS version is fine). npm comes with it
- **[Git](https://git-scm.com/)**, to clone the repository
- An internet connection: `npm install` downloads Electron, and the app downloads its tools on first run

You don't need to install yt-dlp, ffmpeg or Deno yourself. The app does that.

### Steps

Open PowerShell or Command Prompt and run:

```powershell
git clone https://github.com/Flametossed/duck-video-grabber.git
cd duck-video-grabber
npm install
```

To run the app straight from the source:

```powershell
npm start
```

To build the installer and the portable exe:

```powershell
npm run dist
```

This takes a minute or two and writes two files to the `dist` folder, each about 76 MB:

| File | What it is |
| --- | --- |
| `Duck-Video-Grabber-Setup-<version>.exe` | Installer. Installs for the current user only (no admin rights needed), lets you choose the folder, and adds Start menu and desktop shortcuts. Settings and tools are kept in `%APPDATA%\Duck Video Grabber` |
| `Duck-Video-Grabber-<version>-portable.exe` | Portable app. A single file you can run from anywhere, including a USB stick. It keeps its settings and tools in a `Duck Video Grabber Data` folder next to the exe, so move that folder along with it |

`dist\win-unpacked\` also contains the unpacked app, which you can run directly for testing.

### First launch

On first launch the app downloads yt-dlp, ffmpeg and Deno (about 160 MB in total) into its data folder. You can watch this happen in **Settings > Tools**. It takes under a minute on a typical connection.

The builds are not code-signed, so Windows SmartScreen will say "Windows protected your PC" the first time you run them. Choose **More info**, then **Run anyway**.

### If something goes wrong

- **`npm run dist` seems to hang at the portable step:** close any copy of the app that is running from the `dist` folder. Windows locks a running exe, and the build waits until it is free
- **`npm start` fails because Electron is missing:** newer versions of npm may skip Electron's download step during install. Run `node node_modules/electron/install.js`, then try again
- **`npm start` fails with "Cannot read properties of undefined":** the `ELECTRON_RUN_AS_NODE` environment variable is set in your terminal (some editors set it). Remove it, or start the app from a fresh PowerShell window

## How it works

### Tools: yt-dlp, ffmpeg and Deno

The app keeps its own copies of three programs in its data folder:

- **yt-dlp** finds and downloads the video
- **ffmpeg** merges video and audio, makes MP3s and embeds subtitles
- **Deno** is a JavaScript runtime that yt-dlp needs to solve YouTube's checks

The app never modifies programs installed elsewhere on your PC. If one of them is already on your `PATH` and up to date, the app uses it instead of downloading its own copy.

In **Settings > Tools**:

- **Auto-update** (on by default): checks when the app starts and every 12 hours, and installs newer versions by itself. A missing or broken tool is reinstalled right away
- **Versions**: what's installed. If an older version is available, a **Go back to…** link switches to it (and **Switch to…** switches forward again)
- **Check now**: installs anything newer, even with auto-update off
- **Force update**: downloads and reinstalls the latest of all three
- **Self-test**: looks up a stable YouTube video using the tools exactly as the app does, to prove everything works

Updates are made safely:

1. yt-dlp and Deno come from their official GitHub releases, and ffmpeg from [gyan.dev](https://www.gyan.dev/ffmpeg/builds/). Every download is checked against the publisher's SHA-256 checksum
2. The new program must pass a real test before it is installed: yt-dlp reports its version, ffmpeg encodes a second of audio to MP3, and Deno runs a script
3. The previous version is kept as a backup
4. After yt-dlp or Deno changes, the app runs the self-test. If the new versions fail and the old ones pass, the update is rolled back, and that release is skipped until a newer one comes out. If both fail, the network is the likely cause, so the update stays

Files are swapped by renaming them, which Windows allows even while a program is running, so a download in progress is never interrupted.

If a lookup or download fails in a way that usually means a site has changed (for example "Unable to extract", missing formats, or HTTP 403), the app updates yt-dlp and Deno and tries once more. It does this at most once an hour, and only while auto-update is on.

### Subtitles

The **Subtitles** checkbox is next to the quality buttons and is ticked by default. Subtitles come in your preferred language (**Settings > General > Preferred language**, which defaults to your Windows display language), or in English if the video doesn't have that language. Hover over the checkbox to see which language a video will get.

- Subtitles go inside the video (you can turn them on in any player) and into an `.srt` file next to it
- Human-made subtitles are preferred over auto-generated ones. YouTube's machine-translated tracks are skipped
- A subtitle that fails to download never fails the video. The download then shows "subtitles could not be saved"
- Not used for Audio (MP3)

### Cookies

Some videos (age-restricted, members-only, or "confirm you're not a bot") need you to be signed in. **Settings > Cookies** has four sources:

- **Auto** (default): tries without cookies first. If the site asks you to sign in, it uses your saved cookies, then each installed browser, starting with your default browser and then Firefox
- **Browser**: always reads cookies from the browser you choose
- **File**: always uses a `cookies.txt` file you export yourself
- **Off**: never uses cookies

**Grab now** reads cookies from your browsers and saves them, so later downloads don't need the browser. **Force grab** does the same, but if a browser has locked its cookie file because it is open, it asks you first and then closes that browser to read it. The bin button deletes the saved cookies.

Chrome, Edge, Brave and other Chromium-based browsers now encrypt their cookies in a way yt-dlp can't read ([yt-dlp issue 10927](https://github.com/yt-dlp/yt-dlp/issues/10927)), and closing them doesn't help. Firefox works, or export a `cookies.txt` and use the **File** option.

Saved cookies stay on your PC in the app's data folder. They work like a login for the sites you're signed in to, so treat that file like a password.

### Display scaling

The app has no zoom setting of its own. Its size follows Windows display scaling (**Windows Settings > System > Display > Scale**).

## Project layout

| Path | What it does |
| --- | --- |
| `main.js` | Electron main process: window, settings, lookups, download queue, subtitles, right-click menu |
| `updater.js` | Installs, updates, verifies and rolls back yt-dlp, ffmpeg and Deno, and runs the self-test |
| `cookies.js` | Browser detection, cookie grabbing and saving, and retrying with cookies when a site asks for a sign-in |
| `preload.js` | The small, fixed set of functions the page is allowed to call |
| `src/index.html`, `src/app.js` | The interface |
| `src/tokens.css`, `src/app.css` | Colours, type and layout |
| `src/logo.svg` | The logo. `build/icon.png` is rendered from it and used for the app and installer icon |

## Limitations

- Windows 64-bit only
- Single videos only: links to playlists download just the one video
- The interface is in English
- The download queue is not saved, so it is cleared when you close the app
- The self-test uses one YouTube video, so an update that breaks a different site isn't rolled back automatically. Use **Go back to…** in Settings
- Only one previous version of each tool is kept
- The builds are not code-signed

## Licence

[MIT](LICENSE). Bundled and downloaded third-party software keeps its own licence (see below).

## Third-party software

The app bundles the [Inter](https://rsms.me/inter/) typeface and a few icons from [Lucide](https://lucide.dev/). It downloads [yt-dlp](https://github.com/yt-dlp/yt-dlp), [ffmpeg](https://ffmpeg.org/) and [Deno](https://deno.com/) from their publishers when it runs. See [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) for their licences.
