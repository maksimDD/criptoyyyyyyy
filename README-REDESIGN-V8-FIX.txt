BLUP REDESIGN V8 — wheel/modal/online overflow fix

- Wheel remains inside #giveawaysBackdrop, the website modal.
- One equal sector per participant; no labels on sectors.
- Fixed pointer at 3 o’clock (right edge).
- On finish/reroll app.js finds the exact winner by user_id and calculates the wheel rotation
  so the winner sector center stops under the pointer. Reroll points to the last winner, matching server.js.
- Modal and wheel are constrained to the viewport; wheel pointer is inside the modal layout.
- Online badge is shrinkable and constrained within the header on desktop/mobile.
- New unique stylesheet URL /brand-overrides-v8.css?v=8 is loaded last on every HTML page.

Deploy the entire project directory, restart Amvera and hard-refresh with Ctrl+Shift+R.
Verify /brand-overrides-v8.css?v=8 returns HTTP 200 in DevTools Network.
