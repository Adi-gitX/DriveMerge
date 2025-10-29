import React, { useState } from 'react';

export default function Home() {
  const [status, setStatus] = useState('idle');
  const [wsMessages, setWsMessages] = useState([]);

  // open WS to PoC server on 4000
  React.useEffect(() => {
    const ws = new WebSocket('ws://localhost:4000');
    ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        setWsMessages((m) => [data, ...m].slice(0, 20));
      } catch (e) {
        setWsMessages((m) => [`${ev.data}`, ...m].slice(0, 20));
      }
    };
    ws.onopen = () => setWsMessages((m) => [{ type: 'ws_open' }, ...m]);
    ws.onclose = () => setWsMessages((m) => [{ type: 'ws_close' }, ...m]);
    return () => ws.close();
  }, []);

  async function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    setStatus('reading');

    // simple fixed-size chunking (1MB)
    const chunkSize = 1024 * 1024;
    const hashes = [];
    for (let offset = 0; offset < file.size; offset += chunkSize) {
      const slice = file.slice(offset, offset + chunkSize);
      const arrayBuffer = await slice.arrayBuffer();
      const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
      hashes.push(hashHex);
    }

    setStatus('posting');
    const resp = await fetch('http://localhost:4000/api/files/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName: file.name, fileSize: file.size, chunkHashes: hashes }),
    });
    const body = await resp.json();
    console.log('server response', body);
    setStatus('done');
  }

  return (
    <div style={{ padding: 24, fontFamily: 'sans-serif' }}>
      <h1>DriveMerge PoC client</h1>
      <p>Status: {status}</p>
      <input type="file" onChange={handleFile} />

      <h2>WebSocket events (recent)</h2>
      <ul>
        {wsMessages.map((m, i) => (
          <li key={i}><pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(m)}</pre></li>
        ))}
      </ul>
    </div>
  );
}
