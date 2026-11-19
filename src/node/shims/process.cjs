// `process` for bundled polyfills (readable-stream): forwards to the worker's live process object.
module.exports = new Proxy({}, {
  get(_t, k) {
    const real = globalThis.process
    if (real) return real[k]
    if (k === 'nextTick') return (fn, ...a) => queueMicrotask(() => fn(...a))
    if (k === 'env') return {}
    return undefined
  },
})
