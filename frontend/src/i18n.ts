import { createI18n } from 'vue-i18n';
import zhCN from './locales/zh-CN';
import enUS from './locales/en-US';

type AppLocale = 'zh-CN' | 'en-US';

function detectLocale(): AppLocale {
  const stored = localStorage.getItem('acacia_locale');
  if (stored === 'zh-CN' || stored === 'en-US') return stored;
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
    'en-US': enUS,
  },
});

if (typeof window !== 'undefined') {
  window.addEventListener('languagechange', () => {
    const stored = localStorage.getItem('acacia_locale');
    if (!stored) {
      i18n.global.locale.value = detectLocale();
    }
  });
}

export default i18n;
