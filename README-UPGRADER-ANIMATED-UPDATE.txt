BLUP CASES — animated upgrader update

Changes in this package:
- Rebuilt /cases/upgrader to match the supplied CS2 upgrader reference: source and target panels, central chance dial, animated pointer, inventory and target catalog grids.
- Added optional use of the user's CASES balance together with selected inventory skins, or balance alone.
- The server validates and deducts the balance and consumes selected inventory items in the same SQLite transaction.
- The wheel animation lands on the server-returned roll result; it does not decide the result in the browser.
- Added a server-side skin image catalog endpoint with multiple upstream fallbacks and browser CDN fallback.
- Fixed the case cover image layout. All 25 local WebP case covers are included under public/assets/cases/.
- Kept the existing case opening, inventory, profile, promo, deposit and withdrawal files/routes.

Deployment:
1. Back up the current project and database.
2. Upload/replace the project files from this archive.
3. Keep the existing production database and any persistent /data directory; do not delete user data.
4. Restart the Node application on Amvera.
5. Open /cases and /cases/upgrader. Log in to use the inventory and balance.

Validation performed:
- node --check passed for server.js, cases-upgrader.js, cases.js and case-open.js.
- Confirmed 25 local case cover WebP files are present.
- Live Amvera deployment, database migration and external image CDN reachability were not testable from this build environment.
