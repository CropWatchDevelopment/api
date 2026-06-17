<script lang="ts">
  import type { HttpMethod } from './api-data';

  // NOTE: CWUI's CwChip ships without a template in v0.1.107 (renders nothing),
  // so we render a small token-styled tag instead — same look, no dependency.
  let { method }: { method: HttpMethod } = $props();

  const toneClass: Record<HttpMethod, string> = {
    GET: 'is-get',
    POST: 'is-post',
    PATCH: 'is-patch',
    PUT: 'is-patch',
    DELETE: 'is-delete',
  };
</script>

<span class="method-tag {toneClass[method]}">{method}</span>
