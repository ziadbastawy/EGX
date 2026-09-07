<script setup>
import { computed } from "vue";
import { RouterLink } from "vue-router";
import ScalpSession from "../components/ScalpSession.vue";
import { useI18n } from "../composables/useI18n.js";
import { formatSessionDay, getNextEgxSessionDate } from "../lib/sessionDate.js";

const { t, locale } = useI18n();
const sessionDay = computed(() => formatSessionDay(getNextEgxSessionDate(), locale.value));
</script>

<template>
  <div class="scalp-page">
    <RouterLink class="back" :to="{ name: 'home' }">{{ t.back }}</RouterLink>
    <header class="scalp-page-head">
      <h1>{{ t.scalpPageTitle }}</h1>
      <p>{{ t.scalpPageLede }}</p>
    </header>

    <h2 class="scalp-group-title">{{ t.scalpSessionTitle(sessionDay) }}</h2>
    <div class="scalp-duo">
      <ScalpSession horizon="session" mode="local" :locale="locale" :limit="8" />
      <ScalpSession horizon="session" mode="ai" :locale="locale" :limit="6" />
    </div>

    <h2 class="scalp-group-title">{{ t.weekGroupTitle }}</h2>
    <div class="scalp-duo">
      <ScalpSession horizon="week" mode="local" :locale="locale" :limit="8" />
      <ScalpSession horizon="week" mode="ai" :locale="locale" :limit="6" />
    </div>
  </div>
</template>
