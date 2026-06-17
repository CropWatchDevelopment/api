<script lang="ts">
  import { CwCard } from '@cropwatchdevelopment/cwui';
  import { capabilities } from '../lib/api-data';
</script>

<section id="overview" class="section">
  <span class="eyebrow">Platform</span>
  <h2 class="section__title">What the CropWatch API delivers</h2>
  <p class="section__lede">
    One authenticated surface for telemetry, device operations, automation and billing —
    consumed over REST or by AI clients over MCP.
  </p>

  <div class="grid grid--3" style="margin-top: var(--cw-space-6)">
    {#each capabilities as c (c.title)}
      <CwCard title={c.title}>
        <p class="endpoint__summary" style="margin:0">{c.body}</p>
      </CwCard>
    {/each}
  </div>
</section>
