<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute, useRouter, RouterLink, RouterView } from "vue-router";
import { useI18n } from "./composables/useI18n.js";
import { useAuth } from "./composables/useAuth.js";
import AiSettings from "./components/AiSettings.vue";

const { lang, t, setLang } = useI18n();
const { isAuthenticated, email, logout } = useAuth();
const route = useRoute();
const router = useRouter();

const isLogin = computed(() => route.name === "login");

watch(
  lang,
  () => {
    document.documentElement.lang = lang.value;
    document.documentElement.dir = lang.value === "ar" ? "rtl" : "ltr";
    document.title = t.value.title;
  },
  { immediate: true }
);

const brandTo = computed(() => ({ name: "home" }));
const fundsOpen = ref(false);
const fundsActive = computed(() => route.name === "funds" || route.name === "my-funds");

function closeFunds() {
  fundsOpen.value = false;
}
function toggleFunds() {
  fundsOpen.value = !fundsOpen.value;
}
function onDocClick(e) {
  if (!e.target.closest?.(".nav-drop")) closeFunds();
}
watch(() => route.fullPath, closeFunds);
onMounted(() => document.addEventListener("click", onDocClick));
onUnmounted(() => document.removeEventListener("click", onDocClick));

function onLogout() {
  logout();
  router.replace({ name: "login" });
}
</script>

<template>
  <div v-if="isLogin" class="wrap login-wrap">
    <RouterView />
  </div>

  <div v-else class="wrap">
    <div class="topbar">
      <header>
        <RouterLink class="brand" :to="brandTo">EGX</RouterLink>
        <p class="lede">{{ t.lede }}</p>
      </header>
      <div class="top-actions">
        <div class="lang-toggle" role="group" aria-label="Language">
          <button type="button" :class="{ active: lang === 'ar' }" @click="setLang('ar')">
            عربي
          </button>
          <button type="button" :class="{ active: lang === 'en' }" @click="setLang('en')">
            English
          </button>
        </div>
        <AiSettings />
        <button
          v-if="isAuthenticated"
          type="button"
          class="logout-btn"
          :title="email"
          @click="onLogout"
        >
          {{ t.logout }}
        </button>
      </div>
    </div>

    <nav class="main-nav" aria-label="Main">
      <RouterLink
        class="nav-link"
        :class="{ active: route.name === 'home' }"
        :to="{ name: 'home' }"
      >
        {{ t.navHome }}
      </RouterLink>
      <RouterLink
        class="nav-link"
        :class="{ active: route.name === 'scalp' }"
        :to="{ name: 'scalp' }"
      >
        {{ t.navScalp }}
      </RouterLink>
      <div class="nav-drop" :class="{ open: fundsOpen }">
        <button
          type="button"
          class="nav-link nav-drop-btn"
          :class="{ active: fundsActive }"
          :aria-expanded="fundsOpen"
          aria-haspopup="true"
          @click.stop="toggleFunds"
        >
          {{ t.navFunds }}
        </button>
        <div v-show="fundsOpen" class="nav-drop-menu" role="menu">
          <RouterLink class="nav-drop-item" :class="{ active: route.name === 'funds' }" :to="{ name: 'funds' }">
            {{ t.navFundsAll }}
          </RouterLink>
          <RouterLink class="nav-drop-item" :class="{ active: route.name === 'my-funds' }" :to="{ name: 'my-funds' }">
            {{ t.navMyFunds }}
          </RouterLink>
        </div>
      </div>
    </nav>

    <RouterView />
  </div>
</template>
