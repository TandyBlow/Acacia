import { createApp } from 'vue';
import { createPinia } from 'pinia';
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate';
import App from './App.vue';
import router from './router';
import { config } from './config';
import { setAuthAdapter } from './stores/authStore';
import { setNavigator } from './stores/nodeStore';
import { supabaseAuth } from './adapters/supabaseAuth';
import { localAuth } from './adapters/localAuth';
import './style.css';

const app = createApp(App);
const pinia = createPinia();

pinia.use(piniaPluginPersistedstate);

app.use(pinia);

setAuthAdapter(config.dataMode === 'supabase' ? supabaseAuth : localAuth);
setNavigator(
  (path, replace) => {
    if (replace) {
      router.replace(path);
    } else {
      router.push(path);
    }
  },
  () => (router.currentRoute.value.params.id as string) || null,
);

app.use(router);
app.mount('#app');
