<script lang="ts">
  import { CwCard } from '@cropwatchdevelopment/cwui';
  import CodeBlock from '../lib/CodeBlock.svelte';

  const origin =
    typeof window !== 'undefined' ? window.location.origin : 'https://api.cropwatch.io';

  const clientConfig = `{
  "mcpServers": {
    "cropwatch": {
      "type": "streamable-http",
      "url": "${origin}/v1/mcp",
      "headers": { "Authorization": "Bearer <token>" }
    }
  }
}`;

  const inspector = `npx @modelcontextprotocol/inspector
# Transport: Streamable HTTP
# URL:       ${origin}/v1/mcp
# Header:    Authorization: Bearer <token>`;
</script>

<section id="mcp" class="section">
  <span class="eyebrow">New</span>
  <h2 class="section__title">Model Context Protocol server</h2>
  <p class="section__lede">
    Point an MCP client (Claude, Cursor, …) at <code>{origin}/v1/mcp</code> over Streamable HTTP.
    It authenticates with the same bearer token and exposes read-only, user-scoped tools.
  </p>

  <div class="grid grid--2" style="margin-top: var(--cw-space-6)">
    <CwCard title="Available tools">
      <ul style="margin:0; padding-left:1.2rem; line-height:1.8">
        <li><code>list_devices</code> — list devices you can access (filter + paginate).</li>
        <li><code>get_device</code> — fetch one device by <code>dev_eui</code>.</li>
      </ul>
      <p class="muted" style="font-size:var(--cw-text-sm); margin:var(--cw-space-3) 0 0">
        Every call runs through the same auth and row-level security as the REST API, so a client
        only ever sees what its token permits.
      </p>
    </CwCard>

    <div class="stack">
      <CwCard title="Connect a client">
        <CodeBlock tabs={[{ label: 'client config', code: clientConfig }]} />
      </CwCard>
      <CwCard title="Try it locally">
        <CodeBlock tabs={[{ label: 'MCP Inspector', code: inspector }]} />
      </CwCard>
    </div>
  </div>
</section>
