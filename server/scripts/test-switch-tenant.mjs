async function login() {
  const res = await fetch('http://127.0.0.1:4000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'removed-default-admin@example.invalid', password: 'removed-public-password' })
  });
  return res.json();
}

async function switchTenant(token, tenantId) {
  const res = await fetch('http://127.0.0.1:4000/api/auth/switch-tenant', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ tenantId })
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return res.json();
}

try {
  const first = await login();
  console.log('login tenant:', first.tenant);

  const second = await switchTenant(first.token, 'tenant-demo-2');
  console.log('switch to demo-2:', second.tenant);

  const third = await switchTenant(second.token, 'tenant-demo');
  console.log('switch back to demo:', third.tenant);

  console.log('round-trip OK');
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
