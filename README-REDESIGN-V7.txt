BLUP REDESIGN V7

A final shared stylesheet (public/brand-overrides-v7.css) is loaded after page styles on every HTML page. It overrides legacy cyan/blue styles in the home page, sell modal, wallet panel, online indicator, BlupCase, Tournament, profile, giveaways, maintenance and admin interfaces. The giveaway wheel uses one equal conic-gradient sector per current participant, no text on sectors, a fixed right-side pointer and winner nickname + public ID in the hub. Native select backgrounds no longer draw the mispositioned old arrow triangles; custom dropdowns use the lime/yellow/violet palette.

Deploy the entire project directory, restart Amvera, then hard-refresh with Ctrl+Shift+R. If a CDN/proxy is enabled, purge its cache. Verify /brand-overrides-v7.css?v=7 returns HTTP 200 in the browser Network tab. A 404 means the new public assets were not deployed.
