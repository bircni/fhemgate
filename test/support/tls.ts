// a certificate nobody vouches for, as a fhem with https has it unless its owner took care of
// one: made anew for every run, so that no key lies in the repository
import { generateKeyPairSync, sign } from 'node:crypto';

/** one DER element: tag, length, content */
function der(tag: number, ...content: Buffer[]): Buffer {
  const body = Buffer.concat(content);
  const length = body.length < 128 ? [body.length] : body.length < 256 ? [0x81, body.length] : [0x82, body.length >> 8, body.length & 0xff];
  return Buffer.concat([Buffer.from([tag, ...length]), body]);
}

const sequence = (...content: Buffer[]) => der(0x30, ...content);
const oid = (...bytes: number[]) => der(0x06, Buffer.from(bytes));
const time = (date: Date) =>
  der(
    0x17,
    Buffer.from(
      date
        .toISOString()
        .replace(/[-:T]|\.\d+/g, '')
        .slice(2),
    ),
  );

export interface SelfSigned {
  /** the private key, as PEM */
  key: string;
  /** the certificate for 127.0.0.1 and localhost, signed with its own key, as PEM */
  cert: string;
}

/** a key and a certificate for a server on this machine that is valid for a day around now */
export function selfSignedCertificate(): SelfSigned {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const day = 24 * 60 * 60 * 1000;

  const ecdsaWithSha256 = sequence(oid(0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x02));
  const name = sequence(der(0x31, sequence(oid(0x55, 0x04, 0x03), der(0x0c, Buffer.from('localhost')))));
  const alternativeNames = sequence(der(0x87, Buffer.from([127, 0, 0, 1])), der(0x82, Buffer.from('localhost')));

  const toBeSigned = sequence(
    // version 3, which has extensions
    der(0xa0, der(0x02, Buffer.from([2]))),
    // serial number
    der(0x02, Buffer.from([1])),
    ecdsaWithSha256,
    name,
    sequence(time(new Date(Date.now() - day)), time(new Date(Date.now() + day))),
    name,
    publicKey.export({ type: 'spki', format: 'der' }),
    der(0xa3, sequence(sequence(oid(0x55, 0x1d, 0x11), der(0x04, alternativeNames)))),
  );
  const signature = der(0x03, Buffer.from([0]), sign('sha256', toBeSigned, privateKey));
  const certificate = sequence(toBeSigned, ecdsaWithSha256, signature);

  const lines = certificate.toString('base64').match(/.{1,64}/g) ?? [];
  return {
    key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    cert: `-----BEGIN CERTIFICATE-----\n${lines.join('\n')}\n-----END CERTIFICATE-----\n`,
  };
}
