'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

const STORAGE_KEY = 'balticm-ai:threads:v1';
const MEMORY_KEY = 'balticm-ai:project-memory:v1';

function makeThread() {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    title: 'New chat',
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}

export default function Home() {
  const [threads, setThreads] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [input, setInput] = useState('');
  const [mode, setMode] = useState('chat');
  const [allowWrites, setAllowWrites] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState({ openai: false, github: false, model: 'gpt-5.6-sol' });
  const [memory, setMemory] = useState('');
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [trace, setTrace] = useState([]);
  const abortRef = useRef(null);
  const bottomRef = useRef(null);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      const initial = saved.length ? saved : [makeThread()];
      setThreads(initial);
      setActiveId(initial[0].id);
      setMemory(localStorage.getItem(MEMORY_KEY) || '');
    } catch {
      const initial = [makeThread()];
      setThreads(initial);
      setActiveId(initial[0].id);
    }

    fetch('/api/status')
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (threads.length) localStorage.setItem(STORAGE_KEY, JSON.stringify(threads));
  }, [threads]);

  useEffect(() => {
    localStorage.setItem(MEMORY_KEY, memory);
  }, [memory]);

  const active = useMemo(() => threads.find((t) => t.id === activeId) || threads[0], [threads, activeId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [active?.messages, trace]);

  function newChat() {
    const thread = makeThread();
    setThreads((current) => [thread, ...current]);
    setActiveId(thread.id);
    setTrace([]);
    setInput('');
  }

  function updateThread(id, updater) {
    setThreads((current) => current.map((thread) => (thread.id === id ? updater(thread) : thread)));
  }

  function deleteThread(id) {
    setThreads((current) => {
      const next = current.filter((thread) => thread.id !== id);
      if (!next.length) {
        const fresh = makeThread();
        setActiveId(fresh.id);
        return [fresh];
      }
      if (activeId === id) setActiveId(next[0].id);
      return next;
    });
  }

  async function send() {
    const text = input.trim();
    if (!text || busy || !active) return;

    setInput('');
    setTrace([]);
    setBusy(true);
    const threadId = active.id;
    const userMessage = { id: crypto.randomUUID(), role: 'user', content: text };
    const assistantMessage = { id: crypto.randomUUID(), role: 'assistant', content: '' };

    const nextMessages = [...active.messages, userMessage];
    updateThread(threadId, (thread) => ({
      ...thread,
      title: thread.messages.length ? thread.title : text.slice(0, 46),
      updatedAt: Date.now(),
      messages: [...nextMessages, assistantMessage],
    }));

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      if (mode === 'agent') {
        const response = await fetch('/api/agent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({ messages: nextMessages, projectMemory: memory, allowWrites }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Agent request failed.');
        setTrace(data.trace || []);
        updateAssistant(threadId, assistantMessage.id, data.text || 'Done.');
      } else {
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({ messages: nextMessages, projectMemory: memory }),
        });
        if (!response.ok || !response.body) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error || 'Chat request failed.');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let full = '';
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          full += decoder.decode(value, { stream: true });
          updateAssistant(threadId, assistantMessage.id, full);
        }
      }
    } catch (error) {
      if (error.name !== 'AbortError') {
        updateAssistant(threadId, assistantMessage.id, `Error: ${error.message}`);
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  function updateAssistant(threadId, messageId, content) {
    updateThread(threadId, (thread) => ({
      ...thread,
      updatedAt: Date.now(),
      messages: thread.messages.map((message) => (message.id === messageId ? { ...message, content } : message)),
    }));
  }

  function stop() {
    abortRef.current?.abort();
  }

  function handleKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  }

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brandMark">BM</div>
          <div><strong>BalticM AI</strong><span>Project copilot</span></div>
        </div>
        <button className="newChat" onClick={newChat}>＋ New chat</button>
        <div className="threadList">
          {threads.map((thread) => (
            <button key={thread.id} className={`thread ${thread.id === active?.id ? 'active' : ''}`} onClick={() => { setActiveId(thread.id); setTrace([]); }}>
              <span>{thread.title || 'New chat'}</span>
              <span className="delete" onClick={(e) => { e.stopPropagation(); deleteThread(thread.id); }}>×</span>
            </button>
          ))}
        </div>
        <div className="sidebarFooter">
          <div className="statusRow"><i className={status.openai ? 'dot ok' : 'dot'} /> OpenAI {status.openai ? 'ready' : 'not configured'}</div>
          <div className="statusRow"><i className={status.github ? 'dot ok' : 'dot'} /> GitHub {status.github ? 'ready' : 'not configured'}</div>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="modeSwitch">
            <button className={mode === 'chat' ? 'selected' : ''} onClick={() => setMode('chat')}>Chat</button>
            <button className={mode === 'agent' ? 'selected' : ''} onClick={() => setMode('agent')}>Agent</button>
          </div>
          <div className="topActions">
            <span className="modelPill">{status.model}</span>
            {mode === 'agent' && (
              <label className={`writeToggle ${allowWrites ? 'armed' : ''}`}>
                <input type="checkbox" checked={allowWrites} onChange={(e) => setAllowWrites(e.target.checked)} />
                Allow GitHub writes
              </label>
            )}
            <button className="memoryButton" onClick={() => setMemoryOpen((v) => !v)}>Project memory</button>
          </div>
        </header>

        {memoryOpen && (
          <div className="memoryPanel">
            <div><strong>Project memory</strong><span>This text is sent with every request. Keep stable project facts here.</span></div>
            <textarea value={memory} onChange={(e) => setMemory(e.target.value)} placeholder="Example: Main repo is all4fun-91/balticm-bot. Production changes need a branch first..." />
          </div>
        )}

        <div className="conversation">
          {!active?.messages?.length ? (
            <div className="hero">
              <div className="heroLogo">BM</div>
              <h1>What are we building?</h1>
              <p>Chat for discussion. Agent mode can inspect your allow-listed GitHub projects and, when you explicitly enable writes, change them.</p>
              <div className="starterGrid">
                <button onClick={() => setInput('Inspect my BalticM repository and explain the current architecture.')}>Inspect the project</button>
                <button onClick={() => setInput('Find the most important technical debt in the current project and propose a safe plan.')}>Find technical debt</button>
                <button onClick={() => setInput('Help me implement a new feature. First inspect the relevant files before changing anything.')}>Build a feature</button>
              </div>
            </div>
          ) : (
            <div className="messages">
              {active.messages.map((message) => (
                <article key={message.id} className={`message ${message.role}`}>
                  <div className="avatar">{message.role === 'user' ? 'YOU' : 'AI'}</div>
                  <div className="bubble"><div className="role">{message.role === 'user' ? 'You' : 'BalticM AI'}</div><pre>{message.content || (busy ? 'Thinking…' : '')}</pre></div>
                </article>
              ))}
              {trace.length > 0 && (
                <div className="trace">
                  <strong>Agent activity</strong>
                  {trace.map((item, index) => (
                    <div key={`${item.tool}-${index}`} className="traceItem"><span>{item.ok ? '✓' : '!'}</span><div><b>{item.tool}</b><small>{item.summary}</small></div></div>
                  ))}
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        <div className="composerWrap">
          <div className={`composer ${mode === 'agent' ? 'agentComposer' : ''}`}>
            <textarea value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={handleKeyDown} placeholder={mode === 'agent' ? 'Give the agent a project task…' : 'Message BalticM AI…'} rows={1} />
            <div className="composerBottom">
              <span>{mode === 'agent' ? (allowWrites ? 'Agent · GitHub writes enabled' : 'Agent · read-only') : 'Chat mode'}</span>
              {busy ? <button className="send stop" onClick={stop}>■</button> : <button className="send" onClick={send} disabled={!input.trim()}>↑</button>}
            </div>
          </div>
          <small className="notice">AI can make mistakes. Review production changes before deploying.</small>
        </div>
      </section>
    </main>
  );
}
