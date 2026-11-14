BLUP CASE OPEN PAGE / IMAGE REPAIR

Changes in this update:
- Rebuilt the case-opening page layout with a cleaner dark-blue visual style, consistent spacing, responsive controls, and a properly collapsed promo-code panel.
- Case cover selection is now derived from the numeric case ID (case_14 -> /assets/cases/case-14.webp), rather than trusting an optional catalog URL.
- If a case cover cannot load, the page tries a bundled local case cover and then the bundled animated BLUP agent. The emoji box fallback has been removed.
- The 25 bundled case cover WebP files remain under public/assets/cases/.
- CS2 skin image lookup still uses the public ByMykel CSGO-API catalogue. The server now caches successfully fetched skin images into public/assets/skins/ and serves the cached copies locally on later requests. If an image cannot be downloaded, its original source URL is retained as a fallback.
- Promo panel starts hidden and opens only after pressing the promo-code button.

Deploy the contents of this project folder to Amvera, preserving the public/assets folder. On the first case-page visits, the server may need internet access to warm the local skin-image cache. The image catalogue is from the community-maintained ByMykel CSGO-API, not an official Valve API.
