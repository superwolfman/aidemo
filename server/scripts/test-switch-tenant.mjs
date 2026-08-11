const baseUrl = process.env.TEST_API_BASE || 'http://127.0.0.1:4000';
const email = process.env.TEST_LOGIN_EMAIL;
const password = process.env.TEST_LOGIN_PASSWORD;
const origin = process.env.TEST_CLIENT_ORIGIN || 'http://127.0.0.1:5173';

if (!email || !password) {
  throw new Error('TEST_LOGIN_EMAIL and TEST_LOGIN_PASSWORD are required');
}

async function login() {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  if (!res.ok) throw new Error(`Login failed with HTTP ${res.status}`);
  return {
    body: await res.json(),
    cookie: res.headers.get('set-cookie')?.split(';')[0]
  };
}

async function switchTenant(cookie, tenantId) {
  const res = await fetch(`${baseUrl}/api/auth/switch-tenant`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: origin },
    body: JSON.stringify({ tenantId })
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return {
    body: await res.json(),
    cookie: res.headers.get('set-cookie')?.split(';')[0]
  };
}

try {
  const first = await login();
  console.log('login tenant:', first.body.tenant);

  const second = await switchTenant(first.cookie, 'tenant-demo-2');
  console.log('switch to demo-2:', second.body.tenant);

  const third = await switchTenant(second.cookie, 'tenant-demo');
  console.log('switch back to demo:', third.body.tenant);

  console.log('round-trip OK');
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
