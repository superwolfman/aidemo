import { useEffect, useState } from 'react';
import { Globe2, Languages, ShieldCheck } from 'lucide-react';
import { Card, Header, Metric, Status } from '../../components/ui';
import { i18n } from '../../platform/i18n';

export default function I18nGovernance() {
  const [locale, setLocale] = useState(i18n.locale);
  const [namespace, setNamespace] = useState({ namespace: 'common', source: 'Crowdin -> Nacos -> Browser Cache', locale });

  useEffect(() => {
    i18n.loadNamespace('enablement-platform').then(setNamespace);
  }, [locale]);

  function changeLocale(next: typeof i18n.locales[number]) {
    i18n.setLocale(next);
    setLocale(next);
  }

  return (
    <section>
      <Header
        title="国际化治理中心"
        desc="面向多产品线的前后端分离国际化方案：Crowdin 管理、Nacos 存储、前端动态加载、多实例缓存、优雅降级、RTL 与质量门禁。"
        action={<Status status={i18n.dir} />}
      />

      <div className="metric-grid">
        <Metric icon={Languages} label="已接入语言" value={i18n.locales.length} />
        <Metric icon={Globe2} label="当前语言" value={locale} />
        <Metric icon={ShieldCheck} label="翻译覆盖率" value="98.6%" />
        <Metric icon={Globe2} label="时区策略" value={i18n.timezone} />
      </div>

      <div className="two-column">
        <section className="panel">
          <h2>运行时切换</h2>
          <div className="segmented-row">
            {i18n.locales.map((item) => (
              <button key={item} className={locale === item ? 'active' : ''} onClick={() => changeLocale(item)}>
                {item}
              </button>
            ))}
          </div>
          <div className="rtl-preview" dir={i18n.dir}>
            <strong>{i18n.t('nav.i18n')}</strong>
            <p>这块区域跟随 `document.dir` 自动切换 LTR / RTL，用于验证阿语、希伯来语等从右至左语言。</p>
          </div>
        </section>

        <section className="panel">
          <h2>自动化管道</h2>
          <div className="pipeline-list">
            <div><span>1</span><strong>Crowdin</strong><p>产品线提交 key，翻译平台管理多语言与审核。</p></div>
            <div><span>2</span><strong>Nacos</strong><p>按 namespace / version 存储词条，支持灰度和回滚。</p></div>
            <div><span>3</span><strong>@company/i18n-sdk</strong><p>多实例、缓存、动态加载、优雅降级和 RTL 注入。</p></div>
            <div><span>4</span><strong>CI Quality Gate</strong><p>ESLint 拦截硬编码，CI 检查翻译覆盖率和缺失 key。</p></div>
          </div>
        </section>
      </div>

      <section className="panel">
        <h2>核心策略</h2>
        <div className="capability-grid">
          <Card title="时区四级识别" text="用户设置 > 请求头 > 浏览器 Intl > 系统默认，保证 PC/H5/企微一致。" />
          <Card title="RTL 自动适配" text="PostCSS rtlcss 插件把逻辑属性自动转换，兼容 Ant Design 等第三方库。" />
          <Card title="动态加载" text={`已加载 namespace: ${namespace.namespace}，来源: ${namespace.source}`} />
        </div>
      </section>
    </section>
  );
}
