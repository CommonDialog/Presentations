import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { useLogin, useRegister } from '../api/hooks.js';
import { Button, ErrorNote, Field, inputClass } from '../components/ui.js';

export function LoginPage() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [form, setForm] = useState({ organizationName: '', name: '', email: '', password: '' });
  const login = useLogin();
  const register = useRegister();
  const navigate = useNavigate();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (mode === 'login') {
      await login.mutateAsync({ email: form.email, password: form.password });
    } else {
      await register.mutateAsync(form);
    }
    navigate('/');
  };

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  return (
    <main className="mx-auto mt-16 max-w-sm rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
      <h1 className="mb-4 text-xl font-semibold text-gray-900">
        {mode === 'login' ? 'Sign in' : 'Create your organization'}
      </h1>
      <form onSubmit={(e) => void submit(e)} className="space-y-3">
        {mode === 'register' ? (
          <>
            <Field label="Organization name">
              <input
                className={inputClass}
                value={form.organizationName}
                onChange={set('organizationName')}
                required
              />
            </Field>
            <Field label="Your name">
              <input className={inputClass} value={form.name} onChange={set('name')} required />
            </Field>
          </>
        ) : null}
        <Field label="Email">
          <input
            className={inputClass}
            type="email"
            value={form.email}
            onChange={set('email')}
            required
          />
        </Field>
        <Field label="Password">
          <input
            className={inputClass}
            type="password"
            value={form.password}
            onChange={set('password')}
            minLength={mode === 'register' ? 10 : 1}
            required
          />
        </Field>
        <Button type="submit" disabled={login.isPending || register.isPending}>
          {mode === 'login' ? 'Sign in' : 'Create organization'}
        </Button>
        <ErrorNote error={mode === 'login' ? login.error : register.error} />
      </form>
      <button
        type="button"
        className="mt-4 text-sm text-blue-600 hover:underline"
        onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
      >
        {mode === 'login' ? 'New here? Create an organization' : 'Already registered? Sign in'}
      </button>
    </main>
  );
}
