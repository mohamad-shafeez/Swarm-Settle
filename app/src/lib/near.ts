/**
 * NEAR Testnet RPC, Wallet Selector & Transaction Signing Module (app/src/lib/near.ts)
 *
 * Implements real NEAR Testnet JSON-RPC view calls, Wallet Selector / MyNearWallet
 * session persistence, URL callback parsing (`account_id`, `transactionHashes`),
 * and wallet-signed function-call execution for all SwarmSettle contract methods.
 */

export interface NearConfig {
  networkId: 'testnet' | 'local-simulator';
  nodeUrl: string;
  contractId: string;
  walletUrl: string;
  explorerUrl: string;
}

export function getNearConfig(): NearConfig {
  const env = (import.meta as unknown as { env?: Record<string, string> }).env || {};
  const contractId = env.VITE_NEAR_CONTRACT_ID || 'swarmsettle.testnet';
  const networkId = (env.VITE_NEAR_NETWORK || 'testnet') as 'testnet' | 'local-simulator';
  return {
    networkId,
    nodeUrl: env.VITE_NEAR_RPC_URL || 'https://rpc.testnet.near.org',
    contractId,
    walletUrl: env.VITE_NEAR_WALLET_URL || 'https://testnet.mynearwallet.com',
    explorerUrl: env.VITE_NEAR_EXPLORER_URL || 'https://testnet.nearblocks.io',
  };
}

export async function callNearViewMethod<T>(
  methodName: string,
  args: Record<string, unknown> = {}
): Promise<T> {
  const config = getNearConfig();
  const argsBase64 = btoa(unescape(encodeURIComponent(JSON.stringify(args))));
  const response = await fetch(config.nodeUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: `swarm-settle-${Date.now()}`,
      method: 'query',
      params: {
        request_type: 'call_function',
        finality: 'optimistic',
        account_id: config.contractId,
        method_name: methodName,
        args_base64: argsBase64,
      },
    }),
  });
  const payload = await response.json();
  if (payload.error) {
    throw new Error(payload.error.data || payload.error.message || 'NEAR RPC query failed');
  }
  const bytes = new Uint8Array(payload.result.result);
  const text = new TextDecoder().decode(bytes);
  return JSON.parse(text) as T;
}

export interface ContractCallAction {
  contractId: string;
  methodName: string;
  args: Record<string, unknown>;
  gas: string;
  deposit: string;
}

export interface SignedTransactionResult {
  txHash: string;
  signerId: string;
  methodName: string;
  explorerUrl: string;
}

const WALLET_STORAGE_KEY = 'swarmsettle_connected_wallet_v1';

/**
 * Inspects URL callback parameters returned by MyNearWallet (`account_id`,
 * `transactionHashes`, `errorCode`) and persisted Wallet Selector state.
 */
export function resolveWalletCallbackState(): {
  accountId: string | null;
  lastTxHash: string | null;
  errorMessage: string | null;
} {
  if (typeof window === 'undefined') {
    return { accountId: null, lastTxHash: null, errorMessage: null };
  }
  const params = new URLSearchParams(window.location.search);
  const urlAccount = params.get('account_id');
  const txHashes = params.get('transactionHashes');
  const errorCode = params.get('errorCode');
  const errorMsg = params.get('errorMessage');

  if (urlAccount) {
    window.localStorage.setItem(WALLET_STORAGE_KEY, urlAccount);
  }
  const storedAccount = window.localStorage.getItem(WALLET_STORAGE_KEY);
  const firstTxHash = txHashes ? txHashes.split(',')[0].trim() : null;

  if (urlAccount || txHashes || errorCode) {
    const cleanUrl = `${window.location.origin}${window.location.pathname}${window.location.hash}`;
    window.history.replaceState({}, document.title, cleanUrl);
  }

  return {
    accountId: urlAccount || storedAccount || null,
    lastTxHash: firstTxHash,
    errorMessage: errorCode ? decodeURIComponent(errorMsg || errorCode) : null,
  };
}

export async function connectNearWallet(): Promise<string | null> {
  const config = getNearConfig();
  // Support injected / Playwright-bridged NEAR wallet provider or Wallet Selector when present
  const win = window as unknown as {
    nearWalletBridge?: { connect: () => Promise<string>; getAccountId: () => Promise<string | null> };
  };
  if (win.nearWalletBridge) {
    const acct = await win.nearWalletBridge.connect();
    if (acct) {
      window.localStorage.setItem(WALLET_STORAGE_KEY, acct);
      return acct;
    }
  }
  try {
    const [{ setupWalletSelector }, { setupMyNearWallet }] = await Promise.all([
      import('@near-wallet-selector/core'),
      import('@near-wallet-selector/my-near-wallet'),
    ]);
    const selector = await setupWalletSelector({
      network: 'testnet',
      modules: [setupMyNearWallet({ walletUrl: config.walletUrl })],
    });
    const state = selector.store.getState();
    if (state.accounts.length > 0) {
      const acct = state.accounts[0].accountId;
      window.localStorage.setItem(WALLET_STORAGE_KEY, acct);
      return acct;
    }
    const wallet = await selector.wallet('my-near-wallet');
    await wallet.signIn({
      contractId: config.contractId,
      accounts: [],
    });
    return null;
  } catch {
    const callbackUrl = window.location.href;
    const loginUrl = `${config.walletUrl}/login/?contract_id=${encodeURIComponent(
      config.contractId
    )}&success_url=${encodeURIComponent(callbackUrl)}&failure_url=${encodeURIComponent(callbackUrl)}`;
    window.location.assign(loginUrl);
    return null;
  }
}

export function disconnectNearWallet(): void {
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(WALLET_STORAGE_KEY);
  }
}

export function buildFunctionCallTransaction(
  methodName: string,
  args: Record<string, unknown>,
  depositYocto = '0',
  gas = '50000000000000'
): ContractCallAction {
  const { contractId } = getNearConfig();
  return {
    contractId,
    methodName,
    args,
    gas,
    deposit: depositYocto,
  };
}

/**
 * Signs and submits a contract call via the active NEAR Wallet Selector session
 * or injected Testnet signer bridge, returning the confirmed transaction hash.
 */
export async function signAndSendContractCall(
  methodName: string,
  args: Record<string, unknown>,
  depositYocto = '0',
  gas = '50000000000000'
): Promise<SignedTransactionResult> {
  const config = getNearConfig();
  const tx = buildFunctionCallTransaction(methodName, args, depositYocto, gas);

  const win = window as unknown as {
    nearWalletBridge?: {
      signAndSendTransaction: (action: ContractCallAction) => Promise<{ txHash: string; signerId: string }>;
    };
  };
  if (win.nearWalletBridge) {
    const res = await win.nearWalletBridge.signAndSendTransaction(tx);
    return {
      txHash: res.txHash,
      signerId: res.signerId,
      methodName,
      explorerUrl: getTxExplorerUrl(res.txHash),
    };
  }

  const [{ setupWalletSelector }, { setupMyNearWallet }] = await Promise.all([
    import('@near-wallet-selector/core'),
    import('@near-wallet-selector/my-near-wallet'),
  ]);
  const selector = await setupWalletSelector({
    network: 'testnet',
    modules: [setupMyNearWallet({ walletUrl: config.walletUrl })],
  });
  const wallet = await selector.wallet('my-near-wallet');
  const accounts = await wallet.getAccounts();
  if (!accounts || accounts.length === 0) {
    throw new Error('Wallet is not connected. Connect a NEAR Testnet wallet before signing transactions.');
  }
  const outcome = await wallet.signAndSendTransaction({
    signerId: accounts[0].accountId,
    receiverId: tx.contractId,
    actions: [
      {
        type: 'FunctionCall',
        params: {
          methodName: tx.methodName,
          args: tx.args,
          gas: tx.gas,
          deposit: tx.deposit,
        },
      },
    ],
  });
  const txHash =
    (outcome as { transaction?: { hash?: string }; transaction_outcome?: { id?: string } })?.transaction?.hash ||
    (outcome as { transaction_outcome?: { id?: string } })?.transaction_outcome?.id ||
    '';
  if (!txHash) {
    throw new Error('Transaction was submitted or redirected to MyNearWallet; awaiting callback receipt.');
  }
  return {
    txHash,
    signerId: accounts[0].accountId,
    methodName,
    explorerUrl: getTxExplorerUrl(txHash),
  };
}

export function getTxExplorerUrl(txHash: string): string {
  if (!txHash || txHash.startsWith('local-')) {
    return '';
  }
  const { explorerUrl } = getNearConfig();
  return `${explorerUrl}/txns/${encodeURIComponent(txHash)}`;
}

export function getAccountExplorerUrl(accountId: string): string {
  if (!accountId) return '';
  const { explorerUrl } = getNearConfig();
  return `${explorerUrl}/address/${encodeURIComponent(accountId)}`;
}
