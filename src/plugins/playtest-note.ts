import type { Game, GamePlugin } from '../Game';

/**
 * The playtest note key (B, or both sticks pressed in): dev server only. In a built game this installs nothing and
 * the tool's code (src/dev/PlaytestNote.ts) is not in the bundle. See that file and README "Playtest notes".
 */
export function install(game: Game): GamePlugin | void {
  if (!import.meta.env.DEV) return;
  const plugin: GamePlugin & { note: import('../dev/PlaytestNote').PlaytestNote | null } = {
    name: 'playtest-note',
    note: null,
    frame() {
      this.note?.tick();
    },
    rendered() {
      this.note?.rendered();
    },
  };
  // ?soundprobe: once a second, write what the game's sound is doing to shots/sound-probe.log (src/dev/SoundProbe.ts).
  if (new URLSearchParams(location.search).has('soundprobe')) void import('../dev/SoundProbe').then((m) => m.startSoundProbe(game));
  void import('../dev/PlaytestNote').then((m) => {
    plugin.note = new m.PlaytestNote(game);
    (game as unknown as { playtestNote: unknown }).playtestNote = plugin.note;
  });
  return plugin;
}
