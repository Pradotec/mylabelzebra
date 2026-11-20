import { describe, it, expect, beforeEach } from 'vitest';
import { enqueue, useQueue, pauseJob, resumeJob, cancelJob, clearFinished, activeCount, _resetQueueForTests } from './printQueue';
import { parseHostStatus, isStatusReadable, statusProblems } from './zebra';

const items = () => useQueue.getState().items;
async function waitFor(fn: () => boolean) {
  for (let i = 0; i < 200 && !fn(); i++) await new Promise((r) => setTimeout(r, 0));
  expect(fn()).toBe(true);
}

beforeEach(() => _resetQueueForTests());

describe('file d’impression', () => {
  it('un travail à la fois, dans l’ordre d’arrivée', async () => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const a = enqueue({ name: 'A', kind: 'zebra' }, async () => {
      order.push('A+');
      await gate;
      order.push('A-');
      return 1;
    });
    const b = enqueue({ name: 'B', kind: 'zebra' }, async () => {
      order.push('B');
      return 2;
    });
    await waitFor(() => items()[0].status === 'running');
    expect(items()[1].status).toBe('pending');
    expect(activeCount(items())).toBe(2);
    release();
    expect(await a).toBe(1);
    expect(await b).toBe(2);
    expect(order).toEqual(['A+', 'A-', 'B']);
    expect(items().map((i) => i.status)).toEqual(['done', 'done']);
    clearFinished();
    expect(items()).toEqual([]);
  });

  it('erreur : statut « erreur » avec le message, la file continue', async () => {
    const a = enqueue({ name: 'A', kind: 'zebra' }, async () => {
      throw new Error('panne');
    });
    const b = enqueue({ name: 'B', kind: 'zebra' }, async () => 'ok');
    expect(await a).toBeNull();
    expect(await b).toBe('ok');
    expect(items()[0]).toMatchObject({ status: 'error', message: 'panne' });
  });

  it('pause d’un travail en attente : il ne démarre qu’à la reprise', async () => {
    let started = false;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    void enqueue({ name: 'A', kind: 'x' }, () => gate);
    const b = enqueue({ name: 'B', kind: 'x' }, async () => {
      started = true;
      return true;
    });
    pauseJob(items()[1].id);
    release();
    await waitFor(() => items()[1].status === 'paused');
    expect(started).toBe(false);
    resumeJob(items()[1].id);
    expect(await b).toBe(true);
  });

  it('point d’arrêt : annulation pendant une pause', async () => {
    const p = enqueue({ name: 'A', kind: 'x' }, async (ctl) => {
      pauseJob(ctl.id);
      await ctl.checkpoint();
      return 'fini';
    });
    await waitFor(() => items()[0].status === 'paused');
    cancelJob(items()[0].id);
    expect(await p).toBeNull();
    expect(items()[0].status).toBe('cancelled');
  });

  it('problème : décision de l’utilisateur transmise au travail', async () => {
    const p = enqueue({ name: 'A', kind: 'x' }, async (ctl) => ctl.problem('Plus de papier', false));
    await waitFor(() => items()[0].status === 'paused');
    expect(items()[0]).toMatchObject({ problem: true, message: 'Plus de papier' });
    resumeJob(items()[0].id);
    expect(await p).toBe('resume');
    expect(items()[0].status).toBe('done');
  });
});

describe('~HS : état lisible ou non', () => {
  const HS = '\x02030,1,0,1245,000,0,0,0,000,0,0,0\x03\r\n\x02000,0,1,0,0,2,6,0,00000000,1,000\x03\r\n\x021234,0\x03';
  it('réponse complète : problèmes signalés', () => {
    const s = parseHostStatus(HS);
    expect(isStatusReadable(s)).toBe(true);
    expect(statusProblems(s)).toEqual(['Plus de papier', 'Tête ouverte']);
  });
  it('réponse vide ou tronquée : illisible', () => {
    expect(isStatusReadable(parseHostStatus(''))).toBe(false);
    expect(isStatusReadable(parseHostStatus('\x02030,0,0\x03'))).toBe(false);
  });
});
