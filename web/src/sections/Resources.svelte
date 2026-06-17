<script lang="ts">
  import { CwExpandPanel } from '@cropwatchdevelopment/cwui';
  import { resourceGroups } from '../lib/api-data';
  import MethodTag from '../lib/MethodTag.svelte';
</script>

<section id="resources" class="section">
  <span class="eyebrow">Reference</span>
  <h2 class="section__title">Resource catalog</h2>
  <p class="section__lede">
    Each group maps to a module in the API. Open one for its endpoints, or jump into the full
    interactive reference at <a href="/docs">/docs</a>.
  </p>

  <div class="stack" style="margin-top: var(--cw-space-6)">
    {#each resourceGroups as g (g.id)}
      <CwExpandPanel title={g.name}>
        <p class="muted" style="font-size:var(--cw-text-sm); margin:0 0 var(--cw-space-2)">
          {g.blurb} · {g.endpoints.length} endpoints
        </p>
        {#each g.endpoints as e (e.method + e.path)}
          <div class="endpoint">
            <MethodTag method={e.method} />
            <div>
              <div class="endpoint__path">{e.path}</div>
              <p class="endpoint__summary">{e.summary}</p>
              {#if e.params}
                <div class="endpoint__params">{e.params}</div>
              {/if}
            </div>
          </div>
        {/each}
      </CwExpandPanel>
    {/each}
  </div>
</section>
