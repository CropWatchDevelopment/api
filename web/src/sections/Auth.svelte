<script lang="ts">
  import { CwCard } from '@cropwatchdevelopment/cwui';
  import CodeBlock from '../lib/CodeBlock.svelte';

  const origin =
    typeof window !== 'undefined' ? window.location.origin : 'https://api.cropwatch.io';

  const curl = `curl -X POST '${origin}/v1/auth/login' \\
  -H 'Content-Type: application/json' \\
  -d '{ "email": "you@example.com", "password": "••••••••" }'`;

  const js = `const res = await fetch('${origin}/v1/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'you@example.com', password: '••••••••' }),
});

const { result } = await res.json();
const token = result.accessToken; // send as Authorization: Bearer <token>`;

  const py = `import requests

r = requests.post('${origin}/v1/auth/login', json={
    'email': 'you@example.com',
    'password': '••••••••',
})
token = r.json()['result']['accessToken']`;

  const sample = `{
  "message": "Login successful.",
  "result": {
    "accessToken": "eyJhbGciOiJIUzI1NiIs...",
    "token_type": "bearer",
    "expires_in_seconds": 3600,
    "expires_at": 1718668800,
    "expires_at_datetime": "2026-06-17T20:00:00.000Z"
  }
}`;

  const authed = `curl '${origin}/v1/devices' \\
  -H 'Authorization: Bearer <token>'`;
</script>

<section id="auth" class="section">
  <span class="eyebrow">Authentication</span>
  <h2 class="section__title">Get an access token</h2>
  <p class="section__lede">
    POST your email and password to <code>/v1/auth/login</code>. The response carries a Supabase
    JWT in <code>result.accessToken</code> — send it as <code>Authorization: Bearer &lt;token&gt;</code>
    on every other request.
  </p>

  <div class="grid grid--2" style="margin-top: var(--cw-space-6)">
    <div class="stack">
      <CodeBlock
        tabs={[
          { label: 'cURL', code: curl },
          { label: 'JavaScript', code: js },
          { label: 'Python', code: py },
        ]}
      />
      <p class="muted" style="font-size:var(--cw-text-sm); margin:0">
        Tokens are short-lived — <code>expires_in_seconds</code> tells you when to refresh. An
        <code>x-api-key</code> scheme is also available on request for server-to-server workloads.
      </p>
    </div>

    <div class="stack">
      <CwCard title="Sample response">
        <CodeBlock tabs={[{ label: '200 OK', code: sample }]} />
      </CwCard>
      <CwCard title="Then call an endpoint">
        <CodeBlock tabs={[{ label: 'cURL', code: authed }]} />
      </CwCard>
    </div>
  </div>
</section>
