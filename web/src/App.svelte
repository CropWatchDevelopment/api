<script lang="ts">
  import { CwButton, CwThemePicker } from '@cropwatchdevelopment/cwui';
  import Hero from './sections/Hero.svelte';
  import WhatItDelivers from './sections/WhatItDelivers.svelte';
  import Auth from './sections/Auth.svelte';
  import Resources from './sections/Resources.svelte';
  import Mcp from './sections/Mcp.svelte';
  import Conventions from './sections/Conventions.svelte';
  import SiteFooter from './sections/SiteFooter.svelte';

  function openDocs() {
    window.location.assign('/docs');
  }
</script>

<header class="site-header">
  <div class="container site-header__inner">
    <a class="brand" href="#top" aria-label="CropWatch API home">
      <img src="/favicon.svg" alt="" />
      <span class="brand__text" style="display:flex; flex-direction:column; line-height:1.1">
        <span class="brand__name">CropWatch API</span>
        <span class="brand__tag">Developer Platform</span>
      </span>
    </a>

    <nav class="site-nav" aria-label="Primary">
      <a href="#overview">Overview</a>
      <a href="#auth">Auth</a>
      <a href="#resources">Resources</a>
      <a href="#mcp">MCP</a>
    </nav>

    <CwThemePicker />
    <CwButton size="sm" variant="primary" onclick={openDocs}>Open Docs</CwButton>
  </div>
</header>

<main id="top">
  <Hero />
  <div class="container">
    <WhatItDelivers />
    <Auth />
    <Resources />
    <Mcp />
    <Conventions />
  </div>
</main>

<SiteFooter />
