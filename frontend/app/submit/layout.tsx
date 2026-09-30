import "@solana/wallet-adapter-react-ui/styles.css";
import { SolanaWalletProvider } from "@/components/solana-wallet-provider";

export default function SubmitLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <SolanaWalletProvider>{children}</SolanaWalletProvider>;
}
