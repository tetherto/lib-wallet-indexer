class Debouncer {
  constructor (timeout = 10000) {
    this.timeout = timeout
    this.timer = null
  }

  reset (callback) {
    clearTimeout(this.timer)
    this.timer = setTimeout(callback, this.timeout)
  }
}

module.exports = {
  Debouncer
}
