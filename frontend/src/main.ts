import { createApp } from 'vue';
import { createPinia } from 'pinia';
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate';
import App from './App.vue';
import router from './router';
import { setAuthAdapter } from './stores/authStore';
import { setNavigator, setDataAdapter } from './stores/nodeStore';
import { loadAdapters } from './adapters';
import './style.css';

const app = createApp(App);
const pinia = createPinia();

pinia.use(piniaPluginPersistedstate);

app.use(pinia);

async function bootstrap(): Promise<void> {
  const { data, auth } = await loadAdapters();

  setAuthAdapter(auth);
  setDataAdapter(data);
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
}

bootstrap();
