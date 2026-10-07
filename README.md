# Magnus Profectus

A rest-pause method app for lifters who train past failure on purpose. Six exercises, two to four sessions a week, one working set per exercise taken to absolute failure with partials. The app carries the method: warm-up scheme, weight direction after each set, progression and stagnation tracking, pain gating, and a guide that explains every rule.

Free and open source under AGPL-3.0. No ads, no tracking, no analytics. Your training log stays on your device.

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
