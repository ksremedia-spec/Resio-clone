import type { ReactNode } from 'react';
export function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="auth">
      <div className="card auth-card">
        <div className="logo"><img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" />Buildline</div>
        <h1 style={{ marginBottom: 4 }}>{title}</h1>
        {subtitle && <p className="muted" style={{ marginBottom: 20 }}>{subtitle}</p>}
        {children}
      </div>
    </div>
  );
}
