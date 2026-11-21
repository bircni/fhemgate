// the accessories homebridge keeps for the platform from one start to the next
import type { Characteristic, Service } from '@homebridge/hap-nodejs';
import type { HAP, PlatformAccessory } from 'homebridge';

/** what the platform keeps at an accessory, which homebridge stores with it */
export interface AccessoryContext {
  /** the name of the device in fhem */
  device?: string;
  /** the FUUID of the device */
  fuuid?: string;
  /** the fhem of the entry the device was published from, its place in the configuration */
  server?: number;
  /** the platform name the uuid was made with */
  uuidPrefix?: string;
}

/** the service fakegato-history publishes the Eve history with */
const EVE_HISTORY = 'E863F007-079E-48FF-8F27-9C2605A29F52';

const sameService = (a: Service, b: Service): boolean => a.getServiceId() === b.getServiceId();

/**
 * Puts the services that were built for a device on its accessory, in place of what the
 * accessory had. A service or characteristic the accessory had takes over its id, which HomeKit
 * knows it by, so that HomeKit is not told of a new one and its events reach HomeKit at once. A
 * service the device no longer has is removed.
 */
export function applyServices(accessory: PlatformAccessory, services: Service[]): void {
  const before = [...accessory.services];

  for (const service of services) {
    const old = before.find((each) => sameService(each, service));
    if (old === service) {
      continue;
    }

    if (old !== undefined) {
      service.iid = old.iid;
      for (const characteristic of service.characteristics) {
        characteristic.iid = old.characteristics.find((each: Characteristic) => each.UUID === characteristic.UUID)?.iid ?? null;
      }
      accessory.removeService(old);
    }
    accessory.addService(service);
  }

  for (const old of before) {
    if (!services.some((service) => sameService(service, old))) {
      accessory.removeService(old);
    }
  }
}

/**
 * Makes HomeKit be told that the device does not respond, for every characteristic of an
 * accessory homebridge restored from its cache, or one whose device fhem did not make an
 * accessory of this time. That holds until the device is built again from what fhem lists.
 * homebridge would answer with the value it kept, which may be wrong by now, and what HomeKit
 * writes would get lost.
 */
export function answerNotResponding(accessory: PlatformAccessory, hap: HAP): void {
  const fail = (): never => {
    throw new hap.HapStatusError(hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
  };

  for (const service of accessory.services) {
    // the history of Eve is kept for the device and taken over as it is when the device is built again
    if (service.UUID === hap.Service.AccessoryInformation.UUID || service.UUID === EVE_HISTORY) {
      continue;
    }
    for (const characteristic of service.characteristics) {
      if (characteristic.UUID === hap.Characteristic.Name.UUID) {
        continue;
      }
      // what an accessory built before attached, which no longer hears from fhem
      characteristic.removeAllListeners('get');
      characteristic.removeAllListeners('set');
      characteristic.onGet(fail);
      characteristic.onSet(fail);
    }
  }
}
