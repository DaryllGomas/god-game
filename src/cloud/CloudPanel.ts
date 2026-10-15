import type { Game } from '../Game';
import { createIsland, getLink, restoreIsland, type RestoreResult } from './Cloud';
import './cloud.css';

/** Longest god name the server accepts. */
const NAME_MAX = 24;

/**
 * Arriving from the end of THE PATH (`?from=thepath&initials=AVR`): the initials the player signed there,
 * offered as a god name. Letters only, one to three of them; anything else is ignored.
 */
export function pathInitials(search = location.search): string {
  try {
    const q = new URLSearchParams(search);
    if (q.get('from') !== 'thepath') return '';
    const raw = (q.get('initials') ?? '').trim();
    return /^[A-Za-z]{1,3}$/.test(raw) ? raw.toUpperCase() : '';
  } catch {
    return '';
  }
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

const RESTORE_MSG: Record<RestoreResult, string> = {
  ok: 'Found it. Opening your island...',
  notfound: 'No island has that code. Check the words and numbers.',
  empty: 'That island exists but has no saved progress yet.',
  offline: 'Could not reach the cloud. Try again in a moment.',
};

/**
 * The title-screen block for island codes: leave a god name and get a code, or enter a code to bring an
 * island here. Once linked it shows "Your island code" (also in the ? screen). It adds itself to the help
 * overlay and listens on the Begin button, so the HUD only needs one line to mount it.
 */
export function mountCloudPanel(game: Game, help: HTMLElement) {
  const begin = help.querySelector<HTMLButtonElement>('.begin')!;
  const box = el('div', 'cloud');
  help.querySelector('.tagline')!.after(box); // up top, where a new player sees it

  const render = () => {
    box.textContent = '';
    const link = getLink();
    if (link) renderLinked(link.name, link.code);
    else renderUnlinked();
  };

  const renderLinked = (name: string, code: string) => {
    box.append(el('div', 'cloud-label', `Your island code · ${name}`), codeRow(code));
  };

  const renderUnlinked = () => {
    const input = el('input', 'cloud-name');
    input.type = 'text';
    input.maxLength = NAME_MAX;
    input.placeholder = 'Your god name (optional)';
    input.autocomplete = 'off';
    input.spellcheck = false;
    // Only a suggestion: still optional, editable, and nothing happens until the player presses Begin.
    input.value = pathInitials();
    // Keys typed here must not drive the camera or miracles; Enter begins.
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') begin.click();
    });
    const hint = el('div', 'cloud-hint', 'Leave a name to get an island code. The code brings your island back on any device.');
    // The name is optional, so Begin with the field empty is "play without a name": one way forward, not two
    // (playtest 2026-10-15). "Lost your code?" waits inside the island-code box, where it matters.
    const links = el('div', 'cloud-links');
    const have = el('button', 'cloud-link', 'Have an island code?');
    have.onclick = () => showRestore(restoreBox, have);
    links.append(have);
    const restoreBox = el('div', 'cloud-restore hidden');
    box.append(input, hint, links, restoreBox);

    // Begin with a name typed: make the island in the cloud, then show the code once.
    begin.addEventListener('click', () => {
      const name = input.value.trim();
      if (!name || getLink()) return;
      void createIsland(name).then((link) => {
        if (!link) {
          game.message('Could not reach the cloud, so this island is saved on this device only. Try again from the ? screen.', 'warn', 'cloud-fail');
          return;
        }
        game.saves.save('quiet'); // first upload right away
        render();
        revealCode(game.hud.root, link.name, link.code);
      });
    });
  };

  const showRestore = (host: HTMLElement, trigger: HTMLElement) => {
    trigger.classList.add('hidden');
    host.classList.remove('hidden');
    host.textContent = '';
    const input = el('input', 'cloud-name');
    input.type = 'text';
    input.placeholder = 'AMBER-OTTER-4821';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.addEventListener('keydown', (e) => e.stopPropagation());
    const go = el('button', 'cloud-go', 'Open my island');
    const status = el('div', 'cloud-status');
    let confirmed = false;
    const run = async () => {
      if (!input.value.trim()) return;
      // A different island is already here: say so once before replacing it.
      if (game.saves.armed && !confirmed) {
        confirmed = true;
        status.textContent = 'This replaces the island on this device. Press again to go ahead.';
        return;
      }
      go.disabled = true;
      status.textContent = 'Looking...';
      const res = await restoreIsland(input.value);
      status.textContent = RESTORE_MSG[res];
      if (res === 'ok') {
        game.saves.freeze(); // the unload below must not write the old island over the one just fetched
        location.reload();
      } else {
        go.disabled = false;
        confirmed = false;
      }
    };
    go.onclick = () => void run();
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void run();
    });
    // A lost code is found by hand: the player writes in through the studio's contact form.
    const lost = el('a', 'cloud-link', 'Lost your code?');
    lost.href = 'https://studio.bigpicsolutions.com/#work';
    lost.target = '_blank';
    lost.rel = 'noopener';
    host.append(input, go, status, lost);
    input.focus();
  };

  render();
}

/** The code with a Copy button. */
function codeRow(code: string): HTMLElement {
  const row = el('div', 'cloud-code-row');
  const c = el('span', 'cloud-code', code);
  const copy = el('button', 'cloud-copy', 'Copy');
  copy.onclick = () => {
    const done = () => {
      copy.textContent = 'Copied';
      window.setTimeout(() => (copy.textContent = 'Copy'), 1600);
    };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(code).then(done, () => selectText(c));
    else selectText(c);
  };
  c.style.userSelect = 'all';
  row.append(c, copy);
  return row;
}

function selectText(node: HTMLElement) {
  const r = document.createRange();
  r.selectNodeContents(node);
  const s = window.getSelection();
  s?.removeAllRanges();
  s?.addRange(r);
}

/** Shown once, right after the code is made. */
function revealCode(root: HTMLElement, name: string, code: string) {
  const o = el('div', 'overlay cloud-reveal');
  const card = el('div', 'overlay-card');
  card.append(
    el('h1', '', 'Your island code'),
    el('p', 'tagline', `Welcome, ${name}. Keep this code: it is the way back to your island.`),
    codeRow(code),
    el('p', 'cloud-hint', 'Anyone who has this code can open your island, so share it only with yourself. You can see it again any time in the ? screen. Lost it? Write to us at studio.bigpicsolutions.com and we\'ll find it.'),
  );
  const ok = el('button', 'begin', 'Got it');
  ok.onclick = () => o.remove();
  card.append(ok);
  o.append(card);
  root.append(o);
}
