<script lang="ts">
  import { CwCopy } from '@cropwatchdevelopment/cwui';

  export interface CodeTab {
    label: string;
    code: string;
  }

  let { tabs }: { tabs: CodeTab[] } = $props();
  let active = $state(0);
</script>

<div class="codeblock">
  <div class="codeblock__bar">
    <div class="codeblock__tabs">
      {#each tabs as tab, i (tab.label)}
        <button
          type="button"
          class="codeblock__tab"
          class:is-active={i === active}
          aria-pressed={i === active}
          onclick={() => (active = i)}
        >
          {tab.label}
        </button>
      {/each}
    </div>
    <CwCopy value={tabs[active].code} size="sm" />
  </div>
  <pre class="codeblock__pre"><code>{tabs[active].code}</code></pre>
</div>
