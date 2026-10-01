import './seasons.css';
import { SEASON_ICON, SEASON_NAME, SEASON_DAYS, type SeasonId } from './data';

/**
 * The season indicator in the clock bar: icon, name, day of the season and a thin progress line,
 * plus a small pulsing note while a nature event is coming or under way.
 */
export class SeasonChip {
  private readonly el = document.createElement('div');
  private readonly icon = document.createElement('span');
  private readonly name = document.createElement('span');
  private readonly day = document.createElement('span');
  private readonly note = document.createElement('span');
  private readonly bar = document.createElement('i');
  private last = '';

  constructor(hudRoot: HTMLElement) {
    this.el.className = 'season-chip';
    this.icon.className = 'sc-icon';
    this.name.className = 'sc-name';
    this.day.className = 'sc-day';
    this.note.className = 'sc-note';
    this.note.style.display = 'none';
    const track = document.createElement('div');
    track.className = 'sc-bar';
    track.appendChild(this.bar);
    this.el.append(this.icon, this.name, this.day, this.note, track);
    const bar = (hudRoot.querySelector('.top-right') ?? document.querySelector('.top-right')) as HTMLElement | null;
    if (bar) bar.insertBefore(this.el, bar.firstChild);
    else {
      this.el.classList.add('floating');
      hudRoot.appendChild(this.el);
    }
  }

  update(season: SeasonId, day: number, frac: number, note: { text: string; icon: string; warning: boolean } | null) {
    const sig = `${season}|${day}|${note?.text}|${note?.warning}`;
    if (sig !== this.last) {
      this.last = sig;
      this.icon.textContent = SEASON_ICON[season];
      this.name.textContent = SEASON_NAME[season];
      this.day.textContent = `Day ${day}`;
      this.el.title = `${SEASON_NAME[season]}, day ${day} of ${Math.round(SEASON_DAYS)}`;
      if (note) {
        this.note.style.display = '';
        this.note.textContent = `${note.icon} ${note.text}`;
        this.note.classList.toggle('warn', note.warning);
      } else this.note.style.display = 'none';
    }
    this.bar.style.width = `${Math.round(frac * 100)}%`;
  }
}
