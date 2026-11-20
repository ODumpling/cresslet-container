// A project worker (`Container.projectWorker`), shaped like a studio's server handler worker: it imports code it was
// sent through a blob: URL and answers requests. Reports what it can see of the host's storage.
onmessage = ({ data }) => {
  if (data.type === 'throw') throw new Error('boom from the worker')
  if (data.type === 'port') {
    // answer on the port it was sent, and send one back through the worker's own channel
    const { port1, port2 } = new MessageChannel()
    data.port.postMessage({ pong: true })
    postMessage({ back: true }, [port2])
    port1.onmessage = (e) => postMessage({ via: 'returned port', got: e.data })
    return
  }
  void answer(data)
}

async function answer(data) {
  const url = URL.createObjectURL(new Blob([data.code], { type: 'text/javascript' }))
  const mod = await import(url)
  const stores = await new Promise((resolve) => {
    const req = indexedDB.open('studio')
    req.onerror = () => resolve(String(req.error))
    req.onsuccess = () => (resolve([...req.result.objectStoreNames]), req.result.close())
  })
  postMessage({ origin: self.origin, answer: mod.default(data.n), bytes: data.body.byteLength, stores, studioCache: await caches.has('studio-cache') })
}
