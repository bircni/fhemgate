# Known bugs

Behaviour that the tests record although it is wrong. The restructuring moves the code without
changing what it does, so these travel with it. Each is to be fixed on its own, in a change that
also changes the test named here.

Line numbers refer to `index.cjs` as of the tag `baseline-m2`, the last state of the code as one
file. In the modules under `src/` each of these has a comment that names its number here:
`grep -rn "KNOWN_BUGS.md, 14" src` finds number 14.

| # | What happens | Where | Pinned by |
|---|---|---|---|
| 1 | The name of a HomeKit value is looked up by walking over the characteristic class with `for…in`, which also finds properties every class inherits. A mapping to the number 0 is logged as "means captureRejections", and numbers in a `valid` list are replaced by names. | 2602, 2636 | `test/devices.test.ts`: `mapping/values-as-numbers`, `mapping/valid-values`, `mapping/valid-numbers` > is detected |
| 2 | A `valid` entry that is neither a name nor a number becomes `NaN`, and the list is sorted as text. | 2648, 2652 | `test/devices.test.ts`: `mapping/valid-numbers` > is detected |
| 3 | A mapping that has only a default gets no reading. It is logged as `[undefined]`, and reading it asks fhem for a reading called `undefined`. | 2547, 3147 | `test/accessory.test.ts`: asks fhem for a reading named undefined when a mapping has only a default; `test/devices.test.ts`: `mapping/default-only` |
| 4 | A thermostat without a mapping for the heating state always reports HEAT, also when the valve is closed. | 2402 | `test/devices.test.ts`: `thermostat/cul_hm-rt-valve-closed` > is detected |
| 5 | A reading value that is not in the `values` list of a mapping is logged as an error every time it arrives. | 414 | `test/accessory.test.ts`: readings without a value in the values list |
| 6 | Converting a colour temperature below 5600 K calls a function that does not exist and throws. | 977 | `test/color.test.ts`: fails for every colour temperature below 5600 kelvin |
| 7 | The green part of a converted colour temperature is always 255, because of a semicolon after the `if`. | 969 | `test/color.test.ts`: always answers full green |
| 8 | When the colour temperature conversion fails during the long poll, the events that arrived in the same piece of data are held back until more data arrives. | 749 | `test/transport.test.ts`: reports the failing colour temperature conversion and holds back the rest of what arrived with it |
| 9 | `rgb2hex` drops a digit for a negative component. | 889 | `test/color.test.ts`: does not limit components to a byte and drops a digit for a negative one |
| 10 | The siri device is looked up after every reconnect, because of a semicolon after the `if` that should prevent it. | 1142 | `test/transport.test.ts`: looks at the attributes again after every reconnect |
| 11 | When a `homekit2reading` function can not be used, `reading2homekit` is removed instead and the unusable `homekit2reading` stays. | 2726 | `test/devices.test.ts`: `mapping/json-broken-functions`, `mapping/json-broken-write-function` > is detected |
| 12 | `invert` given without a value is taken for the name of a reading. | 2920 | `test/parser.test.ts`: takes a lone invert for the name of a reading |
| 13 | Identifying a HUEDevice sends `set <device>alert select`, without a blank after the device. | 2986 | `test/accessory.test.ts`: identifies a hue device with a command that lacks a space |
| 14 | Switching on is meant to be skipped while a delayed command is waiting. The check reads the length of an object, so it never skips. | 3000 | `test/accessory.test.ts`: still sends On while a delayed command is waiting |
| 15 | A command or a query given by name instead of by mapping fails with a TypeError, except for `identify`, `xhue` and `xsat`. | 3006, 3163 | `test/accessory.test.ts`: knows two commands that are given by name instead of by mapping; asks for a reading given by its name, but fails on the answer |
| 16 | A `scope` that is a list fails with a TypeError, as arrays have no `grep`. | 3194 | `test/accessory.test.ts`: fails when the scope of the platform is a list |
| 17 | Unsubscribing all mappings of an accessory removes nothing for characteristics that have a characteristic object or several mappings. | 2772 | `test/accessory.test.ts`: fails to unsubscribe everything at once…; unsubscribes everything at once only for… |
| 18 | The Eve characteristics of the history read from whichever mapping the loop over the mappings ended with, not from the contact or motion mapping. | 3660–3744 | `test/history.test.ts`: answers the seconds from the start of the history to the last change, taken from whichever mapping came last |
| 19 | With an empty history the last activation is answered as `NaN`. | 3714 | `test/history.test.ts`: starts the history with the current state when it is empty, and then has no last activation |
| 20 | The history entry for air quality stores the quality level (1 to 5) as ppm. | 194 | `test/history.test.ts`: records the readings of sensors |
| 21 | The plugin ends the homebridge process: after it created the `genericDeviceType` attribute, and when `ssl` is not a boolean. | 847, 1136 | `test/transport.test.ts`: creates the homebridgeMapping and genericDeviceType attributes when they are missing, and ends homebridge; ends homebridge when ssl is not true or false |
| 22 | When fhem refuses the device list, homebridge is never given the accessories and its start hangs. A read that fhem does not answer is never answered either. | 1230, 3149 | `test/transport.test.ts`: never answers when fhem refuses the request; `test/accessory.test.ts`: never answers when fhem does not |
| 23 | Commands are put into the url with `encodeURI`, which leaves `;`, `&` and `#` alone. A value containing them cuts the command short or adds parameters. | 1073 | `test/transport.test.ts`: leaves characters in place that separate commands and parameters |
| 24 | The csrf token is written to the log with every command. | 1074, 1195 | `test/transport.test.ts`: leaves the attributes of fhem alone when they are known |
| 25 | Without the password FHEMWEB asks for, the long poll is reopened every 200 ms without end. | 772 | `test/transport.test.ts`: reports the commands FHEMWEB refuses for lack of a password |
| 26 | `AccessoryCategory` is looked up at a place that no longer exists in HAP-NodeJS 2, so every category is unknown. | 2871 | `test/parser.test.ts`: does not find a category, as the accessory class of homekit has none any more |
| 27 | The `reachable` reading has no effect with HAP-NodeJS 2, which has no Reachable characteristic. | 3327 | `test/accessory.test.ts`: answers normally for a device that is not reachable… |
| 28 | Mappings for `Manufacturer`, `Model` and `SerialNumber` hand the mapping object to HomeKit instead of a text, which HomeKit replaces with a placeholder. | 3284 | `test/devices.test.ts`: `mapping/information-and-category` > gets its services |
| 29 | A `homebridgeMapping` in JSON is only recognised when it is on a single line. | 2798 | `test/parser.test.ts`: is only recognised on a single line |
| 30 | The debug page shows cached values and device names to anyone who can reach the port, and writes them into the page unescaped. | 3760 | `test/misc.test.ts`: lists the connections and what is cached for every subscribed reading |
| 31 | A `homebridgeMapping` in JSON can carry JavaScript that the plugin runs. Whoever can set attributes in fhem can run code in homebridge. | 2691, 2712 | `test/devices.test.ts`: `mapping/json` > converts readings |
| 32 | A device whose mappings give two services of the same type and subtype makes homebridge fail while it loads the accessories. None of the devices of the platform is published then, also not the ones that are fine. Found by the end-to-end test, after the single file was gone, so there is no line for it. | `createServices` in `src/accessory/services.ts` | `test/e2e/fixtures.e2e.ts`: a device whose mappings give two services of the same type and subtype |

## Not recorded by a test

These are known from reading the code, and no test runs them:

- TLS certificates are not checked when `auth` is configured (`requestOptions` in
  `src/fhem/client.ts`). The tests do not run a TLS server.
- The debug server listens on all interfaces on port 8282 or 8283 as soon as homebridge has
  loaded the plugin (`startDebugServer` in `src/debug/server.ts`). The tests switch it off.

Code that could not be reached was left behind when the code moved into `src/`: the handling of
`global` events in the long poll, a second conversion of the heating state, the service type
logging after the detection, which called a function that did not exist, and merging a JSON
mapping into the detected ones. The conversion of `state` for mappings with an `On` parameter was
kept, as a `homebridgeMapping` can reach it.
