<script setup>
import { ref } from "vue";
import { useI18n } from "../composables/useI18n.js";
import { useAiSettings } from "../composables/useAiSettings.js";
import { apiUrl, getApiBase, setApiBase } from "../lib/api.js";

const { t } = useI18n();
const { state, aiHeaders, setProvider, clearKeys } = useAiSettings();

const open = ref(false);
const apiBase = ref(getApiBase());
const testing = ref(false);
const testResult = ref(null); // { ok: boolean, message: string }

function onApiBaseInput(e) {
  apiBase.value = setApiBase(e.target.value);
}

function close() {
  open.value = false;
}

function pingUrls() {
  const urls = [];
  const add = (u) => {
    if (u && !urls.includes(u)) urls.push(u);
  };
  add("/api/ai-ping");
  add(apiUrl("/api/ai-ping"));
  return urls;
}

async function testKey() {
  if (testing.value) return;
  const provider = state.provider === "openai" ? "openai" : "cursor";
  const key =
    provider === "openai" ? state.openaiKey.trim() : state.cursorKey.trim();
  if (!key) {
    testResult.value = { ok: false, message: t.value.settingsTestMissing };
    return;
  }

  testing.value = true;
  testResult.value = null;
  let lastErr = null;
  try {
    for (const url of pingUrls()) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...aiHeaders() },
          body: JSON.stringify({}),
        });
        const data = await res.json().catch(() => ({}));
        if (res.status === 404 || res.status === 405) {
          lastErr = new Error("api missing");
          continue;
        }
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        testResult.value = {
          ok: true,
          message: t.value.settingsTestOk(data.provider || provider, data.model || ""),
        };
        return;
      } catch (err) {
        lastErr = err;
        if (!/failed to fetch|networkerror|load failed|api missing/i.test(String(err.message))) {
          throw err;
        }
      }
    }
    throw lastErr || new Error(t.value.settingsTestFail);
  } catch (err) {
    testResult.value = {
      ok: false,
      message: err.message || t.value.settingsTestFail,
    };
  } finally {
    testing.value = false;
  }
}
</script>

<template>
  <button
    type="button"
    class="settings-btn"
    :title="t.settingsCta"
    :aria-label="t.settingsCta"
    @click="open = true"
  >
    <span class="settings-gear" aria-hidden="true">⚙</span>
    <span class="settings-btn-label">{{ t.settingsActive }}:</span>
    <strong class="settings-provider-tag">
      {{ state.provider === "openai" ? t.providerOpenAI : t.providerCursor }}
    </strong>
  </button>

  <teleport to="body">
    <div v-if="open" class="settings-overlay" @click.self="close">
      <div class="settings-modal" role="dialog" aria-modal="true">
        <div class="settings-modal-head">
          <h3>{{ t.settingsTitle }}</h3>
          <button type="button" class="settings-close" :aria-label="t.settingsDone" @click="close">
            ✕
          </button>
        </div>

        <div class="settings-field">
          <span class="settings-label">{{ t.settingsProvider }}</span>
          <div class="settings-providers" role="group">
            <button
              type="button"
              :class="{ active: state.provider === 'cursor' }"
              @click="setProvider('cursor'); testResult = null"
            >
              {{ t.providerCursor }}
            </button>
            <button
              type="button"
              :class="{ active: state.provider === 'openai' }"
              @click="setProvider('openai'); testResult = null"
            >
              {{ t.providerOpenAI }}
            </button>
          </div>
        </div>

        <template v-if="state.provider === 'openai'">
          <label class="settings-field">
            <span class="settings-label">{{ t.settingsOpenAiKey }}</span>
            <textarea
              v-model="state.openaiKey"
              class="settings-key"
              rows="3"
              placeholder="sk-..."
              autocomplete="off"
              spellcheck="false"
            ></textarea>
          </label>
          <label class="settings-field">
            <span class="settings-label">{{ t.settingsModel }}</span>
            <input
              v-model="state.openaiModel"
              type="text"
              :placeholder="t.settingsModelPh"
              autocomplete="off"
              spellcheck="false"
            />
          </label>
        </template>

        <template v-else>
          <label class="settings-field">
            <span class="settings-label">{{ t.settingsCursorKey }}</span>
            <textarea
              v-model="state.cursorKey"
              class="settings-key"
              rows="3"
              :placeholder="t.settingsCursorKeyPh"
              autocomplete="off"
              spellcheck="false"
            ></textarea>
          </label>
        </template>

        <label class="settings-field">
          <span class="settings-label">{{ t.settingsApiBase }}</span>
          <input
            :value="apiBase"
            type="url"
            :placeholder="t.settingsApiBasePh"
            autocomplete="off"
            spellcheck="false"
            @change="onApiBaseInput"
            @blur="onApiBaseInput"
          />
        </label>

        <p class="settings-hint">{{ t.settingsHint }}</p>

        <p
          v-if="testResult"
          class="settings-test-msg"
          :class="testResult.ok ? 'ok' : 'bad'"
        >
          {{ testResult.message }}
        </p>

        <div class="settings-actions">
          <button type="button" class="settings-clear" @click="clearKeys(); testResult = null">
            {{ t.settingsClear }}
          </button>
          <button
            type="button"
            class="btn-secondary settings-test"
            :disabled="testing"
            @click="testKey"
          >
            {{ testing ? t.settingsTestBusy : t.settingsTest }}
          </button>
          <button type="button" class="ai-btn" @click="close">
            {{ t.settingsDone }}
          </button>
        </div>
      </div>
    </div>
  </teleport>
</template>
