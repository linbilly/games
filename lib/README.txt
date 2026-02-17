EduAudioEngine (Reusable Audio Engine)

Files:
- EduAudioEngine.js
- audio/sfx/*.wav

Quick start (ES module):
1) Import and create one shared instance (global or in your game shell)
   import { EduAudioEngine } from './EduAudioEngine.js';
   const audio = new EduAudioEngine({ baseUrl: './' }); // if /audio is alongside your html
   window.Audio = audio; // optional global

2) Unlock + preload on first user gesture (click/tap):
   await audio.init();
   await audio.preloadAll();

3) Play anywhere:
   audio.play('shoot_player');
   audio.play('hit_alien');

Hooking from games (drop-in):
window.MirrorMazeSFX = {
  enabled: true,
  play: (name) => audio.play(name)
};

Notes:
- These are synthesized WAVs (no licensing issues).
- If you want smaller files, convert to OGG/MP3 in your build pipeline and update DEFAULT_SFX_MAP.
