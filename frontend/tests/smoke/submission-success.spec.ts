import { expect, test, type Page, type Route } from "@playwright/test";

const proof = (overrides: Record<string, unknown> = {}) => ({
  id: "receipt-1",
  hackathonId: "event",
  projectName: "Credential Project",
  status: "pending_nft",
  mintStatus: "PENDING",
  walletAddress: "recipient-wallet-9",
  transactionSignature: null,
  nftAssetId: null,
  solanaTransaction: null,
  explorerUrl: null,
  ...overrides,
});

async function authenticated(
  page: Page,
  getProof: (route: Route) => Promise<void>,
) {
  await page.addInitScript(() =>
    sessionStorage.setItem("azync.access_token", "proof-token"),
  );
  await page.route("http://localhost:3001/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/auth/me")
      return route.fulfill({
        json: { id: "proof-user", name: "Proof User", githubUsername: "proof" },
      });
    if (path === "/submissions/receipt-1") return getProof(route);
    return route.fulfill({ json: {} });
  });
}

test("pending proof polls to confirmed and keeps transaction, asset, cluster and recipient distinct", async ({
  page,
}) => {
  let reads = 0;
  await authenticated(page, async (route) => {
    reads += 1;
    await route.fulfill({
      json:
        reads === 1
          ? proof({ transactionSignature: "pending-signature" })
          : proof({
              status: "confirmed",
              mintStatus: "CONFIRMED",
              transactionSignature: "confirmed-signature",
              nftAssetId: "asset-id-42",
              walletAddress: "recipient-wallet-9",
              solanaTransaction: { network: "devnet" },
              explorerUrl:
                "https://explorer.solana.com/tx/confirmed-signature?cluster=devnet",
            }),
    });
  });
  await page.goto("/submit/success?id=receipt-1");
  const ledger = page.locator(".proof-ledger");
  await expect(ledger).toContainText("pending-signature");
  await expect(ledger).not.toContainText("asset-id-42");
  await expect(ledger).toContainText("confirmed-signature", {
    timeout: 10_000,
  });
  await expect(ledger).toContainText("asset-id-42");
  await expect(ledger).toContainText("recipient-wallet-9");
  await expect(ledger).toContainText("devnet");
  await expect(ledger.getByRole("link", { name: /Explorer/ })).toHaveAttribute(
    "href",
    "https://explorer.solana.com/tx/confirmed-signature?cluster=devnet",
  );
  expect(reads).toBeGreaterThanOrEqual(2);
});

test("failed mint remains a recorded submission and manual refresh shows a later retry result", async ({
  page,
}) => {
  let next = proof({
    status: "nft_failed",
    mintStatus: "FAILED",
    transactionSignature: "failed-signature",
  });
  let reads = 0;
  await authenticated(page, async (route) => {
    reads += 1;
    await route.fulfill({ json: next });
  });
  await page.goto("/submit/success?id=receipt-1");
  await expect(page.locator(".proof-ledger")).toContainText("FAILED");
  await expect(page.locator(".proof-heading")).toContainText(
    "The mint has not succeeded",
  );
  next = proof({
    status: "pending_nft",
    mintStatus: "PENDING",
    transactionSignature: "retry-signature",
  });
  await page.getByRole("button", { name: "Reload proof" }).click();
  await expect(page.locator(".proof-ledger")).toContainText("retry-signature");
  await expect(page.locator(".proof-ledger")).not.toContainText("FAILED");
  expect(reads).toBeGreaterThanOrEqual(2);
});

test("proof fetch error can be retried without inventing a confirmed credential", async ({
  page,
}) => {
  let fail = true;
  await authenticated(page, async (route) =>
    fail
      ? route.fulfill({
          status: 503,
          json: { message: "Proof temporarily unavailable" },
        })
      : route.fulfill({ json: proof() }),
  );
  await page.goto("/submit/success?id=receipt-1");
  await expect(page.getByText("Proof temporarily unavailable")).toBeVisible();
  fail = false;
  await page.getByRole("button", { name: "Reload", exact: true }).click();
  await expect(page.locator(".proof-ledger")).toContainText("PENDING");
  await expect(page.locator(".proof-ledger")).not.toContainText("CONFIRMED");
});

test("late proof response from account A cannot appear after switching to B", async ({
  page,
}) => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.addInitScript(() =>
    sessionStorage.setItem("azync.access_token", "token-a"),
  );
  await page.route("http://localhost:3001/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const token = route.request().headers().authorization;
    if (path === "/auth/me")
      return route.fulfill({
        json: {
          id: token === "Bearer token-b" ? "user-b" : "user-a",
          name: token === "Bearer token-b" ? "Beta" : "Alpha",
        },
      });
    if (path === "/auth/logout")
      return route.fulfill({ json: { message: "Logged out" } });
    if (path === "/submissions/receipt-1") {
      if (token === "Bearer token-a") {
        await pending;
        return route.fulfill({
          json: proof({ projectName: "ALPHA SECRET PROJECT" }),
        });
      }
      return route.fulfill({
        json: proof({ projectName: "BETA PUBLIC PROJECT" }),
      });
    }
    return route.fulfill({ json: {} });
  });
  await page.goto("/submit/success?id=receipt-1");
  await expect(page.getByText("Verifying submission proof…")).toBeVisible();
  await page.getByRole("button", { name: "Account Alpha" }).click();
  await page.getByRole("button", { name: /Sign out on this device/ }).click();
  const tokenInput = page.locator("#access-token");
  if (!(await tokenInput.isVisible()))
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await tokenInput.fill("token-b");
  await page.getByRole("button", { name: /Use this session/ }).click();
  await expect(
    page.getByRole("heading", { name: "BETA PUBLIC PROJECT" }),
  ).toBeVisible();
  release();
  await expect(
    page.getByRole("heading", { name: "ALPHA SECRET PROJECT" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "BETA PUBLIC PROJECT" }),
  ).toBeVisible();
});
