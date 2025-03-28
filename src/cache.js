

class Cache {
  constructor() {
    this.cache = new Map();
  }

  simpleHash(obj) {
    const str = JSON.stringify(obj);
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(31, h) + str.charCodeAt(i) | 0;
    }
    return h >>> 0; // Convert to unsigned integer
  }

  getKey(params) {
    return this.simpleHash(params).toString(16);
  }

  set(params, value) {
    const key = this.getKey(params);

    this.cache.set(key, {
      value,
      timestamp: Date.now(),
    });
  }

  get(params) {
    const key = this.getKey(params);

    const cached = this.cache.get(key);

    if (!cached) return null;

    // Check if cache is still valid (20 seconds)
    if (Date.now() - cached.timestamp > 20000) {
      this.cache.delete(key);
      return null;
    }

    return cached.value;
  }
}

module.exports = Cache;