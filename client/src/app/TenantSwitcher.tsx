import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Loader2, Search, Shield, Users } from 'lucide-react';
import { request } from '../api/client';

interface TenantEntry {
  tenantId: string;
  role: string;
  displayName?: string;
}

interface TenantUser {
  _id?: string;
  name?: string;
  tenant?: { id: string; name?: string; role?: string };
  tenants?: TenantEntry[];
  tenantId?: string;
  role?: string;
  activeTenantId?: string;
}

interface TenantSwitcherProps {
  user: TenantUser;
  onSwitchTenant: (nextUser: TenantUser) => void;
}

function formatTenantDisplayName(tenantId: string, fallback?: string) {
  if (fallback && fallback !== tenantId) return fallback;
  return tenantId
    .replace(/^tenant-?/, '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function useTenantList(user: TenantUser) {
  const currentTenantId = user.tenant?.id || user.activeTenantId || user.tenantId || '';
  const list = useMemo<TenantEntry[]>(() => {
    if (Array.isArray(user.tenants) && user.tenants.length) {
      return user.tenants.map((entry) => ({
        ...entry,
        displayName: formatTenantDisplayName(entry.tenantId)
      }));
    }
    return [
      {
        tenantId: currentTenantId,
        role: user.tenant?.role || user.role || 'member',
        displayName: formatTenantDisplayName(currentTenantId, user.tenant?.name)
      }
    ];
  }, [currentTenantId, user.role, user.tenant, user.tenants]);

  const currentRole = useMemo(() => {
    return (
      user.tenant?.role ||
      list.find((t) => t.tenantId === currentTenantId)?.role ||
      user.role ||
      'member'
    );
  }, [currentTenantId, list, user.role, user.tenant?.role]);

  return { currentTenantId, tenantList: list, currentRole };
}

function clearTenantRuntimeState(currentTenantId: string) {
  try {
    const prefix = `aidemo:`;
    const keysToRemove: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (!key) continue;
      // 只清理当前租户的运行时快照，不清理基座 keepalive 的 appId（由外层重新写入）
      if (key.startsWith(`${prefix}session:${currentTenantId}:`)) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((key) => sessionStorage.removeItem(key));
  } catch {
    // ignore
  }
}

export function TenantSwitcher({ user, onSwitchTenant }: TenantSwitcherProps) {
  const { currentTenantId, tenantList, currentRole } = useTenantList(user);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [confirmTenant, setConfirmTenant] = useState<TenantEntry | null>(null);
  const [error, setError] = useState('');
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});
  const [placement, setPlacement] = useState<'top' | 'bottom'>('top');
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const currentTenant = useMemo(
    () => tenantList.find((t) => t.tenantId === currentTenantId) || tenantList[0],
    [currentTenantId, tenantList]
  );

  const filteredList = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tenantList;
    return tenantList.filter(
      (t) =>
        t.tenantId.toLowerCase().includes(q) ||
        (t.displayName || '').toLowerCase().includes(q)
    );
  }, [query, tenantList]);

  const computePosition = () => {
    const trigger = triggerRef.current;
    const dropdown = dropdownRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const dropdownWidth = 280;
    const gap = 8;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // 水平方向：优先左对齐 trigger，右侧超出视口则左移
    let left = rect.left;
    if (left + dropdownWidth > viewportWidth - 16) {
      left = Math.max(16, rect.right - dropdownWidth);
    }

    // 垂直方向：默认向上展开；若上方空间不足则向下展开
    const dropdownHeight = dropdown?.offsetHeight ?? 320;
    const spaceAbove = rect.top - gap;
    const spaceBelow = viewportHeight - rect.bottom - gap;

    let nextPlacement: 'top' | 'bottom';
    let top: number;
    if (spaceAbove >= dropdownHeight || spaceAbove >= spaceBelow) {
      nextPlacement = 'top';
      top = rect.top - gap; // CSS 用 bottom 锚定，这里先占位
    } else {
      nextPlacement = 'bottom';
      top = rect.bottom + gap;
    }

    // 避免超出视口底部/顶部
    if (nextPlacement === 'bottom') {
      const maxTop = viewportHeight - dropdownHeight - 16;
      if (top > maxTop) top = Math.max(gap, maxTop);
    } else {
      // top 展开时：先让 bottom 对齐 trigger 上方，再限制顶部不超出视口
      const bottom = rect.top - gap;
      const minTop = 16;
      const calculatedTop = bottom - dropdownHeight;
      top = Math.max(minTop, calculatedTop);
    }

    setPlacement(nextPlacement);
    setDropdownStyle({
      position: 'fixed',
      left,
      top,
      width: dropdownWidth,
      maxHeight: Math.min(360, viewportHeight - 32)
    });
  };

  useLayoutEffect(() => {
    if (!open) {
      setDropdownStyle({});
      return;
    }
    computePosition();
    // 下拉高度在渲染后才能确定，延迟再校准一次
    const raf = requestAnimationFrame(() => computePosition());
    const timer = setTimeout(computePosition, 50);

    function onResize() {
      computePosition();
    }
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onResize, true);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onResize, true);
    };
  }, [open, tenantList.length]);

  useEffect(() => {
    function onDocClick(event: MouseEvent) {
      const target = event.target as Node;
      const insideTrigger = containerRef.current?.contains(target);
      const insideDropdown = dropdownRef.current?.contains(target);
      if (!insideTrigger && !insideDropdown) {
        setOpen(false);
        setQuery('');
      }
    }
    if (open) {
      document.addEventListener('mousedown', onDocClick);
      setTimeout(() => searchRef.current?.focus(), 0);
    }
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  async function doSwitch(target: TenantEntry) {
    if (target.tenantId === currentTenantId || loading) return;
    setLoading(true);
    setError('');
    try {
      const result = await request('/api/auth/switch-tenant', {
        method: 'POST',
        body: JSON.stringify({ tenantId: target.tenantId })
      });
      localStorage.setItem('tenantId', result.tenant?.id || target.tenantId);

      clearTenantRuntimeState(currentTenantId);

      const me = await request('/api/auth/me');
      const nextUser = { ...me.user, tenant: me.tenant, tenants: me.tenants };
      onSwitchTenant(nextUser);
      setOpen(false);
      setQuery('');
      setConfirmTenant(null);
    } catch (err) {
      const message = (err as Error).message || '';
      setError(
        message.includes('fetch') || message.includes('network')
          ? '网络请求失败，请检查后端服务是否已启动（npm run dev）'
          : message || '切换失败'
      );
    } finally {
      setLoading(false);
    }
  }

  function onSelectTenant(entry: TenantEntry) {
    if (entry.tenantId === currentTenantId) {
      setOpen(false);
      return;
    }
    setConfirmTenant(entry);
  }

  return (
    <div className="tenant-switcher" ref={containerRef}>
      <button
        ref={triggerRef}
        type="button"
        className={`tenant-current ${open ? 'open' : ''} ${loading ? 'loading' : ''}`}
        onClick={() => !loading && setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={loading}
      >
        <span className="tenant-current-icon">
          {loading ? <Loader2 size={16} className="spin" /> : <Users size={16} />}
        </span>
        <span className="tenant-current-info">
          <strong>{currentTenant?.displayName || currentTenantId}</strong>
          <em>{currentRole}</em>
        </span>
        <ChevronDown size={16} className="tenant-current-chevron" />
      </button>

      {open &&
        createPortal(
          <div
            ref={dropdownRef}
            className={`tenant-dropdown tenant-dropdown-${placement}`}
            role="listbox"
            style={dropdownStyle}
          >
            <div className="tenant-dropdown-header">
              <span>切换工作空间</span>
              <small>{tenantList.length} 个租户</small>
            </div>

            {tenantList.length > 4 && (
              <div className="tenant-search">
                <Search size={14} />
                <input
                  ref={searchRef}
                  type="text"
                  placeholder="搜索租户"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
            )}

            <div className="tenant-options">
              {filteredList.map((entry) => {
                const active = entry.tenantId === currentTenantId;
                return (
                  <button
                    key={entry.tenantId}
                    type="button"
                    role="option"
                    aria-selected={active}
                    className={`tenant-option ${active ? 'active' : ''}`}
                    onClick={() => onSelectTenant(entry)}
                  >
                    <span className="tenant-option-avatar">
                      {entry.tenantId.slice(0, 2).toUpperCase()}
                    </span>
                    <span className="tenant-option-meta">
                      <strong>{entry.displayName || entry.tenantId}</strong>
                      <em>{entry.tenantId}</em>
                    </span>
                    <span className="tenant-option-role">
                      <Shield size={12} />
                      {entry.role}
                    </span>
                    {active && <Check size={16} className="tenant-option-check" />}
                  </button>
                );
              })}
              {filteredList.length === 0 && (
                <div className="tenant-empty">未找到匹配租户</div>
              )}
            </div>
          </div>,
          document.body
        )}

      {confirmTenant &&
        createPortal(
          <div className="tenant-confirm-overlay">
            <div className="tenant-confirm-panel">
              <h4>切换工作空间？</h4>
              <p>
                即将从 <strong>{currentTenant?.displayName || currentTenantId}</strong> 切换到{' '}
                <strong>{confirmTenant.displayName || confirmTenant.tenantId}</strong>
                。当前未保存的数据可能会丢失。
              </p>
              {error ? <div className="tenant-confirm-error">{error}</div> : null}
              <div className="tenant-confirm-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    setConfirmTenant(null);
                    setError('');
                  }}
                  disabled={loading}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => doSwitch(confirmTenant)}
                  disabled={loading}
                >
                  {loading ? <Loader2 size={14} className="spin" /> : null}
                  确认切换
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
