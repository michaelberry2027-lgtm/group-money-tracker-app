"use client";

import React, { useState } from "react";
import { useAuth } from "../lib/AuthContext";
import MoneyTrackerApp from "./MoneyTrackerApp";

const Page: React.FC = () => {
  const { user, loading, signIn, signOutUser } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await signIn(email, password);
    } catch (err: any) {
      setError(err.message ?? "Login failed");
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100">
        <div className="text-sm text-slate-600">Loading…</div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100">
        <form
          onSubmit={handleLogin}
          className="bg-white p-6 rounded-xl shadow-md space-y-3 w-full max-w-sm"
        >
          <h1 className="text-xl font-semibold text-center">
            Money Tracker Login
          </h1>
          {error && (
            <p className="text-xs text-red-600 text-center">{error}</p>
          )}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-600">Email</label>
            <input
              className="border rounded-md px-3 py-2 text-sm"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-600">Password</label>
            <input
              className="border rounded-md px-3 py-2 text-sm"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
            />
          </div>
          <button
            type="submit"
            className="w-full rounded-md bg-indigo-600 text-white py-2 text-sm font-medium hover:bg-indigo-700"
          >
            Log in
          </button>
          <p className="text-[11px] text-slate-500 text-center">
            Make sure you created this email/password as a user in Firebase
            Authentication.
          </p>
        </form>
      </div>
    );
  }

  return (
    <>
      <div className="w-full flex justify-between items-center px-4 py-2 bg-slate-900 text-slate-100 text-xs">
        <span>
          Logged in as <strong>{user.email}</strong>
        </span>
        <button
          onClick={signOutUser}
          className="border border-slate-500 rounded px-2 py-1 text-[11px] hover:bg-slate-700"
        >
          Log out
        </button>
      </div>
      <MoneyTrackerApp userId={user.uid} />
    </>
  );
};

export default Page;

