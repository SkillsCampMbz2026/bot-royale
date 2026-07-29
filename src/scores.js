/* Match history in localStorage: wins, best placement, kill records. */

const Stats = {
  KEY: 'bot-royale-stats-v1',
  LIMIT: 10,
  data: null,

  blank() {
    return { version: 1, name: 'Player', matches: 0, wins: 0, best: null, runs: [] };
  },

  load() {
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(this.KEY));
    } catch {
      saved = null;
    }
    this.data = this.blank();
    if (saved && typeof saved === 'object') {
      Object.assign(this.data, {
        name: typeof saved.name === 'string' && saved.name.trim() ? saved.name : 'Player',
        matches: saved.matches || 0,
        wins: saved.wins || 0,
        best: typeof saved.best === 'number' ? saved.best : null,
        runs: Array.isArray(saved.runs) ? saved.runs : [],
      });
    }
    return this.data;
  },

  save() {
    try {
      localStorage.setItem(this.KEY, JSON.stringify(this.data));
      return true;
    } catch {
      return false;    // memory only for this session
    }
  },

  get name() {
    return this.data.name;
  },

  setName(value) {
    this.data.name = String(value || '').trim().slice(0, 14) || 'Player';
    this.save();
    return this.data.name;
  },

  /* Ranked by kills, then by the better placement. */
  record(placement, kills, survived, won) {
    this.data.matches += 1;
    if (won) this.data.wins += 1;
    if (this.data.best === null || placement < this.data.best) this.data.best = placement;

    const entry = { name: this.data.name, placement, kills, survived, won, at: Date.now() };
    this.data.runs.push(entry);
    this.data.runs.sort((a, b) => (b.kills - a.kills) || (a.placement - b.placement));
    this.data.runs = this.data.runs.slice(0, this.LIMIT);
    this.save();
    return this.data.runs.includes(entry) ? entry : null;
  },

  rename(entry, value) {
    const clean = this.setName(value);
    if (entry) entry.name = clean;
    this.save();
    return clean;
  },

  top() {
    return this.data.runs;
  },

  clear() {
    this.data = this.blank();
    this.save();
  },
};
