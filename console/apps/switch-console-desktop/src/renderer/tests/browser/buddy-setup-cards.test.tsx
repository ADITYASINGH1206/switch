/**
 * Acceptance cases for switch-buddy's setup cards in its Welcome chat: each
 * case renders the cards against a mocked server, asserts what the person
 * sees, and saves a screenshot of it under the app's gitignored
 * `build/acceptance/buddy-onboarding/`.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import type { LinkedIdentity, RemoteBridge } from '@shared/core/switch-servers/switch-servers';
import { RpcError } from '@shared/lib/ipc/rpc-error';

const listBridges = vi.hoisted(() => vi.fn());
const listMyIdentities = vi.hoisted(() => vi.fn());
const getRoomDetail = vi.hoisted(() => vi.fn());
const createChat = vi.hoisted(() => vi.fn());
const openRoomChannel = vi.hoisted(() => vi.fn());
const shown = vi.hoisted(() => [] as { id: string; args: { onClosed?: () => void } }[]);
const timeline = vi.hoisted(() => ({
  messages: [] as { sender: { kind: string }; body: string }[],
  pending: [] as { body: string }[],
  send: () => {},
}));

vi.hoisted(() => {
  window.electronAPI ??= {
    invoke: () => Promise.resolve(undefined),
    eventOn: () => () => {},
    eventSend: () => {},
  } as unknown as typeof window.electronAPI;
});

vi.mock('@renderer/lib/ipc', () => ({
  rpc: {
    workspaces: { listBridges, listMyIdentities, getRoomDetail },
    chats: { create: createChat },
    switchRooms: { openRoomChannel },
  },
  events: { on: () => () => {}, emit: () => {} },
}));
vi.mock('@renderer/lib/modal/modal-provider', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useShowModal: (id: string) => (args: { onClosed?: () => void }) => shown.push({ id, args }),
}));
vi.mock('@renderer/features/chats/stores/chats', () => ({
  chatsStore: {
    chat: (roomId: string) => ({ roomId, name: 'Welcome', bridgeType: null }),
    timelines: { get: () => timeline },
    add: () => {},
  },
  chatTitler: { created: () => {} },
}));
vi.mock('@renderer/features/chats/components/chat-composer', () => ({
  focusComposerWhenOpened: () => {},
}));
vi.mock('@renderer/features/switch-servers/switch-servers-store', () => ({
  switchServersStore: { statusFor: () => ({ user: { name: 'Ada Lovelace', email: null } }) },
}));

import { BuddySetupCards } from '@renderer/features/switch-buddy/buddy-setup-cards';
import '@renderer/index.css';

/** Relative to this file; it must stay inside the workspace for Vite to write it. */
const SHOTS = '../../../../build/acceptance/buddy-onboarding';

function bridge(id: string, type: string, displayName: string): RemoteBridge {
  return {
    id,
    type,
    displayName,
    status: 'active',
    isDefault: false,
    homeUrl: null,
  } as RemoteBridge;
}

const acme = bridge('b-1', 'slack', 'Acme Slack');
const globex = bridge('b-2', 'slack', 'Globex Slack');
const teams = bridge('b-3', 'teams', 'Acme Teams');
const telegram = bridge('b-4', 'telegram', 'example_bot');
const linked = (bridgeId: string) => ({ bridgeId }) as LinkedIdentity;

const noSuchOperation = () =>
  new RpcError({
    __switchConsoleRpcError: true,
    code: 'ChatApiError',
    message: 'No such operation',
    data: { apiCode: 'NO_SUCH_OPERATION' },
  });

function slackChat(bridgeId: string) {
  return {
    roomId: `room-${bridgeId}`,
    name: null,
    channelType: 'direct',
    bridgeType: 'slack',
    agents: [{ id: 'agent-1' }],
  };
}

/** Bridges whose hand-off the server has made; a resume finds only those. */
let made: Set<string>;

type CreateParams = { bridgeId?: string; requestId: string; resumeOnly?: boolean };
const handoffCalls = () =>
  createChat.mock.calls.map(([params]) => params as CreateParams).filter((p) => !p.resumeOnly);

let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(async () => {
  made = new Set();
  listBridges.mockReset().mockResolvedValue([]);
  listMyIdentities.mockReset().mockResolvedValue([]);
  getRoomDetail.mockReset().mockResolvedValue({
    linkedChannelName: '#buddy-ada',
    externalChannelUrl: 'https://slack.example/archives/C123',
  });
  createChat.mockReset().mockImplementation(async (params: CreateParams) => {
    if (params.resumeOnly) {
      if (made.has(params.bridgeId!)) return slackChat(params.bridgeId!);
      throw noSuchOperation();
    }
    made.add(params.bridgeId!);
    return slackChat(params.bridgeId!);
  });
  openRoomChannel.mockReset().mockResolvedValue(undefined);
  shown.length = 0;
  timeline.messages = [];
  timeline.pending = [];
  await page.viewport(760, 900);
});

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  container?.remove();
  container = null;
  root = null;
});

async function render(): Promise<HTMLElement> {
  container = document.createElement('div');
  container.style.width = '720px';
  container.style.padding = '16px';
  document.body.appendChild(container);
  root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await act(async () =>
    root!.render(
      <QueryClientProvider client={client}>
        <BuddySetupCards
          serverId="srv-1"
          workspaceId="ws-1"
          agentId="agent-1"
          agentName="switch-buddy"
          roomId="room-welcome"
        />
      </QueryClientProvider>
    )
  );
  await settle();
  return container;
}

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await act(async () => await Promise.resolve());
}

async function shot(el: HTMLElement, name: string): Promise<void> {
  // Screenshots catch the settled look, not a button mid-transition.
  for (const node of el.querySelectorAll<HTMLElement>('*')) node.style.transition = 'none';
  await page.screenshot({ path: `${SHOTS}/${name}.png`, element: el });
}

function findButton(el: HTMLElement, label: string): HTMLButtonElement | undefined {
  return [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
    b.textContent?.includes(label)
  );
}

function button(el: HTMLElement, label: string): HTMLButtonElement {
  const found = findButton(el, label);
  expect(found, `no ${label} button`).toBeDefined();
  return found!;
}

async function click(el: HTMLElement, label: string): Promise<void> {
  await act(async () => button(el, label).click());
  await settle();
}

describe('switch-buddy setup cards', () => {
  it('(a) fresh install: asks where the team chats, then offers to connect the app picked', async () => {
    const el = await render();
    expect(el.textContent).toContain('Where does your team chat?');
    expect(findButton(el, 'Connect Slack')).toBeUndefined();
    await shot(el, 'a-fresh-install-choose');

    await click(el, 'Channels & DMs');

    expect(el.textContent).toContain('Add Slack to your Switch workspace.');
    expect(findButton(el, 'Connect Slack')).toBeDefined();
    await shot(el, 'a-fresh-install-connect');
  });

  it('(b) already connected and linked: offers the private channel', async () => {
    listBridges.mockResolvedValue([acme]);
    listMyIdentities.mockResolvedValue([linked('b-1')]);
    const el = await render();

    expect(el.textContent).toContain('Slack connected · account linked');
    expect(el.textContent).toContain('Continue in a private Slack channel');
    expect(findButton(el, 'Create channel and continue')).toBeDefined();
    expect(el.textContent).not.toContain('Which workspace?');
    await shot(el, 'b-connected-linked-create');
  });

  it('(b) a hand-off already made: done, with a link to the channel', async () => {
    listBridges.mockResolvedValue([acme]);
    listMyIdentities.mockResolvedValue([linked('b-1')]);
    made.add('b-1');
    const el = await render();

    expect(el.textContent).toContain('#buddy-ada ready');
    await click(el, 'Open Slack');
    expect(openRoomChannel).toHaveBeenCalledWith({
      serverId: 'srv-1',
      channelUrl: 'https://slack.example/archives/C123',
    });
    expect(handoffCalls()).toHaveLength(0);
    await shot(el, 'b-done-with-channel-link');
  });

  it('(c) linking skipped: the link card, with staying in Console still offered', async () => {
    listBridges.mockResolvedValue([acme]);
    const el = await render();

    expect(el.textContent).toContain('Slack connected');
    expect(el.textContent).toContain('Link your Slack account');
    expect(findButton(el, 'Link account')).toBeDefined();
    expect(findButton(el, 'Continue here in Switch Console')).toBeDefined();
    await shot(el, 'c-linking-skipped');
  });

  it('(d) non-admin: the card offers Connect; the connect dialog explains admin rights', async () => {
    // Who may connect an app is decided inside ConnectMessagingAppModal, so
    // the card itself shows the same connect card and, once it closes, the note.
    const el = await render();
    await click(el, 'Channels & DMs');
    await click(el, 'Connect Slack');
    expect(shown[0].id).toBe('connectMessagingAppModal');

    await act(async () => shown[0].args.onClosed!());
    await settle();

    expect(el.textContent).toContain('Slack isn’t connected yet. Try again when you’re ready.');
    expect(findButton(el, 'Connect Slack')).toBeDefined();
    await shot(el, 'd-non-admin-connect');
  });

  it('(e) channel creation disabled: says why, and offers Try again', async () => {
    listBridges.mockResolvedValue([acme]);
    listMyIdentities.mockResolvedValue([linked('b-1')]);
    createChat.mockImplementation(async (params: CreateParams) => {
      if (params.resumeOnly) throw noSuchOperation();
      throw new Error('Channel creation is disabled for this workspace.');
    });
    const el = await render();

    await click(el, 'Create channel and continue');

    expect(el.textContent).toContain('Channel creation is disabled for this workspace.');
    expect(findButton(el, 'Try again')).toBeDefined();
    await shot(el, 'e-channel-creation-disabled');
  });

  it('(f) install cancelled: the connect card says it is not connected yet', async () => {
    const el = await render();
    await click(el, 'Channels & DMs');
    expect(el.textContent).not.toContain('isn’t connected yet');

    await click(el, 'Connect Slack');
    await act(async () => shown[0].args.onClosed!());
    await settle();

    expect(el.textContent).toContain('Slack isn’t connected yet. Try again when you’re ready.');
    expect(findButton(el, 'Connect Slack')).toBeDefined();
    await shot(el, 'f-install-cancelled');
  });

  it('(f) a connection made in the dialog moves on, with no note', async () => {
    const el = await render();
    await click(el, 'Channels & DMs');
    await click(el, 'Connect Slack');
    listBridges.mockResolvedValue([acme]);

    await act(async () => shown[0].args.onClosed!());
    await settle();

    expect(el.textContent).not.toContain('isn’t connected yet');
    expect(el.textContent).toContain('Link your Slack account');
  });

  it('(g) double Continue: one hand-off, the button busy meanwhile', async () => {
    listBridges.mockResolvedValue([acme]);
    listMyIdentities.mockResolvedValue([linked('b-1')]);
    let finish!: () => void;
    createChat.mockImplementation((params: CreateParams) => {
      if (params.resumeOnly) {
        return made.has(params.bridgeId!)
          ? Promise.resolve(slackChat(params.bridgeId!))
          : Promise.reject(noSuchOperation());
      }
      return new Promise((resolve) => {
        finish = () => {
          made.add(params.bridgeId!);
          resolve(slackChat(params.bridgeId!));
        };
      });
    });
    const el = await render();

    const continueButton = button(el, 'Create channel and continue');
    await act(async () => {
      continueButton.click();
      continueButton.click();
    });
    await settle();
    await act(async () => button(el, 'Creating channel…').click());
    await settle();

    expect(handoffCalls()).toHaveLength(1);
    expect(button(el, 'Creating channel…').disabled).toBe(true);
    await shot(el, 'g-double-continue');

    await act(async () => finish());
    await settle();
    expect(el.textContent).toContain('#buddy-ada ready');
    expect(handoffCalls()).toHaveLength(1);
  });

  it('(h) several linked workspaces: asks which, and hands off on the one chosen', async () => {
    listBridges.mockResolvedValue([acme, globex]);
    listMyIdentities.mockResolvedValue([linked('b-1'), linked('b-2')]);
    const el = await render();

    expect(el.textContent).toContain('Which workspace?');
    expect(button(el, 'Acme Slack').getAttribute('aria-pressed')).toBe('true');
    await click(el, 'Globex Slack');
    expect(button(el, 'Globex Slack').getAttribute('aria-pressed')).toBe('true');
    expect(button(el, 'Acme Slack').getAttribute('aria-pressed')).toBe('false');
    await shot(el, 'h-multiple-workspaces');

    await click(el, 'Create channel and continue');

    expect(handoffCalls()).toEqual([
      expect.objectContaining({ bridgeId: 'b-2', requestId: 'buddy-handoff:agent-1:b-2' }),
    ]);
    expect(el.textContent).toContain('#buddy-ada ready');
    expect(getRoomDetail).toHaveBeenCalledWith({ workspaceId: 'ws-1', roomId: 'room-b-2' });
  });

  it('(i) invite or post failure: Try again, then done', async () => {
    listBridges.mockResolvedValue([acme]);
    listMyIdentities.mockResolvedValue([linked('b-1')]);
    createChat.mockImplementationOnce(async () => {
      throw noSuchOperation();
    });
    createChat.mockImplementationOnce(async () => {
      throw new Error('Could not invite switch-buddy to the channel.');
    });
    const el = await render();

    await click(el, 'Create channel and continue');
    expect(el.textContent).toContain('Could not invite switch-buddy to the channel.');
    await shot(el, 'i-invite-failure');

    await click(el, 'Try again');

    expect(el.textContent).toContain('#buddy-ada ready');
    expect(findButton(el, 'Open Slack')).toBeDefined();
    await shot(el, 'i-retry-done');
  });

  it('(k) Console only: continuing here, with the chat apps one click away', async () => {
    timeline.messages = [
      { sender: { kind: 'human' }, body: 'I’ll stay in Switch Console for now.' },
    ];
    const el = await render();

    expect(el.textContent).toContain('Continuing here in Switch Console.');
    expect(findButton(el, 'Connect a chat app')).toBeDefined();
    expect(el.textContent).not.toContain('Where does your team chat?');
    await shot(el, 'k-console-only');
  });

  it('(l) done without a channel link: says to find it in Slack', async () => {
    listBridges.mockResolvedValue([acme]);
    listMyIdentities.mockResolvedValue([linked('b-1')]);
    getRoomDetail.mockResolvedValue({ linkedChannelName: null, externalChannelUrl: null });
    made.add('b-1');
    const el = await render();

    expect(el.textContent).toContain('Private Slack channel ready');
    expect(el.textContent).toContain('Couldn’t get a link to the Slack channel. Find it in Slack.');
    expect(findButton(el, 'Open Slack')).toBeUndefined();
    await shot(el, 'l-done-without-link');
  });

  it('(m) Teams linked: guides adding the app and inviting the buddy', async () => {
    listBridges.mockResolvedValue([teams]);
    listMyIdentities.mockResolvedValue([linked('b-3')]);
    const el = await render();

    expect(el.textContent).toContain('Continue in Microsoft Teams');
    expect(el.textContent).toContain('!invite-agent @switch-buddy');
    await shot(el, 'm-teams-guide');
  });

  it('(n) Telegram linked: guides inviting the buddy in the group', async () => {
    listBridges.mockResolvedValue([telegram]);
    listMyIdentities.mockResolvedValue([linked('b-4')]);
    const el = await render();

    expect(el.textContent).toContain('Continue in Telegram');
    expect(el.textContent).toContain('/invite_agent @switch-buddy');
    await shot(el, 'n-telegram-guide');
  });
});
