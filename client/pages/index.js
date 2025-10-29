import React, { useState } from "react";

export default function Home() {
  const [status, setStatus] = useState("idle");
  const [password, setPassword] = useState("");
  const [fileId, setFileId] = useState(null);
  const [wrappedFileKeyState, setWrappedFileKeyState] = useState(null);
  const [wrappedFileKeyIvState, setWrappedFileKeyIvState] = useState(null);
  const [kdfAlgo, setKdfAlgo] = useState(null);
  const [wsMessages, setWsMessages] = useState([]);
  const collectedChunksRef = React.useRef([]);

  // open WS to PoC server on 4000 and keep ref for sending
  const wsRef = React.useRef(null);
  React.useEffect(() => {
    const ws = new WebSocket("ws://localhost:4000");
    wsRef.current = ws;
    ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        setWsMessages((m) => [data, ...m].slice(0, 20));
      } catch (e) {
        setWsMessages((m) => [`${ev.data}`, ...m].slice(0, 20));
      }
    };
    ws.onopen = () => setWsMessages((m) => [{ type: "ws_open" }, ...m]);
    ws.onclose = () => setWsMessages((m) => [{ type: "ws_close" }, ...m]);
    return () => ws.close();
  }, []);

  async function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    setStatus("reading");

    // Derive Master Key from password (if provided) using crypto.worker.js
    let masterKeyB64 = null;
    if (password && password.length > 0) {
      setStatus('deriving_key');
      const cworker = new Worker('/workers/crypto.worker.js');
      try {
        const derived = await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('derive timeout')), 15000);
          cworker.onmessage = (ev) => {
            const m = ev.data || {};
            if (m.type === 'derived') {
              clearTimeout(timeout);
              resolve(m);
            } else if (m.type === 'error') {
              clearTimeout(timeout);
              reject(new Error(m.message));
            }
          };
          cworker.postMessage({ type: 'derive', password, iterations: 250000 });
        });
        masterKeyB64 = derived.masterKey;
        if (derived.algo) setKdfAlgo(derived.algo);
      } catch (err) {
        console.error('Key derivation failed', err);
        setStatus('error');
        try { cworker.terminate(); } catch (e) {}
        return;
      }
      try { cworker.terminate(); } catch (e) {}
    }

    // Use the Web Worker at /workers/chunker.worker.js
    const worker = new Worker("/workers/chunker.worker.js");

    // Reset collected chunk metadata for this run
    collectedChunksRef.current = [];

    worker.onmessage = async (ev) => {
      const msg = ev.data || {};
      if (msg.type === "progress") {
        // collect chunk metadata emitted by worker
        const meta = {
          index: msg.index,
          hash: msg.hash,
          size: msg.size,
          wrappedChunkKey: msg.wrappedChunkKey,
          wrapIv: msg.wrapIv,
          chunkIv: msg.chunkIv,
        };
        // avoid duplicates by hash
        if (meta.hash && !collectedChunksRef.current.find((c) => c.hash === meta.hash)) {
          collectedChunksRef.current.push(meta);
        }

        setWsMessages((m) =>
          [
            {
              type: "chunk_progress",
              index: msg.index,
              hash: msg.hash,
              size: msg.size,
              bytesProcessed: msg.bytesProcessed,
              percent: msg.percent,
            },
            ...m,
          ].slice(0, 50)
        );
      } else if (msg.type === "done") {
        // Ask chunker to wrap its internal fileKey with our derived Master Key (if present)
        setStatus('wrapping_key');
        let wrappedFileKey = null;
        let wrapIv = null;
        if (masterKeyB64) {
          try {
            const wrapResult = await new Promise((resolve, reject) => {
              const t = setTimeout(() => reject(new Error('wrap timeout')), 15000);
              const onmsg = (wev) => {
                const w = wev.data || {};
                if (w.type === 'wrappedFileKey') {
                  clearTimeout(t);
                  worker.removeEventListener('message', onmsg);
                  resolve(w);
                } else if (w.type === 'error') {
                  clearTimeout(t);
                  worker.removeEventListener('message', onmsg);
                  reject(new Error(w.message));
                }
              };
              worker.addEventListener('message', onmsg);
              worker.postMessage({ type: 'wrapFileKey', masterKey: masterKeyB64 });
            });
            wrappedFileKey = wrapResult.wrappedFileKey;
            wrapIv = wrapResult.wrapIv;
          } catch (err) {
            console.error('wrap failed', err);
            setStatus('error');
          }
        }

        setStatus("posting");
        const chunks = collectedChunksRef.current.slice();

        const payload = { fileName: file.name, fileSize: file.size, chunks };
        if (wrappedFileKey) payload.wrappedFileKey = wrappedFileKey;
        if (wrapIv) payload.wrappedFileKeyIv = wrapIv;

        const resp = await fetch("http://localhost:4000/api/files/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
  const body = await resp.json();
  console.log("server response", body);
  // capture returned fileId and wrappedFileKey (if any)
  if (body && body.fileId) setFileId(body.fileId);
  if (payload.wrappedFileKey) setWrappedFileKeyState(payload.wrappedFileKey);
  if (payload.wrappedFileKeyIv) setWrappedFileKeyIvState(payload.wrappedFileKeyIv);
        worker.terminate();

        // If server returned jobs that need upload, start transfer worker to simulate uploads
        const needs = (body.jobs || []).filter(
          (j) => j.status === "needs_upload"
        );
        if (needs.length > 0) {
          const tworker = new Worker("/workers/transfer.worker.js");
          tworker.onmessage = async (tev) => {
            const tmsg = tev.data || {};
            if (tmsg.type === "progress") {
              // forward progress to server via WS
              const payload = {
                type: "upload_progress",
                hash: tmsg.hash,
                percent: tmsg.percent,
              };
              try {
                wsRef.current &&
                  wsRef.current.readyState === WebSocket.OPEN &&
                  wsRef.current.send(JSON.stringify(payload));
              } catch (e) {
                console.error("WS send failed", e);
              }
              setWsMessages((m) => [payload, ...m].slice(0, 50));
            } else if (tmsg.type === "done") {
              // commit uploaded hashes to server
              try {
                await fetch("http://localhost:4000/api/files/commit", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ chunkHashes: tmsg.uploaded }),
                });
              } catch (e) {
                console.error("commit failed", e);
              }
              setWsMessages((m) =>
                [{ type: "upload_done", uploaded: tmsg.uploaded }, ...m].slice(
                  0,
                  50
                )
              );
              tworker.terminate();
            }
          };
          // start simulated uploads
          tworker.postMessage({ type: "uploadJobs", jobs: needs });
        }

        setStatus("done");
      } else if (msg.type === "error") {
        setStatus("error");
        console.error("Worker error", msg.message);
        worker.terminate();
      }
    };

    worker.postMessage({ type: "chunkFile", file, chunkSize: 1024 * 1024 });
  }

  return (
    <div style={{ padding: 24, fontFamily: "sans-serif" }}>
      <h1>DriveMerge PoC client</h1>
      <p>Status: {status}</p>
      <div style={{ marginBottom: 12 }}>
        <label style={{ display: 'block', marginBottom: 6 }}>Password (used to derive file key):</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} style={{ width: 300, padding: 6 }} placeholder="Enter password for file key" />
      </div>
      <input type="file" onChange={handleFile} />

      {fileId && (
        <div style={{ marginTop: 12, padding: 12, border: '1px solid #ddd', maxWidth: 600 }}>
          <strong>Uploaded fileId: </strong> {fileId}
          <div style={{ marginTop: 8 }}>
            <strong>KDF used:</strong> {kdfAlgo || 'unknown'}
          </div>
          {wrappedFileKeyState && (
            <div style={{ marginTop: 8 }}>
              <div><strong>Wrapped File Key (base64):</strong></div>
              <textarea readOnly rows={3} style={{ width: '100%' }} value={wrappedFileKeyState} />
              <div style={{ marginTop: 6 }}>
                <button onClick={() => navigator.clipboard.writeText(wrappedFileKeyState)}>Copy wrapped key</button>
                {wrappedFileKeyIvState && (
                  <button style={{ marginLeft: 8 }} onClick={() => navigator.clipboard.writeText(wrappedFileKeyIvState)}>Copy wrap IV</button>
                )}
                <button
                  style={{ marginLeft: 8 }}
                  onClick={() => {
                    try {
                      const meta = {
                        fileId: fileId,
                        fileName: file.name,
                        fileSize: file.size,
                        wrappedFileKey: wrappedFileKeyState,
                        wrappedFileKeyIv: wrappedFileKeyIvState,
                        kdf: kdfAlgo || null,
                        createdAt: new Date().toISOString(),
                      };
                      const blob = new Blob([JSON.stringify(meta, null, 2)], { type: 'application/json' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `${fileId || 'file'}-wrapped-key.json`;
                      document.body.appendChild(a);
                      a.click();
                      a.remove();
                      URL.revokeObjectURL(url);
                    } catch (err) {
                      console.error('download failed', err);
                    }
                  }}
                >
                  Download wrapped metadata
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <h2>WebSocket events (recent)</h2>
      <ul>
        {wsMessages.map((m, i) => (
          <li key={i}>
            <pre style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(m)}</pre>
          </li>
        ))}
      </ul>
    </div>
  );
}
