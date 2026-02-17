Mirror Maze (rewritten)
- index.html + game.js: Campaign play
- editor.html + editor.js: Level editor (separate page)
- levels.js: Shared campaign levels + helpers
- style.css: Shared styling

Note: uses ES modules (script type="module"). Many browsers block module imports from file://.
If your game library serves via HTTP (typical), you're good.
