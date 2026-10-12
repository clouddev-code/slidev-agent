"use client";

import { useState, type FormEvent } from "react";

type Step = { kind: "signIn" } | { kind: "newPassword"; session: string; username: string };

export default function LoginPage() {
  const [step, setStep] = useState<Step>({ kind: "signIn" });
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    let payload: Record<string, string>;
    if (step.kind === "signIn") {
      payload = { email: String(form.get("email")), password: String(form.get("password")) };
    } else {
      const newPassword = String(form.get("newPassword"));
      if (newPassword !== String(form.get("confirmPassword"))) {
        setError("確認用のパスワードが一致しません");
        return;
      }
      payload = { newPassword, session: step.session, username: step.username };
    }

    setPending(true);
    setError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "ログインに失敗しました");
        return;
      }
      if (data.challenge === "NEW_PASSWORD_REQUIRED") {
        setStep({ kind: "newPassword", session: data.session, username: data.username });
        return;
      }
      window.location.assign("/");
    } catch {
      setError("ログインに失敗しました");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="login">
      <form className="login__card" onSubmit={onSubmit}>
        <h1 className="login__title">Slidev Agent</h1>
        {step.kind === "signIn" ? (
          <>
            <p className="login__lead">メールアドレスとパスワードでサインインしてください。</p>
            <label className="login__label">
              メールアドレス
              <input className="login__input" name="email" type="email" autoComplete="username" required />
            </label>
            <label className="login__label">
              パスワード
              <input className="login__input" name="password" type="password" autoComplete="current-password" required />
            </label>
          </>
        ) : (
          <>
            <p className="login__lead">初回ログインです。新しいパスワードを設定してください。</p>
            <label className="login__label">
              新しいパスワード
              <input className="login__input" name="newPassword" type="password" autoComplete="new-password" minLength={12} required />
            </label>
            <label className="login__label">
              新しいパスワード（確認）
              <input className="login__input" name="confirmPassword" type="password" autoComplete="new-password" minLength={12} required />
            </label>
          </>
        )}
        <p className="login__error" role="alert" aria-live="polite">
          {error}
        </p>
        <button className="login__button" type="submit" disabled={pending}>
          {pending ? "処理中…" : step.kind === "signIn" ? "サインイン" : "パスワードを設定"}
        </button>
      </form>
    </main>
  );
}
