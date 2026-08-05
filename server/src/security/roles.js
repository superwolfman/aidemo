// 统一角色定义，避免各处的字符串散落导致权限判定不一致。
export const ROLES = {
  ADMIN: 'admin',
  MEMBER: 'member',
  SERVICE: 'service',
  OWNER: 'owner'
};

export const PRIVILEGED_ROLES = new Set([ROLES.ADMIN, ROLES.SERVICE, ROLES.OWNER]);

// 特权角色可跨用户查看本租户数据（运营/服务账号场景）。
export function isPrivileged (role) {
  return PRIVILEGED_ROLES.has(String(role));
}
