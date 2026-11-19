import * as hap from '@homebridge/hap-nodejs';
import { expect, it } from 'vitest';
import { PluginState } from '../state/pluginState.ts';
import { handleDebugRequest } from './server.ts';

function page(url: string, state = new PluginState(hap)): string {
  let text = '';
  const response = {
    write: (chunk: string) => {
      text += chunk;
    },
    end: (chunk: string) => {
      text += chunk;
    },
  };
  handleDebugRequest({ url }, response, state, { 'http://fhem:8083/fhem': { connected: true, connects: 1, disconnects: 0, received: 5, received_total: 9 } });
  return text;
}

it('shows the state of the connections and the cached readings that are subscribed to', () => {
  const state = new PluginState(hap);
  state.subscriptions.subscribe({ device: 'lamp', mappings: {} }, 'lamp-state');
  state.cache.set('lamp-state', 'on');
  state.cache.set('other-state', 'off');

  expect(page('/cached', state)).toBe(
    '<a href="/">home</a><br><br>http://fhem:8083/fhem<br>&nbsp;&nbsp;connected: true; connects: 1<br>'
    + '&nbsp;&nbsp;received: 5; received total: 9<br><br>lamp-state: on<br><br>',
  );
});

it('answers every other address with the links to its pages', () => {
  expect(page('/anything')).toContain('<a href="/cached">cached</a>');
});
