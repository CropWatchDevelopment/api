<script lang="ts">
  import { CwButton, CwCard, CwCopy } from '@cropwatchdevelopment/cwui';

  const origin =
    typeof window !== 'undefined' ? window.location.origin : 'https://api.cropwatch.io';

  function go(hash: string) {
    window.location.assign(hash);
  }
  function openDocs() {
    window.location.assign('/docs');
  }
</script>

<section class="hero">
  <div class="container hero__grid">
    <div>
      <span class="eyebrow">Developer Platform</span>
      <h1>Build on your <span class="accent">CropWatch</span> sensor data.</h1>
      <p class="hero__lede">
        A secure, rate-limited REST API for IoT telemetry, device &amp; location management,
        automation and billing — plus a Model Context Protocol server so AI clients can call
        it directly.
      </p>
      <div class="row hero__cta">
        <CwButton variant="primary" onclick={() => go('#auth')}>Get an access token</CwButton>
        <CwButton variant="secondary" onclick={openDocs}>Interactive docs</CwButton>
      </div>
    </div>

    <CwCard elevated title="Quickstart" subtitle="What you send on every call">
      <div class="stack">
        <div class="kv">
          <span class="kv__label">Base URL</span>
          <CwCopy value={origin} size="sm"><span class="kv__value">{origin}</span></CwCopy>
        </div>
        <div class="kv">
          <span class="kv__label">Header</span>
          <CwCopy value="Authorization: Bearer <token>" size="sm">
            <span class="kv__value">Authorization: Bearer &lt;token&gt;</span>
          </CwCopy>
        </div>
        <div class="kv">
          <span class="kv__label">Version</span>
          <span class="kv__value">/v1 · URI versioned</span>
        </div>
        <p class="muted" style="font-size:var(--cw-text-sm); margin:0">
          New here? Start at <a href="#auth">Authentication</a> to mint a token, then explore
          every operation in <a href="/docs">the interactive docs</a>.
        </p>
      </div>
    </CwCard>
  </div>
</section>
