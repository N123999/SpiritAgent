import i18n from 'i18next';

import en from '../locales/en.json' with { type: 'json' };
import zhCN from '../locales/zh-CN.json' with { type: 'json' };

const resources = {
  'zh-CN': { translation: zhCN },
  en: { translation: en },
};

const instance = i18n.createInstance();

instance.init({
  resources,
  lng: 'zh-CN',
  fallbackLng: 'zh-CN',
  interpolation: {
    escapeValue: false,
  },
});

export default instance;
