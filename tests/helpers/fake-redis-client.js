export class FakeRedisClient {
  constructor() {
    this.values = new Map();
    this.sortedSets = new Map();
    this.sets = new Map();
    this.expiries = new Map();
    this.isOpen = true;
  }

  purge(key) {
    const expiresAt = this.expiries.get(key);
    if (expiresAt && expiresAt <= Date.now()) {
      this.values.delete(key);
      this.sortedSets.delete(key);
      this.sets.delete(key);
      this.expiries.delete(key);
    }
  }

  async connect() {
    this.isOpen = true;
  }

  async set(key, value, options = {}) {
    this.purge(key);
    if (options.NX && (this.values.has(key) || this.sortedSets.has(key) || this.sets.has(key))) return null;
    this.values.set(key, String(value));
    if (options.PX) this.expiries.set(key, Date.now() + Number(options.PX));
    return 'OK';
  }

  async get(key) {
    this.purge(key);
    return this.values.get(key) ?? null;
  }

  async del(key) {
    this.purge(key);
    const removed = Number(this.values.delete(key) || this.sortedSets.delete(key) || this.sets.delete(key));
    this.expiries.delete(key);
    return removed;
  }

  async incr(key) {
    const next = Number(await this.get(key) || 0) + 1;
    this.values.set(key, String(next));
    return next;
  }

  sortedSet(key) {
    this.purge(key);
    if (!this.sortedSets.has(key)) this.sortedSets.set(key, new Map());
    return this.sortedSets.get(key);
  }

  async zAdd(key, entries) {
    const set = this.sortedSet(key);
    for (const entry of entries) set.set(String(entry.value), Number(entry.score));
    return entries.length;
  }

  async zRangeByScore(key, minimum, maximum) {
    const min = minimum === '-inf' ? -Infinity : Number(minimum);
    const max = maximum === '+inf' ? Infinity : Number(maximum);
    return [...this.sortedSet(key)]
      .filter(([, score]) => score >= min && score <= max)
      .sort((left, right) => left[1] - right[1] || left[0].localeCompare(right[0]))
      .map(([value]) => value);
  }

  async zRange(key, start, stop) {
    const values = [...this.sortedSet(key)]
      .sort((left, right) => left[1] - right[1] || left[0].localeCompare(right[0]))
      .map(([value]) => value);
    const end = stop < 0 ? values.length + stop + 1 : stop + 1;
    return values.slice(start, end);
  }

  async zRem(key, value) {
    return Number(this.sortedSet(key).delete(String(value)));
  }

  async zCard(key) {
    return this.sortedSet(key).size;
  }

  async mGet(keys) {
    return Promise.all(keys.map((key) => this.get(key)));
  }

  valueSet(key) {
    this.purge(key);
    if (!this.sets.has(key)) this.sets.set(key, new Set());
    return this.sets.get(key);
  }

  async sAdd(key, value) {
    const set = this.valueSet(key);
    const before = set.size;
    set.add(String(value));
    return set.size - before;
  }

  async sRem(key, value) {
    return Number(this.valueSet(key).delete(String(value)));
  }

  async sMembers(key) {
    return [...this.valueSet(key)];
  }

  async pExpire(key, milliseconds) {
    this.expiries.set(key, Date.now() + Number(milliseconds));
    return 1;
  }

  async pTTL(key) {
    this.purge(key);
    if (!this.values.has(key) && !this.sortedSets.has(key) && !this.sets.has(key)) return -2;
    if (!this.expiries.has(key)) return -1;
    return Math.max(0, this.expiries.get(key) - Date.now());
  }

  multi() {
    const operations = [];
    const transaction = {
      set: (...args) => { operations.push(() => this.set(...args)); return transaction; },
      del: (...args) => { operations.push(() => this.del(...args)); return transaction; },
      zAdd: (...args) => { operations.push(() => this.zAdd(...args)); return transaction; },
      zRem: (...args) => { operations.push(() => this.zRem(...args)); return transaction; },
      exec: async () => Promise.all(operations.map((operation) => operation())),
    };
    return transaction;
  }

  async eval(_script, { keys, arguments: args }) {
    if (await this.get(keys[0]) !== args[0]) return 0;
    return this.del(keys[0]);
  }
}
