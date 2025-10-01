<script setup lang="ts">
import AppHeader from '@/components/AppHeader.vue';
import FloatingPet from '@/components/FloatingPet.vue';
</script>

<template>
  <div id="app">
    <AppHeader />
    <RouterView />
    <FloatingPet />
  </div>
</template>

<style>
@font-face {
  font-family: "BMDOHYEON";
  src: url("../assets/fonts/BMDOHYEON_otf.otf") format("opentype");
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}

html,
body {
  font-family: "BMDOHYEON", "Noto Sans KR", sans-serif;
  line-height: 1.6;
  color: #111827;
}
</style>
