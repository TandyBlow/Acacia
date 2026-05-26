import { createApp } from 'vue';
import { createPinia } from 'pinia';
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate';
import AdminApp from './admin/AdminApp.vue';
import { setAuthAdapter } from './stores/authStore';
import { loadAuthAdapter } from './adapters';

const app = createApp(AdminApp);
const pinia = createPinia();
pinia.use(piniaPluginPersistedstate);
app.use(pinia);

async function bootstrap(): Promise<void> {
  const auth = await loadAuthAdapter();
  setAuthAdapter(auth);
  app.mount('#admin-app');
}

bootstrap();
