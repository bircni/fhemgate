// the fhem the end-to-end tests run against: the stand-in of the other tests, or a real fhem
// when E2E_FHEM_URL names one. the real one is meant for a throwaway fhem in CI: the tests
// define devices in it and set the userattr attribute of global.
import { startFakeFhem, waitFor, type FakeFhem } from '../support/fhemweb.ts';
import type { FhemDevice } from '../support/types.ts';

/** a dummy device of fhem: what it can be set to, what it reads, and its attributes */
export interface DummyDevice {
  name: string;
  /** the set commands, as in the setList attribute */
  setList?: string;
  /** the set commands that set the reading of their name instead of the state */
  readingList?: string;
  attributes?: Record<string, string>;
  readings: Record<string, string>;
}

export interface FhemUnderTest {
  /** what the FHEM platform of homebridge is configured with */
  platformConfig: Record<string, unknown>;
  /** the stand-in, for what only it can do. undefined for a real fhem. */
  fake?: FakeFhem;
  /** resolves once fhem was told to `set <device> <command>`, which a dummy shows as the given reading */
  wasSet(device: string, command: string, reading: string, value: string): Promise<void>;
  /** a reading changes in fhem */
  change(device: string, reading: string, value: string): Promise<void>;
  close(): Promise<void>;
}

const userattr =
  'genericDeviceType:security,ignore,switch,outlet,light,blind,thermometer,thermostat,contact,garage,window,lock' +
  ' homebridgeMapping:textField-long siriName';

/** the device as jsonlist2 of a real fhem reports a dummy */
export function asJsonlist2(dummy: DummyDevice): FhemDevice {
  const attributes: Record<string, string> = { room: 'e2e', ...dummy.attributes };
  if (dummy.setList) {
    attributes.setList = dummy.setList;
  }
  if (dummy.readingList) {
    attributes.readingList = dummy.readingList;
  }

  return {
    Name: dummy.name,
    PossibleSets: dummy.setList ?? '',
    PossibleAttrs: 'alias comment eventMap genericDeviceType homebridgeMapping readingList room setList siriName userattr',
    Internals: { NAME: dummy.name, TYPE: 'dummy', FUUID: `e2e-${dummy.name}`, STATE: dummy.readings.state ?? '???' },
    Readings: Object.fromEntries(Object.entries(dummy.readings).map(([reading, value]) => [reading, { Value: value, Time: '2026-08-16 12:00:00' }])),
    Attributes: attributes,
  };
}

async function fakeFhem(devices: FhemDevice[]): Promise<FhemUnderTest> {
  const fake = await startFakeFhem({ devices, userattr });

  return {
    platformConfig: { server: '127.0.0.1', port: fake.port },
    fake,
    wasSet: (device, command) => waitFor(() => fake.commands.includes(`set ${device} ${command}`), `fhem to be told: set ${device} ${command}`, 15_000),
    change: (device, reading, value) => {
      fake.event(`${device}-${reading}`, value);
      return Promise.resolve();
    },
    close: () => fake.close(),
  };
}

async function realFhem(address: string, dummies: DummyDevice[]): Promise<FhemUnderTest> {
  const url = new URL(address);
  const base = url.origin + url.pathname.replace(/\/$/, '');

  const token = (await fetch(`${base}?XHR=1`)).headers.get('x-fhem-csrftoken') ?? '';
  const command = async (cmd: string): Promise<string> => {
    const response = await fetch(`${base}?cmd=${encodeURIComponent(cmd)}&fwcsrf=${token}&XHR=1`);
    if (!response.ok) {
      throw new Error(`fhem answered ${response.status} to: ${cmd}`);
    }
    return (await response.text()).trim();
  };

  // the plugin ends homebridge after it had to create the genericDeviceType attribute itself
  await command(`attr global userattr ${userattr}`);
  for (const dummy of dummies) {
    const { Attributes, Readings } = asJsonlist2(dummy);
    await command(`defmod ${dummy.name} dummy`);
    for (const [attribute, value] of Object.entries(Attributes)) {
      await command(`attr ${dummy.name} ${attribute} ${value ?? ''}`);
    }
    for (const [reading, entry] of Object.entries(Readings)) {
      await command(`setreading ${dummy.name} ${reading} ${entry?.Value ?? ''}`);
    }
  }

  return {
    platformConfig: { server: url.hostname, port: Number(url.port || 80), webname: url.pathname.replace(/^\/|\/$/g, ''), filter: 'room=e2e' },
    wasSet: async (device, _command, reading, value) => {
      const deadline = Date.now() + 15_000;
      while ((await command(`{ReadingsVal("${device}","${reading}","")}`)) !== value) {
        if (Date.now() > deadline) {
          throw new Error(`${reading} of ${device} in fhem did not become ${value}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    },
    change: async (device, reading, value) => {
      await command(`setreading ${device} ${reading} ${value}`);
    },
    close: async () => {
      for (const dummy of dummies) {
        await command(`delete ${dummy.name}`);
      }
    },
  };
}

/** the address of a real fhem to test against, if the environment names one */
export const realFhemUrl = process.env.E2E_FHEM_URL;

/** a fhem with the dummy devices: the real one if the environment names one, the stand-in otherwise */
export function startFhemWith(dummies: DummyDevice[]): Promise<FhemUnderTest> {
  return realFhemUrl ? realFhem(realFhemUrl, dummies) : fakeFhem(dummies.map(asJsonlist2));
}

/** the stand-in with devices exactly as given, for devices a real fhem can not have without their hardware */
export function startFakeFhemWith(devices: FhemDevice[]): Promise<FhemUnderTest> {
  return fakeFhem(devices);
}
