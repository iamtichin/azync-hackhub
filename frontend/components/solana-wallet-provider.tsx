"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  WalletAdapterNetwork,
  WalletConnectionError,
  WalletNotReadyError,
  WalletWindowBlockedError,
  WalletWindowClosedError,
  type Adapter,
  type WalletError,
} from "@solana/wallet-adapter-base";
import {
  ConnectionProvider,
  useWallet,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import { clusterApiUrl } from "@solana/web3.js";
import { useAuth } from "./auth-provider";

type WalletNoticeContextValue = {
  notice: string | null;
  dismissNotice: () => void;
};

const WalletNoticeContext = createContext<WalletNoticeContextValue>({
  notice: null,
  dismissNotice: () => undefined,
});

export function useWalletNotice() {
  return useContext(WalletNoticeContext);
}

function AuthBoundWalletSession({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
  const { connected, connecting, disconnect, select, wallet } = useWallet();
  const { dismissNotice } = useWalletNotice();

  // A wallet session is subordinate to the verified GitHub session. Clearing
  // both the connection and selected adapter prevents a previous browser
  // session from appearing connected on the unauthenticated submit page.
  useEffect(() => {
    if (auth.loading || auth.user) return;
    if (!wallet && !connected && !connecting) return;

    void disconnect()
      .catch(() => undefined)
      .finally(() => {
        select(null);
        dismissNotice();
      });
  }, [
    auth.loading,
    auth.user,
    connected,
    connecting,
    disconnect,
    dismissNotice,
    select,
    wallet,
  ]);

  return children;
}

export function SolanaWalletProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const auth = useAuth();
  const network = WalletAdapterNetwork.Devnet;
  const endpoint = useMemo(
    () => process.env.NEXT_PUBLIC_SOLANA_RPC_URL || clusterApiUrl(network),
    [],
  );
  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter({ network })],
    [auth.sessionVersion],
  );
  const [notice, setNotice] = useState<string | null>(null);
  const dismissNotice = useCallback(() => setNotice(null), []);
  const noticeValue = useMemo(
    () => ({ notice, dismissNotice }),
    [dismissNotice, notice],
  );
  const handleWalletError = useCallback(
    (error: WalletError, adapter?: Adapter) => {
      if (error instanceof WalletNotReadyError) {
        setNotice(
          `${adapter?.name || "Wallet"} is not available in this browser.`,
        );
        if (adapter) {
          window.open(adapter.url, "_blank", "noopener,noreferrer");
        }
        return;
      }

      if (error instanceof WalletConnectionError) {
        if (adapter?.connected) return;

        const rejected = `${error.message} ${String(error.error || "")}`
          .toLowerCase()
          .match(/reject|denied|cancel/);
        setNotice(
          rejected
            ? "The wallet connection request was not confirmed. You can try connecting again."
            : "The wallet could not connect. Unlock it and try again.",
        );
        return;
      }

      if (
        error instanceof WalletWindowClosedError ||
        error instanceof WalletWindowBlockedError
      ) {
        setNotice(
          "The wallet window was closed or blocked by the browser. Try again.",
        );
        return;
      }

      console.warn(`[wallet:${adapter?.name || "unknown"}] ${error.name}`);
      setNotice(
        "The wallet encountered a problem while processing the request. Check it and try again.",
      );
    },
    [],
  );

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletNoticeContext.Provider value={noticeValue}>
        <WalletProvider
          key={auth.sessionVersion}
          wallets={wallets}
          autoConnect={false}
          onError={handleWalletError}
        >
          <WalletModalProvider>
            <AuthBoundWalletSession>{children}</AuthBoundWalletSession>
          </WalletModalProvider>
        </WalletProvider>
      </WalletNoticeContext.Provider>
    </ConnectionProvider>
  );
}
