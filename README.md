# Magnus Profectus

A rest-pause method app for lifters who train to failure and beyond, on purpose. One working set per exercise, pushed past failure with timed partial sets. The recommended default program is just that, recommended: split, exercise selection, rest lengths and rep targets are all configurable. The app carries the method: warm-up scheme, weight direction after each set, progression and stagnation tracking, pain gating, and a guide that explains every rule.

Free and open source under AGPL-3.0. No ads, no tracking, no analytics. Your training log stays on your device.

## Install and use

### Android

1. **Obtainium (recommended).** Install [Obtainium](https://github.com/ImranR98/Obtainium) (from GitHub or F-Droid-adjacent sources), add this repo (`https://github.com/magnusprofectus/magnus-profectus`) as an app source, and Obtainium installs and keeps the app updated automatically with every release. No account, no Play Store.
2. **Direct APK.** Download the latest signed APK from the [releases page](https://github.com/magnusprofectus/magnus-profectus/releases/latest) (`magnus-profectus.apk`) and install it. Android will ask you to allow installs from your browser or file manager once. Updates are manual: download the new APK and install over the old one (your data is kept).
3. **F-Droid / Droid-ify.** Planned, not yet available.

### All other devices (iPhone, iPad, desktop)

1. Open **[magnusprofectus.github.io/magnus-profectus](https://magnusprofectus.github.io/magnus-profectus/)** in your browser. Everything works right there, fully offline after the first load.
2. **iPhone / iPad:** in Safari, tap the Share button, then **Add to Home Screen**. It then runs full-screen like an app. **Desktop:** install it as a PWA from the browser's address-bar icon if you like; otherwise a bookmark is enough.

These limitations apply to the browser version only; the installed Android APK avoids all of them.

- **Browser-stored data can be evicted.** iOS in particular can clear website data for Safari pages not used for seven days (a browser rule, not our choice). **Use Export JSON in Settings now and then**, or turn on automatic backups after each workout, so a restore is always one file away.
- **The rest-pause timer needs the app in focus.** If the screen is locked or the app is minimized, the timer pauses or the warning chime may not fire. Keep the screen on during a set; a cheap interval timer (the guide suggests a Gymboss) is the belt-and-braces option.
- Progress lives in the app, not on a server. Switching devices is a matter of Export JSON on the old one, Import JSON on the new one.

## Status

Under active development with a small test group. A hosted sync service is planned; the app is fully usable without any account or network connection.

## Why open source

Trust in a training log means the data is yours and the code can be checked. Everything runs locally in your browser or on your device, and the sync server is a plain, dependency-free Node script you can read in one sitting.

## Self-hosting the sync server (optional)

The app works fully offline by default. If you want multi-device sync on your own terms:

```bash
cd server
PORT=8080 node index.mjs
```

Zero npm dependencies, Node 22+ (uses the built-in `node:sqlite`). Data lands in a single SQLite file next to the script (override with `RP_DB`). Users register with a username and password only; no email is collected. Point the app's server setting at your instance.

## Development

```bash
npm install
npm run dev        # vite dev server, proxies /api to the local sync server
npm run build      # production build to dist/
npm run articles:build   # regenerate article pages from ARTICLES.md
npx vitest run     # test suite
```

## Support the project

If the app earned its place in your routine, you can support its development and hosting. Donation links will appear here and in the app.

## License

AGPL-3.0. See [LICENSE](LICENSE). If you improve the code and offer it as a service, the license asks you to share your modifications with your users. We consider that a feature.
