BLUP FULL REDESIGN V2

This update applies one shared brand theme to every HTML page in public/:
- BLUP main site, profile and technical-maintenance screen
- BlupCase listing, case opening, upgrader, profile, contracts and case admin
- Tournament and tournament admin
- Main admin dashboard

Brand direction: dark graphite base with lime green, warm yellow and violet gradients. Legacy cyan/blue selectors are remapped through the shared theme and page-specific overrides. Added hover lift, soft glow, background motion, card image movement, responsive styling and reduced-motion support.

Giveaways:
- The wheel UI has been removed from the admin panel.
- The admin still controls finishing a giveaway and rerolling a winner using the existing protected server endpoints.
- The public site giveaway modal now shows participants on a decorative animated wheel, participant names, equal-chance notice and server-selected winners after completion/reroll.

Admin:
- All admin cards with section headers have collapse/expand controls, including giveaways, promo codes, sales stream, accounts/access and login history.
- Login history has a visible Clear history button. It calls the existing admin-only DELETE /api/admin/visits route.

Brand wording:
- Removed BLUP / prefixes from micro-labels such as SOON and request labels. The primary BLUP brand/logo remains where it is the actual site identity.

Validation performed:
- node --check on all JavaScript files in public/ and project root.
- Archive integrity check after packaging.
- No production deployment was performed; deploy this archive to the hosting service and verify against the live database before public use.
