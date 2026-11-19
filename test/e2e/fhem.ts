// the fhem the end-to-end tests run against: the stand-in of the other tests, or a real fhem
// when E2E_FHEM_URL names one. the real one is meant for a throwaway fhem in CI: the tests
// define devices in it and set the userattr attribute of global.
import { startFakeFhem, waitFor, type FakeFhem, type FakeFhemOptions } from '../support/fhemweb.ts';
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

/** the stand-in, for the tests that need what a real fhem can not be made to do from here */
export interface StandIn extends FhemUnderTest {
  fake: FakeFhem;
  /** resolves once the stand-in received exactly this command */
  wasTold(command: string): Promise<void>;
}

// model and subType are attributes of other modules that the detection looks at. as user
// attributes a dummy can have them as well.
const userattr =
  'genericDeviceType:security,ignore,switch,outlet,light,blind,thermometer,thermostat,contact,garage,window,lock' +
  ' homebridgeMapping:textField-long siriName model subType';

/** the time as fhem writes it for a reading: local, without a zone */
function now(): string {
  const date = new Date();
  const two = (number: number) => String(number).padStart(2, '0');
  const day = `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
  return `${day} ${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}`;
}

/** the device as jsonlist2 of a real fhem reports a dummy */
export function asJsonlist2(dummy: DummyDevice, room = 'e2e'): FhemDevice {
  const attributes: Record<string, string> = { room, ...dummy.attributes };
  if (dummy.setList) {
    attributes.setList = dummy.setList;
  }
  if (dummy.readingList) {
    attributes.readingList = dummy.readingList;
  }

  return {
    Name: dummy.name,
    PossibleSets: dummy.setList ?? '',
    PossibleAttrs: 'alias comment eventMap genericDeviceType homebridgeMapping model readingList room setList siriName subType userattr',
    Internals: { NAME: dummy.name, TYPE: 'dummy', FUUID: `e2e-${dummy.name}`, STATE: dummy.readings.state ?? '???' },
    Readings: Object.fromEntries(Object.entries(dummy.readings).map(([reading, value]) => [reading, { Value: value, Time: now() }])),
    Attributes: attributes,
  };
}

/** the devices a devspec selects, for the few forms of a devspec the tests use. any other devspec selects all. */
function select(devices: FhemDevice[], devspec: string): FhemDevice[] {
  const match = /^(room|NAME|TYPE)=(.+)$/.exec(devspec);
  if (!match) {
    return devices;
  }
  const [, by, wanted] = match as unknown as [string, string, string];
  return devices.filter((device) => {
    if (by === 'room') {
      return (device.Attributes.room ?? '').split(',').includes(wanted);
    }
    return device.Internals[by] === wanted;
  });
}

/**
 * The stand-in with the devices. On top of what the stand-in of the other tests does, it
 * answers `jsonlist2` for the devspec it is asked with, answers `ReadingsVal` from the readings
 * of the devices, and takes a `set` for a dummy the way fhem does: the reading named in the
 * readingList, or else the state, gets the value, and the change is sent as an event.
 */
export async function startStandIn(devices: FhemDevice[], options: FakeFhemOptions = {}): Promise<StandIn> {
  const byName = new Map(devices.map((device) => [device.Internals.NAME, device]));

  const setReading = (name: string, reading: string, value: string): void => {
    const device = byName.get(name);
    if (device) {
      device.Readings[reading] = { Value: value, Time: now() };
    }
    fake.event(`${name}-${reading}`, value);
  };

  const answer = (cmd: string): { status?: number; body: string } | undefined => {
    const custom = options.answer?.(cmd);
    if (custom) {
      return custom;
    }

    if (cmd.startsWith('jsonlist2')) {
      const devspec = cmd.slice(10).trim();
      const results = select(devices, devspec).map((device) => ({ Name: device.Internals.NAME, ...device }));
      return { body: JSON.stringify({ Arg: devspec, Results: results, totalResultsReturned: results.length }) };
    }

    const asked = /^\{ReadingsVal\("(.*)","(.*)",""\)\}$/.exec(cmd);
    const askedDevice = byName.get(asked?.[1] ?? '');
    if (asked && askedDevice) {
      return { body: `${askedDevice.Readings[asked[2] ?? '']?.Value ?? ''}\n` };
    }

    // fhem runs the commands of a chain one after the other
    for (const part of cmd.split(';')) {
      const set = /^set (\S+) +(\S+) *(.*)$/.exec(part.trim());
      const device = byName.get(set?.[1] ?? '');
      if (set && device?.Internals.TYPE === 'dummy') {
        const [, name, command, value] = set as unknown as [string, string, string, string];
        const words = value.split(' ').filter(Boolean);
        if ((device.Attributes.readingList ?? '').split(' ').includes(command)) {
          setReading(name, command, words.join(' '));
        } else {
          setReading(name, 'state', [command, ...words].join(' '));
        }
      }
    }
    return undefined;
  };

  const fake = await startFakeFhem({ userattr, ...options, devices, answer });

  return {
    platformConfig: { server: '127.0.0.1', port: fake.port },
    fake,
    wasTold: (command) => waitFor(() => fake.commands.includes(command), `fhem to be told: ${command}`, 15_000),
    wasSet: (device, command, reading, value) =>
      waitFor(
        () => fake.commands.includes(`set ${device} ${command}`) && byName.get(device)?.Readings[reading]?.Value === value,
        `fhem to be told: set ${device} ${command}, and to show ${reading} of ${device} as ${value}`,
        15_000,
      ),
    change: (device, reading, value) => {
      setReading(device, reading, value);
      return Promise.resolve();
    },
    close: () => fake.close(),
  };
}

async function realFhem(address: string, dummies: DummyDevice[], room: string): Promise<FhemUnderTest> {
  const url = new URL(address);
  const base = url.origin + url.pathname.replace(/\/$/, '');

  const token = (await fetch(`${base}?XHR=1`)).headers.get('x-fhem-csrftoken') ?? '';
  const command = async (text: string): Promise<string> => {
    // fhem takes a single semicolon for the end of a command
    const cmd = text.replaceAll(';', ';;');
    const response = await fetch(`${base}?cmd=${encodeURIComponent(cmd)}&fwcsrf=${token}&XHR=1`);
    if (!response.ok) {
      throw new Error(`fhem answered ${response.status} to: ${cmd}`);
    }
    return (await response.text()).trim();
  };
  /** for commands that answer nothing unless they fail */
  const done = async (text: string): Promise<void> => {
    const answer = await command(text);
    if (answer) {
      throw new Error(`fhem answered to "${text}": ${answer}`);
    }
  };

  // the plugin ends homebridge after it had to create the genericDeviceType attribute itself
  await done(`attr global userattr ${userattr}`);
  for (const dummy of dummies) {
    const { Attributes, Readings } = asJsonlist2(dummy, room);
    // a device left over from an earlier run would keep its attributes and readings
    await command(`delete ${dummy.name}`);
    await done(`defmod ${dummy.name} dummy`);
    for (const [attribute, value] of Object.entries(Attributes)) {
      await done(`attr ${dummy.name} ${attribute} ${value ?? ''}`);
    }
    for (const [reading, entry] of Object.entries(Readings)) {
      await done(`setreading ${dummy.name} ${reading} ${entry?.Value ?? ''}`);
    }
  }

  return {
    platformConfig: { server: url.hostname, port: Number(url.port || 80), webname: url.pathname.replace(/^\/|\/$/g, ''), filter: `room=${room}` },
    wasSet: async (device, _command, reading, value) => {
      const deadline = Date.now() + 15_000;
      let shown = '';
      while ((shown = await command(`{ReadingsVal("${device}","${reading}","")}`)) !== value) {
        if (Date.now() > deadline) {
          throw new Error(`${reading} of ${device} in fhem did not become "${value}", it is "${shown}"`);
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    },
    change: (device, reading, value) => done(`setreading ${device} ${reading} ${value}`),
    close: async () => {
      for (const dummy of dummies) {
        await command(`delete ${dummy.name}`);
      }
    },
  };
}

/** the address of a real fhem to test against, if the environment names one */
export const realFhemUrl = process.env.E2E_FHEM_URL;

/**
 * A fhem with the dummy devices: the real one if the environment names one, the stand-in
 * otherwise. The devices are put into the room, and the platform is configured with a filter
 * for that room. Every test file uses a room of its own.
 */
export async function startFhemWith(dummies: DummyDevice[], room = 'e2e'): Promise<FhemUnderTest> {
  if (realFhemUrl) {
    return realFhem(realFhemUrl, dummies, room);
  }
  const standIn = await startStandIn(dummies.map((dummy) => asJsonlist2(dummy, room)));
  return { ...standIn, platformConfig: { ...standIn.platformConfig, filter: `room=${room}` } };
}
