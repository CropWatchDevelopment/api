<script lang="ts">
  import { CwCard } from '@cropwatchdevelopment/cwui';
</script>

<section id="conventions" class="section">
  <span class="eyebrow">Conventions</span>
  <h2 class="section__title">Working with the API</h2>

  <div class="grid grid--3" style="margin-top: var(--cw-space-6)">
    <CwCard title="Versioning">
      All routes are served under <code>/v1</code> (URI versioning). Treat the prefix as required.
    </CwCard>
    <CwCard title="Pagination">
      List endpoints accept <code>skip</code> and <code>take</code>; device listings cap
      <code>take</code> at 1000.
    </CwCard>
    <CwCard title="Time ranges">
      Telemetry takes <code>start</code>/<code>end</code> as ISO 8601 plus an optional IANA
      <code>timezone</code>. Omit them for the last 24 hours.
    </CwCard>
    <CwCard title="Rate limits">
      Up to 2,000 requests per 2-second window and 2,000 per 60-second window. Bursting the short
      window pauses you for a few seconds; sustained abuse can block for 24h.
    </CwCard>
    <CwCard title="Errors">
      Standard NestJS error envelopes — a JSON body with <code>statusCode</code>,
      <code>error</code> and <code>message</code>.
    </CwCard>
    <CwCard title="Transport">
      Serve over TLS in production and send credentials per request; never embed keys in
      client-side apps.
    </CwCard>
  </div>
</section>
