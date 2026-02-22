"use client";

import { useEffect, useState } from "react";
import { RecaptchaVerifier, signInWithPhoneNumber } from "firebase/auth";
import { auth } from "../../lib/firebaseClient";

// Let TypeScript know about the globals we're going to use
declare global {
  interface Window {
    recaptchaVerifier?: RecaptchaVerifier;
    confirmationResult?: import("firebase/auth").ConfirmationResult;
  }
}

export default function PhoneTestPage() {
  const [phoneNumber, setPhoneNumber] = useState("+1");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"enterPhone" | "enterCode">("enterPhone");
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Set up the invisible reCAPTCHA once on mount, attached to the submit button
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.recaptchaVerifier) return; // already set up

    try {
      window.recaptchaVerifier = new RecaptchaVerifier(
        auth,
        "send-code-button", // this must match the button id below
        {
          size: "invisible",
          callback: () => {
            // reCAPTCHA solved, allow signInWithPhoneNumber.
            // We'll actually trigger signInWithPhoneNumber from the click handler.
          },
          "expired-callback": () => {
            // reCAPTCHA expired, user will need to try again.
            console.log("reCAPTCHA expired");
          },
        }
      );
    } catch (err) {
      console.error("Error creating RecaptchaVerifier", err);
    }
  }, []);

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus(null);
    setLoading(true);

    try {
      if (!window.recaptchaVerifier) {
        throw new Error("reCAPTCHA not initialized");
      }

      const appVerifier = window.recaptchaVerifier;
      const result = await signInWithPhoneNumber(auth, phoneNumber, appVerifier);
      window.confirmationResult = result;

      setStep("enterCode");
      setStatus("SMS sent! Check your phone for the code.");
    } catch (error: any) {
      console.error("Error sending SMS:", error);
      setStatus(`Error sending SMS: ${error.message || String(error)}`);

      // optional: reset the reCAPTCHA as in the docs
      try {
        window.recaptchaVerifier?.render().then((widgetId) => {
          // @ts-ignore
          if (window.grecaptcha) {
            // @ts-ignore
            window.grecaptcha.reset(widgetId);
          }
        });
      } catch {
        // ignore
      }
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus(null);
    setLoading(true);

    try {
      const confirmationResult = window.confirmationResult;
      if (!confirmationResult) {
        throw new Error("No confirmation result. Send code first.");
      }

      const result = await confirmationResult.confirm(code);
      const user = result.user;
      setStatus(`Success! Signed in as UID: ${user.uid}`);
    } catch (error: any) {
      console.error("Error verifying code:", error);
      setStatus(`Error verifying code: ${error.message || String(error)}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100">
      <div className="w-full max-w-md bg-white shadow-md rounded-xl p-6 space-y-4">
        <h1 className="text-xl font-semibold text-slate-900">
          Phone Auth Test
        </h1>
        <p className="text-sm text-slate-600">
          This follows the Firebase web phone-auth docs: enter a phone number,
          get an SMS, then confirm with the code.
        </p>

        {step === "enterPhone" && (
          <form onSubmit={handleSendCode} className="space-y-3">
            <label className="block text-sm font-medium text-slate-700">
              Phone number (E.164, e.g. +15555550123)
            </label>
            <input
              type="tel"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              required
            />

            {/* Button ID must match what we passed to RecaptchaVerifier */}
            <button
              id="send-code-button"
              type="submit"
              disabled={loading}
              className="w-full rounded-md bg-slate-900 text-white py-2 text-sm font-medium disabled:opacity-60"
            >
              {loading ? "Sending SMS..." : "Send verification code"}
            </button>
          </form>
        )}

        {step === "enterCode" && (
          <form onSubmit={handleVerifyCode} className="space-y-3">
            <label className="block text-sm font-medium text-slate-700">
              Verification code (SMS)
            </label>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              required
            />
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-md bg-emerald-600 text-white py-2 text-sm font-medium disabled:opacity-60"
            >
              {loading ? "Verifying..." : "Verify code"}
            </button>

            <button
              type="button"
              onClick={() => {
                setStep("enterPhone");
                setCode("");
              }}
              className="w-full rounded-md border border-slate-300 text-slate-700 py-2 text-sm font-medium"
            >
              Start over
            </button>
          </form>
        )}

        {status && (
          <div className="text-xs text-slate-700 bg-slate-100 rounded-md p-2 whitespace-pre-line">
            {status}
          </div>
        )}
      </div>
    </div>
  );
}

