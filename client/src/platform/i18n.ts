type Locale = 'zh-CN' | 'en-US' | 'ar-SA';

type Dictionary = Record<string, string>;

const dictionaries: Record<Locale, Dictionary> = {
  'zh-CN': {
    'shell.title': 'Enablement AI',
    'nav.overview': '平台总览',
    'nav.terminals': '三端展业',
    'nav.assistant': '企微 AI 助手',
    'nav.knowledge': '知识库 RAG',
    'nav.spec': 'Spec Coding',
    'nav.skills': 'AI Skill 编排',
    'nav.annotation': '标注工作台',
    'nav.flow-editor': '低码流程编辑器',
    'nav.i18n': '国际化治理',
    'nav.im': '在线 IM',
    'nav.ops': '发布运维'
  },
  'en-US': {
    'shell.title': 'Enablement AI',
    'nav.overview': 'Overview',
    'nav.terminals': 'Terminals',
    'nav.assistant': 'WeCom Assistant',
    'nav.knowledge': 'Knowledge RAG',
    'nav.spec': 'Spec Coding',
    'nav.skills': 'AI Skill',
    'nav.annotation': 'Annotation',
    'nav.flow-editor': 'Flow Editor',
    'nav.i18n': 'I18n Governance',
    'nav.im': 'Online IM',
    'nav.ops': 'Release Ops'
  },
  'ar-SA': {
    'shell.title': 'Enablement AI',
    'nav.overview': 'لوحة عامة',
    'nav.terminals': 'قنوات الموظف',
    'nav.assistant': 'مساعد WeCom',
    'nav.knowledge': 'قاعدة المعرفة',
    'nav.spec': 'Spec Coding',
    'nav.skills': 'مهارات AI',
    'nav.annotation': 'منصة الوسم',
    'nav.flow-editor': 'محرر التدفق',
    'nav.i18n': 'حوكمة الترجمة',
    'nav.im': 'محادثة مباشرة',
    'nav.ops': 'الإصدار والتشغيل'
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
