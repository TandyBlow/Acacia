import { createI18n } from 'vue-i18n';
import zhCN from './locales/zh-CN';

function detectLocale(): string {
  const nav = navigator.language || 'zh-CN';
  if (nav.startsWith('zh')) return 'zh-CN';
  if (nav.startsWith('en')) return 'en-US';
  return 'zh-CN';
}

export const i18n = createI18n({
  legacy: false,
  locale: detectLocale(),
  fallbackLocale: 'zh-CN',
  messages: {
    'zh-CN': zhCN,
  },
});

export default i18n;
