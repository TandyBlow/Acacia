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
      path: '/node/:id',
      name: 'node',
      component: Empty,
    },
  ],
});

export default router;
