type Locale = 'zh-CN' | 'en-US' | 'ar-SA';

type Dictionary = Record<string, string>;

const dictionaries: Record<Locale, Dictionary> = {
  'zh-CN': {
    'shell.title': 'AI Architecture Copilot',
    'nav.copilot': 'Copilot 工作台',
  },
  'en-US': {
    'shell.title': 'AI Architecture Copilot',
    'nav.copilot': 'Copilot Workbench',
  },
  'ar-SA': {
    'shell.title': 'AI Architecture Copilot',
    'nav.copilot': 'منصة Copilot',
  }
};

const listeners = new Set<() => void>();
let locale: Locale = (localStorage.getItem('enablement-locale') as Locale) || 'zh-CN';

function detectTimezone() {
  return (
    localStorage.getItem('enablement-timezone') ||
    Intl.DateTimeFormat().resolvedOptions().timeZone ||
    'Asia/Shanghai'
  );
}

function direction(nextLocale = locale) {
  return nextLocale === 'ar-SA' ? 'rtl' : 'ltr';
}

export const i18n = {
  locales: ['zh-CN', 'en-US', 'ar-SA'] as Locale[],
  get locale() {
    return locale;
  },
  get dir() {
    return direction(locale);
  },
  get timezone() {
    return detectTimezone();
  },
  setLocale(next: Locale) {
    locale = next;
    localStorage.setItem('enablement-locale', next);
    document.documentElement.lang = next;
    document.documentElement.dir = direction(next);
    listeners.forEach((listener) => listener());
  },
  t(key: string) {
    return dictionaries[locale]?.[key] || dictionaries['zh-CN'][key] || key;
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  async loadNamespace(namespace: string) {
    await new Promise((resolve) => setTimeout(resolve, 120));
    return { namespace, source: 'Crowdin -> Nacos -> Browser Cache', locale };
  }
};

document.documentElement.lang = locale;
document.documentElement.dir = direction(locale);
