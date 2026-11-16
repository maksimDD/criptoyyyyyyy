BLUP V9 — screenshot palette + contracts animation + SBP top-up

- Added final shared stylesheet /brand-overrides-v9.css?v=9 to all public HTML pages.
- Replaced legacy cyan/blue theme colors with lime (#caff70), yellow (#ffe66b), violet (#bd79ff).
- Contracts show a live rotating preview of different skins while the server computes the result;
  the server response remains authoritative and only its actual result is awarded.
- BlupCase top-up modal now has Crypto / SBP tabs. SBP directs users to @BLUP_MANAGER via Telegram.
- Existing crypto deposit flow and API are unchanged.
- Admin case balance denomination chips use the new gradient.

Deploy the entire project directory and restart Amvera. Hard refresh with Ctrl+Shift+R.
Verify /brand-overrides-v9.css?v=9 returns HTTP 200 in DevTools Network.
