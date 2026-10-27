export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export async function askAgent(messages: ChatTurn[], snapshot: Record<string, unknown>): Promise<string> {
  const res = await fetch('/api/agent/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, snapshot }),
  });
  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (typeof body.detail === 'string') detail = body.detail;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(detail);
  }
  return (await res.json()).answer as string;
}
