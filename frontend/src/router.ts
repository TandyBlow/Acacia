import { createRouter, createWebHistory } from 'vue-router';
import { h } from 'vue';

const Empty = { render: () => h('div') };

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'home',
      component: Empty,
    },
    {
      path: '/:pathMatch(.*)*',
      redirect: '/',
    },
  ],
});

export default router;
