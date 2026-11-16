BLUP REDESIGN UPDATE

What changed:
- Added a full-site yellow / red / green graphite visual theme in public/theme-redesign.css.
- Added a floating right-side rates drawer for USDT/RUB and GRAM/RUB, populated from the administrator-configured rates.
- Reworked the homepage hero visual, removed the decorative orbit/coin clutter, and moved the rate strip below the feature cards.
- Restyled common panels, forms, buttons, tables, statuses, and admin elements across all HTML pages.
- Giveaway participation now opens a wheel modal; participant nicknames and site IDs are displayed below the wheel in shuffled order.
- Added an optional scheduled draw time to the giveaway admin form. The server checks due giveaways every 15 seconds and automatically publishes results.
- Added an admin "Перевыбрать победителей" action for completed giveaways.
- Added the draw_at database migration automatically. Existing databases are migrated on startup.
- The admin login-history clear action was already present; it remains available and is restyled with the new theme.

Deploy:
1. Back up the current project and /data/data.db.
2. Replace the application files with this archive.
3. Keep your existing .env and persistent /data directory.
4. Restart the Node application. The database migration runs automatically.

Scheduled giveaway time uses the administrator's browser local time and is converted to UTC before saving.
