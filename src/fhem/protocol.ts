// what is said between the plugin and FHEMWEB, the web server of fhem: the urls the plugin
// asks for and the lines of the event stream. nothing in here talks to the network.

/** the long poll: every event of fhem as one JSON line, from the given time on */
export function longpollUrl(baseUrl: string, lastEventTime: number | undefined, now: number): string {
  const filter = '.*';
  const since = lastEventTime ? lastEventTime / 1000 : 'null';
  const query = '?XHR=1&inform=type=status;addglobal=1;filter=' + filter + ';since=' + since + ';fmt=JSON&timestamp=' + now;

  return encodeURI(baseUrl + query);
}

/**
 * The url that runs a fhem command.
 *
 * The command is encoded with encodeURI, which leaves `;`, `&` and `#` as they are. A command
 * that contains them is cut short or carries more parameters. See docs/KNOWN_BUGS.md, 23.
 */
export function commandUrl(baseUrl: string, cmd: string, csrfToken: string | undefined): string {
  let query = cmd;
  if (csrfToken) {
    query += '&fwcsrf=' + csrfToken;
  }
  query += '&XHR=1';
  return encodeURI(baseUrl + '?cmd=' + query);
}

/** the url that lists the devices of a devspec with everything fhem knows about them. all devices without a filter. */
export function devicesUrl(baseUrl: string, filter: string | undefined, csrfToken: string | undefined): string {
  let cmd = 'jsonlist2';
  if (filter) {
    cmd += '%20' + encodeURIComponent(filter);
  }
  if (csrfToken) {
    cmd += '&fwcsrf=' + csrfToken;
  }
  return baseUrl + '?cmd=' + cmd + '&XHR=1';
}

/** a reading that changed */
export interface FhemEvent {
  /** `<device>-<reading>` as fhem sent it */
  informId: string;
  /**
   * The part of the id before the first dash, and the rest. For a device with a dash in its
   * name the device is cut short. Only the colour handling of the long poll uses these.
   */
  device: string;
  reading: string;
  value: string;
}

/**
 * Reads one line of the event stream: a JSON list of id, value and html, or the three separated
 * by `<<`. Answers undefined for lines that are no change of a reading: timestamps, events for
 * the web frontend, and the echo of a set command.
 *
 * Fails for a JSON line whose id or value is not text.
 */
export function parseEventLine(line: string): FhemEvent | undefined {
  let d: string[];
  if (line.startsWith('[')) {
    try {
      d = JSON.parse(line) as string[];
    } catch (err) {
      console.log('  longpoll JSON.parse: ' + String(err));
      return undefined;
    }
  } else {
    d = line.split('<<', 3);
  }

  if (d.length !== 3) {
    return undefined;
  }
  const [informId, value] = d as [string, string, string];
  if (informId.match(/-ts$/)) {
    return undefined;
  }
  if (informId.match(/^#FHEMWEB:/)) {
    return undefined;
  }

  const match = informId.match(/([^-]*)-(.*)/);
  if (!match) {
    return undefined;
  }

  if (value.match(/^set-/)) {
    return undefined;
  }

  return { informId: informId, device: match[1] as string, reading: match[2] as string, value: value };
}

/** milliseconds to wait before the long poll is opened again after it ended for the nth time in a row */
export function reconnectDelayAfterEnd(disconnects: number): number {
  const timeout = 500 * disconnects - 300;
  return timeout > 30000 ? 30000 : timeout;
}

/** milliseconds to wait before the long poll is tried again after it failed for the nth time in a row */
export function retryDelayAfterError(disconnects: number): number {
  const timeout = 3000 * disconnects;
  return timeout > 30000 ? 30000 : timeout;
}
