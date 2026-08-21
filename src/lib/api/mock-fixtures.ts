import type { MockCommandHandler } from './mock-invoke';
import type { NostrProfile } from './nostr';

const MOCK_NPUB = 'npub1mock0000000000000000000000000000000000000000000000000000mock';
const MOCK_NSEC = 'nsec1mock0000000000000000000000000000000000000000000000000000mock';

/** Lightweight in-memory state so the create-account/login flow can complete in the browser build. */
const mockState = {
  encryptedKey: null as string | null,
  encryptedEvmKey: null as string | null,
  evmAddress: null as string | null,
  sessionUnlocked: false,
};

export const authFixtures: Record<string, MockCommandHandler> = {
  login: () => ({ public: MOCK_NPUB, private: MOCK_NSEC }),
  login_with_recovery_phrase: () => ({ public: MOCK_NPUB, private: MOCK_NSEC }),
  create_account: () => {
    mockState.sessionUnlocked = true;
    return {
      public: MOCK_NPUB,
      private: MOCK_NSEC,
      evm_private_key: '0xmockedprivatekey',
      evm_address: '0xMockedAddress',
    };
  },
  connect: () => true,
  check_any_account_exists: () => mockState.encryptedKey !== null,
  get_storage_compatibility: () => ({
    allRecognized: true,
    unrecognizedCount: 0,
    highestOffendingVersion: null,
    supportedSchemaVersion: 0,
  }),
  get_current_account: () => (mockState.encryptedKey ? MOCK_NPUB : ''),
  get_evm_address: () => mockState.evmAddress,
  set_evm_address: (args) => {
    mockState.evmAddress = String(args.address ?? '');
    return undefined;
  },
  list_all_accounts: () => (mockState.encryptedKey ? [MOCK_NPUB] : []),
  check_session: () => ({ unlocked: mockState.sessionUnlocked }),
  session_heartbeat: () => undefined,
  set_session_timeout: () => undefined,
  get_session_timeout: () => 15,
  logout: () => {
    mockState.encryptedKey = null;
    mockState.encryptedEvmKey = null;
    mockState.evmAddress = null;
    mockState.sessionUnlocked = false;
    return undefined;
  },
  sign_evm_hash: () => '0x' + '00'.repeat(64) + '1c',
  export_evm_account_key_plaintext: () => '0xmockedprivatekey',
};

export const profileFixtures: Record<string, MockCommandHandler> = {
  get_profile: (args) => {
    const npub = (args.npub as string) ?? MOCK_NPUB;
    const profile: NostrProfile = {
      id: npub,
      name: 'Mock User',
      display_name: 'Mock User',
      nickname: 'mockuser',
      about: 'Browser mock fixture profile',
      avatar: 'https://example.com/avatar.png',
      banner: 'https://example.com/banner.png',
      website: '',
      nip05: '',
      lud06: '',
      lud16: '',
      status: { title: '', purpose: '', url: '' },
      last_read: '',
      last_updated: 0,
      typing_until: 0,
      mine: false,
      bot: false,
      avatar_cached: '',
      banner_cached: '',
    };
    return profile;
  },
  load_profile: () => true,
  refresh_profile_now: () => undefined,
  sync_all_profiles: () => undefined,
  update_profile: () => undefined,
  set_nickname: () => true,
  toggle_blocked: () => false,
  queue_profile_sync: () => undefined,
  upload_avatar: () => 'https://example.com/avatar.png',
  get_image_preview_base64: () =>
    'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==',
};

export const chatFixtures: Record<string, MockCommandHandler> = {
  fetch_messages: () => undefined,
  notifs: () => true,
  get_chat_message_count: () => 0,
  delete_dm_chat: () => undefined,
  get_message_views: () => [],
  replay_mls_automation_side_effects: () => undefined,
  message: () => true,
  create_group_chat: () => ({ groupId: 'group-mock-id', skippedMembers: [], pendingInvites: [] }),
  list_mls_groups: () => [],
  get_safe: () => null,
  set_safe: () => undefined,
  list_parent_treasury_safes: () => [],
  add_parent_treasury_safe: () => undefined,
  get_mls_group_metadata: () => [],
  get_mls_store_reset_state: () => [],
  list_pending_mls_welcomes: () => [],
  accept_mls_welcome: () => true,
  invite_member_to_group: () => undefined,
  get_mls_group_members: () => ({ members: [], admins: [], pending_welcomes: [] }),
  leave_mls_group: () => undefined,
  sync_mls_groups_now: () => ({ synced: 0, total: 0 }),
  list_dashboard_polls: () => [],
  send_dashboard_poll_create: () => undefined,
  send_dashboard_poll_vote: () => undefined,
  start_typing: () => true,
  mark_as_read: () => true,
};

export const walletFixtures: Record<string, MockCommandHandler> = {
  get_dm_peer_evm_address: () => null,
  set_dm_peer_evm_address: () => undefined,
  get_evm_erc20_balance: () => ({
    ok: false,
    message: 'Wallet balances are only available in the desktop app.',
  }),
  get_evm_native_balance: () => ({
    ok: false,
    message: 'Wallet balances are only available in the desktop app.',
  }),
  get_bundler_status: () => ({ source: 'none', hasStoredKey: false }),
  set_pimlico_api_key: () => undefined,
  clear_pimlico_api_key: () => undefined,
  wallet_get_usd_spot_prices: () => ({
    ok: false,
    message: 'USD prices are only available in the desktop app.',
  }),
  wallet_build_and_send: () => ({
    ok: false,
    message: 'Sending is only available in the desktop app.',
  }),
  wallet_wait_for_transaction: () => ({
    ok: false,
    message: 'Confirmation polling is only available in the desktop app.',
  }),
  safe_deploy_proxy: () => ({
    ok: false,
    message: 'Deploy is only available in the desktop app.',
  }),
  list_evm_accounts: () => [],
  get_active_squad_evm_signer_address: () => null,
  get_active_advanced_evm_signer_address: () => null,
  set_active_evm_account: () => undefined,
  set_default_shared_evm_account: () => undefined,
  set_active_advanced_evm_account: () => undefined,
  add_evm_account_row: () => ({
    id: 'mock',
    address: '0xMock',
    purpose: 'squad',
    scheme: 'embedded',
    created_at: 0,
    is_active: false,
  }),
  import_evm_account_row: () => ({
    id: 'mock',
    address: '0xMock',
    purpose: 'squad',
    scheme: 'embedded',
    created_at: 0,
    is_active: false,
  }),
  update_evm_account_row: (args) => ({
    id: args.accountId as string,
    address: '0xMock',
    purpose: 'squad',
    scheme: 'embedded',
    created_at: 0,
    is_active: false,
  }),
  list_squad_infra_canonical_refs: () => [],
  list_squad_contract_allowlist: () => [],
  upsert_squad_contract_allowlist: () => ({
    id: 'mock',
    chain: 'sepolia',
    contract_address: '0xMock',
    label: 'Mock',
    created_at: 0,
    updated_at: 0,
  }),
  remove_squad_contract_allowlist: () => undefined,
  evm_send_squad_allowlisted_contract_call: () => ({
    ok: false,
    message: 'Allowlisted sends are only available in the desktop app.',
  }),
  list_squad_tracked_tokens: () => [],
  list_squad_sponsored_fee_usage: () => [],
  upsert_squad_tracked_token: () => ({
    id: 'mock',
    chain: 'sepolia',
    token_address: '0xMock',
    label: 'Mock',
    decimals: 18,
    created_at: 0,
    updated_at: 0,
  }),
  remove_squad_tracked_token: () => undefined,
};

export const settingFixtures: Record<string, MockCommandHandler> = {
  get_sql_setting: () => null,
  set_sql_setting: () => undefined,
  get_app_config: () => ({
    squadNameMaxLength: 50,
    channelNameMaxLength: 35,
    commonsMaxTags: 3,
    deploySafeMaxSigners: 10,
    roleLabelMaxLength: 32,
    walletAccountLabelMaxLength: 64,
    customTokenSymbolMaxLength: 16,
    pinDigitCount: 6,
    analyticsEnabled: false,
  }),
};

export const encryptionFixtures: Record<string, MockCommandHandler> = {
  get_pkey: () => mockState.encryptedKey,
  set_pkey: (args) => {
    mockState.encryptedKey = String(args.pkey ?? '');
    if (mockState.encryptedKey === '') {
      mockState.sessionUnlocked = false;
    }
    return undefined;
  },
  get_evm_pkey: () => mockState.encryptedEvmKey,
  set_evm_pkey: (args) => {
    mockState.encryptedEvmKey = String(args.evmPkey ?? '');
    return undefined;
  },
  encrypt: (args) => `encrypted(${String((args.input as string) ?? '')})`,
  decrypt: (args) => String((args.ciphertext as string) ?? '').replace(/^encrypted\((.*)\)$/, '$1'),
};

export const relayFixtures: Record<string, MockCommandHandler> = {
  get_relays: () => [],
  add_custom_relay: (args) => ({
    url: String(args.url),
    enabled: true,
    mode: String(args.mode),
  }),
  remove_custom_relay: () => true,
};

export const commonsFixtures: Record<string, MockCommandHandler> = {
  commons_publish_broadcast: () => ({
    id: 'mock',
    subject: 'user',
    subject_id: 'mock',
    content: 'Mock broadcast',
    created_at: 0,
    updated_at: 0,
    expires_at: 0,
  }),
  commons_fetch_broadcasts: () => [],
  commons_list_cached_broadcasts: () => [],
  commons_get_local_active: () => null,
  commons_cancel_broadcast: () => undefined,
};
