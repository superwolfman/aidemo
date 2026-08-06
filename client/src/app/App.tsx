import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { BrainCircuit, LogOut, PanelLeftClose, PanelLeftOpen, ShieldCheck, Users } from 'lucide-react';
import { request, tokenKey } from '../api/client';
import { TenantSwitcher } from './TenantSwitcher';
import { Header } from '../components/ui';
import { eventBus, AppEvents } from '../platform/events';
import { MicroAppContainer } from '../platform/microFrontend';
import { useShellRouter } from '../platform/router';
import { getSubApp, subApps, visibleSubApps } from '../platform/subapps';
import type { ShellContext } from '../platform/subapps';
import { i18n } from '../platform/i18n';

function Login({ onLogin }: { onLogin: (user: any) => void }) {
  const [email, setEmail] = useState('removed-default-admin@example.invalid');
  const [password, setPassword] = useState('removed-public-password');
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    try {
      const result = await request('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password })
      });
      localStorage.setItem(tokenKey, result.token);
      localStorage.setItem('tenantId', result.tenant?.id || '');
      onLogin({ ...result.user, tenant: result.tenant, tenants: result.tenants });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <main className="login-shell">
      <section className="login-panel">
        <div className="brand-row">
          <div className="brand-mark"><BrainCircuit size={26} /></div>
          <div>
            <h1>AI Architecture Copilot</h1>
            <p>面向架构师的 Agent 工程系统：多会话 Chat、Skill Runtime、Tool Calling、RAG、人工确认和 Trace。</p>
          </div>
        </div>
        <form className="form-stack" onSubmit={submit}>
          <label>邮箱<input value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <label>密码<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          {error ? <div className="error">{error}</div> : null}
          <button className="primary-button" type="submit"><ShieldCheck size={16} />进入平台</button>
        </form>
      </section>
    </main>
  );
}

function Shell({ user, onLogout, onSwitchTenant }: { user: any; onLogout: () => void; onSwitchTenant: (nextUser: any) => void }) {
  const router = useShellRouter();
  const app = getSubApp(router.appId);
  const [collapsed, setCollapsed] = useState(false);
  const [mountedAppIds, setMountedAppIds] = useState(() => new Set([app.id]));
  const [, forceI18nRender] = useState(0);
  const context = useMemo<ShellContext>(() => ({ user, eventBus, navigate: router.navigate, app }), [user, router.navigate, app]);

  const currentTenantId = user.tenant?.id || user.activeTenantId || user.tenantId;
  const currentRole = user.tenant?.role || user.role;

  // Keep Alive：按租户恢复最近使用的子应用路由
  useEffect(() => {
    const key = `aidemo:keepalive:${currentTenantId}:appId`;
    const saved = sessionStorage.getItem(key);
    if (saved && saved !== router.appId && visibleSubApps.some((item) => item.id === saved)) {
      router.navigate(saved);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTenantId]);

  // Keep Alive：保存当前子应用路由
  useEffect(() => {
    const key = `aidemo:keepalive:${currentTenantId}:appId`;
    sessionStorage.setItem(key, router.appId);
  }, [router.appId, currentTenantId]);

  function handleSwitchTenant(nextUser: any) {
    onSwitchTenant(nextUser);
    // 清空非当前子应用的挂载缓存，切换租户后强制子应用重新加载数据
    setMountedAppIds(new Set([router.appId]));
  }

  useEffect(() => i18n.subscribe(() => forceI18nRender((value) => value + 1)), []);
  useEffect(() => {
    setMountedAppIds((current) => {
      if (current.has(app.id)) return current;
      return new Set(current).add(app.id);
    });
  }, [app.id]);

  return (
    <div className={`app-shell ${collapsed ? 'app-shell-collapsed' : ''}`}>
      <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
        <div className="sidebar-title">
          <BrainCircuit size={24} />
          <span>{i18n.t('shell.title')}</span>
          <button
            className="sidebar-toggle"
            title={collapsed ? '展开目录' : '收起目录'}
            onClick={() => setCollapsed((value) => !value)}
          >
            {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>
        </div>
        <nav>
          {visibleSubApps.map((item) => {
            const Icon = item.icon;
            const label = i18n.t(item.labelKey);
            return (
              <button key={item.id} className={app.id === item.id ? 'active' : ''} title={label} onClick={() => router.navigate(item.id)}>
                <Icon size={18} />
                <span>{label}</span>
                <em className="sidebar-tooltip">{label}</em>
              </button>
            );
          })}
        </nav>
        <div className="user-box">
          <strong>{user.name}</strong>
          <span>{user.department} · {currentRole}</span>
          {Array.isArray(user.tenants) && user.tenants.length > 1 ? (
            <TenantSwitcher user={user} onSwitchTenant={handleSwitchTenant} />
          ) : (
            <div className="tenant-readonly">
              <Users size={14} />
              <span>{currentTenantId}</span>
              <em>{currentRole}</em>
            </div>
          )}
          <button onClick={onLogout}><LogOut size={16} />退出</button>
        </div>
      </aside>
      <main className="workspace">
        {subApps.filter((item) => item.id === app.id || mountedAppIds.has(item.id)).map((mountedApp) => {
          const active = mountedApp.id === app.id;
          return (
            <section
              key={mountedApp.id}
              className="micro-app-pane"
              hidden={!active}
              aria-hidden={!active}
            >
              <MicroAppContainer
                key={`${mountedApp.id}-${currentTenantId}`}
                app={mountedApp}
                context={{ ...context, app: mountedApp }}
              />
            </section>
          );
        })}
      </main>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    const off = eventBus.on(AppEvents.AUTH_LOGOUT, () => {
      localStorage.removeItem(tokenKey);
      setUser(null);
    });

    if (!localStorage.getItem(tokenKey)) {
      setBooting(false);
      return off;
    }

    request('/api/auth/me')
      .then((res) => setUser({ ...res.user, tenant: res.tenant, tenants: res.tenants }))
      .catch(() => localStorage.removeItem(tokenKey))
      .finally(() => setBooting(false));

    return off;
  }, []);

  if (booting) return <div className="boot">Loading...</div>;
  if (!user) return <Login onLogin={setUser} />;

  return (
    <Shell
      user={user}
      onLogout={() => {
        eventBus.emit(AppEvents.AUTH_LOGOUT, {});
      }}
      onSwitchTenant={setUser}
    />
  );
}

export function MicroFrontendContract() {
  return (
    <Header
      title="微前端基座契约"
      desc="每个模块以子应用 manifest 注册，由基座提供 user、eventBus、navigate、app 等上下文。"
    />
  );
}
