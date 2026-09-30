"use client";

import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useWallet } from "@solana/wallet-adapter-react";
import { useEffect, useState } from "react";
import { useWalletNotice } from "./solana-wallet-provider";
import { useAuth } from "./auth-provider";

export function WalletButton() {
  const auth = useAuth();
  const { publicKey } = useWallet();
  const { notice, dismissNotice } = useWalletNotice();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (publicKey) dismissNotice();
  }, [dismissNotice, publicKey]);

  if (!mounted || auth.loading || !auth.user) {
    return (
      <div className="wallet-control">
        <button
          type="button"
          className="wallet-adapter-button wallet-adapter-button-trigger"
          disabled
        >
          {auth.loading ? "Verifying GitHub…" : "Sign in with GitHub first"}
        </button>
      </div>
    );
  }

  return (
    <div className="wallet-control">
      <WalletMultiButton />
      {publicKey && (
        <span className="mono muted" aria-live="polite">
          {publicKey.toBase58().slice(0, 5)}…{publicKey.toBase58().slice(-5)}
        </span>
      )}
      {!publicKey && notice && (
        <span className="wallet-notice" role="status">
          {notice}
        </span>
      )}
    </div>
  );
}
