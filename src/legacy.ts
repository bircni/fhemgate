// FHEM Platform Plugin for HomeBridge
// current version on https://github.com/justme-1968/homebridge
//
// Remember to add platform to config.json. Example:
// "platforms": [
//     {
//         "platform": "FHEM",
//         "name": "FHEM",
//         "ssl": true,
//         "auth": {"user": "fhem", "pass": "fhempassword"},
//         "server": "127.0.0.1",
//         "port": 8083,
//         "webname": fhem,
//         "jsFunctions": "myFunctions",
//         "filter": "room=xyz"
//     }
// ],
// @ts-nocheck -- the code taken over from homebridge-fhem. it shrinks as its parts move into typed modules.
import { createRequire } from 'node:module';
import util from 'node:util';
import events from 'node:events';

import { ct2rgb as FHEM_ct2rgb, hsv2rgb as FHEM_hsv2rgb, rgb2hex as FHEM_rgb2hex, rgb2hsv as FHEM_rgb2hsv, xyY2rgb as FHEM_xyY2rgb } from './util/color.ts';
import { sanitizeHapName } from './util/names.ts';
import { parseHomebridgeMapping } from './mapping/parser.ts';
import { reading2homekit as FHEM_reading2homekit } from './mapping/toHomekit.ts';
import { commandFor } from './mapping/toFhem.ts';
import { prepareMappings } from './mapping/compile.ts';
import { PluginState } from './state/pluginState.ts';
import { deviceIdentity } from './devices/identity.ts';
import { detectMappings, reviseMappings } from './devices/detect.ts';
import { hmccuChannel, hmccuDatapoint, hmccuMappings, hmccuReading, hmccuReadings, hmccuScalesLevel } from './devices/rules/hmccu.ts';
import { CustomUUIDs } from './accessory/customCharacteristics.ts';
import { FhemAccessory } from './accessory/accessory.ts';
import { handleDebugRequest, startDebugServer } from './debug/server.ts';

const require = createRequire(import.meta.url);

var version = require('../package.json').version;


var User;
var Accessory, Service, Characteristic, Units, Formats, Perms, UUIDGen, FakeGatoHistoryService;
export default function(homebridge){
  console.log('homebridge API version: ' + homebridge.version);
  console.info( 'this is homebridge-fhem '+ version );

//console.log( homebridge );
//process.exit(0);
  User = homebridge.user;

  state = new PluginState(homebridge.hap);

  //Accessory = homebridge.platformAccessory;
  Accessory = homebridge.hap.Accessory;
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  UUIDGen = homebridge.hap.uuid;


  try {
    state.historyServiceClass = require('fakegato-history')(homebridge);
  } catch(e) {
    if (e.code !== 'MODULE_NOT_FOUND') {
      throw e;
    }

    console.log( 'error: fakegato-history not installed' );
  }

  homebridge.registerPlatform('homebridge-fhem', 'FHEM', FHEMPlatform);
}


// the readings and subscriptions of the running plugin. set when homebridge loads the plugin.
var state;
function FHEM_subscribe(accessory, informId, characteristic, mapping) { state.subscriptions.subscribe(accessory, informId, characteristic, mapping) }
function FHEM_unsubscribe(accessory, informId, characteristic) { state.subscriptions.unsubscribe(accessory, informId, characteristic) }
function FHEM_isPublished(device) { return state.subscriptions.publishedAccessory(device) }
function FHEM_update(informId, orig, no_update) { state.update(informId, orig, no_update) }

var FHEM_longpoll = {};
var FHEM_csrfToken = {};
//FIXME: add filter
function FHEM_startLongpoll(connection) {
  if( !FHEM_longpoll[connection.base_url] ) {
    FHEM_longpoll[connection.base_url] = {};
    FHEM_longpoll[connection.base_url].connects = 0;
    FHEM_longpoll[connection.base_url].disconnects = 0;
    FHEM_longpoll[connection.base_url].received_total = 0;
  }

  if( FHEM_longpoll[connection.base_url].connected )
    return;
  FHEM_longpoll[connection.base_url].connects++;
  FHEM_longpoll[connection.base_url].received = 0;
  FHEM_longpoll[connection.base_url].connected = true;


  var filter = '.*';
  var since = 'null';
  if( FHEM_longpoll[connection.base_url].last_event_time )
    since = FHEM_longpoll[connection.base_url].last_event_time/1000;
  var query = '?XHR=1'
              + '&inform=type=status;addglobal=1;filter='+filter+';since='+since+';fmt=JSON'
              + '&timestamp='+Date.now();

  var url = encodeURI( connection.base_url + query );
  console.log( 'starting longpoll: ' + url );

  var FHEM_longpollOffset = 0;
  var input = '';
  connection.request.get( { url: url } ).on( 'data', function(data) {
//console.log( 'data: ' + data );
               if( !data )
                 return;

               var length = data.length;
               FHEM_longpoll[connection.base_url].received += length;
               FHEM_longpoll[connection.base_url].received_total += length;

               input += data;

               try {
                 var lastEventTime = Date.now();
                 for(;;) {
                   var nOff = input.indexOf('\n', FHEM_longpollOffset);
                   if(nOff < 0)
                     break;
                   var l = input.substr(FHEM_longpollOffset, nOff-FHEM_longpollOffset);
                   FHEM_longpollOffset = nOff+1;
//console.log( 'Rcvd: ' + (l.length>132 ? l.substring(0,132)+'...('+l.length+')':l) );

                   if(!l.length)
                     continue;

                   var d;
                   if( l.substr(0,1) == '[' ) {
                     try {
                       d = JSON.parse(l);
                     } catch(err) {
                       console.log( '  longpoll JSON.parse: ' + err );
                       continue;
                     }
                   } else
                     d = l.split('<<', 3);
//console.log(d);

                   if(d.length != 3)
                     continue;
                   if(d[0].match(/-ts$/))
                     continue;
                   if(d[0].match(/^#FHEMWEB:/))
                     continue;

                   var match = d[0].match(/([^-]*)-(.*)/);
                   if( !match )
                     continue;
                   var device = match[1];
                   var reading = match[2];
//console.log( 'device: ' + device );
//console.log( 'reading: ' + reading );
                   if( reading === undefined )
                     continue;

                   var value = d[1];
//console.log( 'value: ' + value );
                   if( value.match( /^set-/ ) )
                     continue;


                   if( 0 && device == 'global' ) {
                     if( reading == 'DEFINED' ) {
console.log( 'DEFINED: ' + value );
console.log( connection.base_url );
                       FHEM_platforms.forEach( function(platform) {
platform.log( platform.connection.base_url );
                         if( connection.base_url == platform.connection.base_url ) {
platform.log( platform.filter );
                           platform.accessories( function(accessories) {
                                                   accessories.forEach( function(accessory) {
                                                     if( platform.addBridgedAccessory )
                                                       platform.addBridgedAccessory(accessory);

                                                   } );
                                                } );
                         }
                       } );

                     } else if( reading == 'DELETED' ) {
console.log( 'DELETED: ' + value );
                       var accessory = FHEM_isPublished(value);

                       //if( accessory && typeof accessory.updateReachability === 'function' )
                         //accessory.updateReachability( false );

                     } else if( reading == 'ATTR' ) {
console.log( 'ATTR: ' + value );
                       var values = value.split( ' ' );
                       var accessory = FHEM_isPublished(values[0]);

                       if( accessory && values[1] == 'disable' )
                         FHEM_update(values[0] + '-reachable', !values[2] );
                       else if( values[1] == 'genericDeviceType' || values[1] =='homebridgeMapping' ) {
console.log( connection.base_url );
                         FHEM_platforms.forEach( function(platform) {
platform.log( platform.connection.base_url );
                           if( connection.base_url == platform.connection.base_url ) {
platform.log( platform.filter );
                             platform.accessories( function(accessories) {
                                                     accessories.forEach( function(accessory) {
                                                       if( platform.addBridgedAccessory )
                                                         platform.addBridgedAccessory(accessory);

                                                     } );
                                                  } );
                           }
                         } );
                       }

                     } else if( reading == 'DELETEATTR' ) {
console.log( 'DELETEATTR: ' + value );
                       var values = value.split( ' ' );
                       var accessory = FHEM_isPublished(values[0]);

                       if( accessory && values[1] == 'disable' )
                         FHEM_update(values[0] + '-reachable', !values[2] );

                     }

                     continue;
                   }

                   var subscriptions = state.subscriptions.byInformId[d[0]];
                   if( subscriptions ) {
                     FHEM_update( d[0], value );
                     FHEM_longpoll[connection.base_url].last_event_time = lastEventTime;

                     subscriptions.forEach( function(subscription) {
                       var accessory = subscription.accessory;

                       if(accessory.mappings.colormode) {
                         if( reading == 'xy') {
                           var xy = value.split(',');
                           var rgb = FHEM_xyY2rgb(xy[0], xy[1] , 1);
                           var hsv = FHEM_rgb2hsv(rgb);

                           FHEM_update( device+'-h', hsv[0] );
                           FHEM_update( device+'-s', hsv[1] );
                           FHEM_update( device+'-v', hsv[2] );

                           FHEM_update( device+'-'+reading, value, false );

                           return;

                         } else if( reading == 'ct') {
                           var rgb = FHEM_ct2rgb(value);
                           var hsv = FHEM_rgb2hsv(rgb);

                           FHEM_update( device+'-h', hsv[0] );
                           FHEM_update( device+'-s', hsv[1] );
                           FHEM_update( device+'-v', hsv[2] );

                           FHEM_update( device+'-'+reading, value, false );

                           return;
                         }

                       }
                     } );

                   }
                 }

             } catch(err) {
               connection.log.error( '  error in longpoll connection: ' + err );

             }

             input = input.substr(FHEM_longpollOffset);
             FHEM_longpollOffset = 0;

	     if( FHEM_csrfToken[connection.base_url] )
               FHEM_longpoll[connection.base_url].disconnects = 0;

           } ).on( 'response', function(response) {
             if( response.headers && response.headers['x-fhem-csrftoken'] )
               FHEM_csrfToken[connection.base_url] = response.headers['x-fhem-csrftoken'];
             else
               FHEM_csrfToken[connection.base_url] = '';

             connection.fhem.checkAndSetGenericDeviceType();

           } ).on( 'end', function() {
             FHEM_longpoll[connection.base_url].connected = false;

             FHEM_longpoll[connection.base_url].disconnects++;
             var timeout = 500 * FHEM_longpoll[connection.base_url].disconnects - 300;
             if( timeout > 30000 ) timeout = 30000;

             connection.log.error( 'longpoll ended, reconnect in: ' + timeout + 'msec' );
             setTimeout( function(){FHEM_startLongpoll(connection)}, timeout  );

           } ).on( 'error', function(err) {
             FHEM_longpoll[connection.base_url].connected = false;

             FHEM_longpoll[connection.base_url].disconnects++;
             var timeout = 3000 * FHEM_longpoll[connection.base_url].disconnects;
             if( timeout > 30000 ) timeout = 30000;

             if( !connection.neverTimeout && timeout > 10000 && !FHEM_csrfToken[connection.base_url] ) {
               connection.log.error( 'longpoll error: ' + err + ', retrys exhausted' );
	       connection.dead = true;
	       return;
             }

             connection.log.error( 'longpoll error: ' + err + ', retry in: ' + timeout + 'msec' );
             setTimeout( function(){FHEM_startLongpoll(connection)}, timeout );

           } );
}

var FHEM_platforms = [];

function
FHEMPlatform(log, config, api) {
  events.EventEmitter.call(this);

  Units = api.hap.Units;
  Formats = api.hap.Formats;
  Perms = api.hap.Perms;

  this.log         = log;
  this.config      = config;

  if( api ) {
    this.api         = api;

    //this.api.on('didFinishLaunching', this.didFinishLaunching.bind(this));

    this.api.on('shutdown', this.shutdown.bind(this));
  }

  //this.server      = config['server'] || '127.0.0.1';
  this.server      = config['server'];
  this.port        = config['port'] || 8083;
  this.filter      = config['filter'];
  this.jsFunctions = config['jsFunctions'];

  this.scope        = config['scope'];

  if( this.server === undefined ) {
    log.error( 'incomplete configuration ' );
    return;
  }

  if( this.jsFunctions !== undefined ) {
    try {
      var path = this.jsFunctions;
      if( path.substr(0,1) != '/' )
        path = User.storagePath()+'/'+this.jsFunctions;
      this.jsFunctions = require(path);
    } catch(err) {
      log.error( '  jsFunctions: ' + err );
      delete this.jsFunctions;
    }
  }

  var base_url = 'http://';
  if( config.ssl ) {
    if( typeof config.ssl !== 'boolean' ) {
      this.log.error( 'config: value for ssl has to be boolean.' );
      process.exit(0);
    }
    base_url = 'https://';
  }
  base_url += this.server + ':' + this.port;

  if( config.webname ) {
    base_url += '/'+config.webname;
  } else {
    base_url += '/fhem';
  }

  var request = require('postman-request');
  var auth = config['auth'];
  if( auth ) {
    if( auth.sendImmediately === undefined )
      auth.sendImmediately = false;

    request = request.defaults( { auth: auth, rejectUnauthorized: false } );
  }

  this.connection = { base_url: base_url, request: request, log: log, fhem: this, neverTimeout: config['neverTimeout'] };

  FHEM_platforms.push(this);

  FHEM_startLongpoll( this.connection );
}
util.inherits(FHEMPlatform, events.EventEmitter);

function
FHEM_sortByKey(array, key) {
  return array.sort( function(a, b) {
    var x = a[key]; var y = b[key];
    return ((x < y) ? -1 : ((x > y) ? 1 : 0));
    });
}

function
FHEM_execute(log,connection,cmd,callback) {
  if( FHEM_csrfToken[connection.base_url] )
    cmd += '&fwcsrf='+FHEM_csrfToken[connection.base_url];
  cmd += '&XHR=1';
  var url = encodeURI( connection.base_url + '?cmd=' + cmd );
  log.info( '  executing: ' + url );

  connection.request
              .get( { url: url, gzip: true },
               function(err, response, result) {
                      if( !err && response.statusCode == 200 ) {
                        result = result.replace(/[\r\n]/g, '');
                        if( callback )
                          callback( result );

                      } else {
                        log('There was a problem connecting to FHEM ('+ url +').');
                        if( response )
                          log( '  ' + response.statusCode + ': ' + response.statusMessage );

                      }

                    } )
              .on( 'error', function(err) { log('There was a problem connecting to FHEM ('+ url +'):'+ err); } );
}

FHEMPlatform.prototype = {
  didFinishLaunching: function() { this.log.error('didFinishLaunching')
  },

  shutdown: function() { //this.log.error('shutdown')
    for( var informId in state.subscriptions.byInformId ) {
      for( var subscription of state.subscriptions.byInformId[informId] ) {
        var accessory = subscription.accessory;
        if( accessory.shutdown ) continue;

        if( accessory.historyService )
          accessory.historyService.save();

        accessory.shutdown = true;
      }
    }
  },

  execute: function(cmd,callback) {FHEM_execute(this.log, this.connection, cmd, callback)},

  checkAndSetGenericDeviceType: function() {
    this.log('Checking devices and attributes...');

    var cmd = '{AttrVal("global","userattr","")}';
    this.execute( cmd,
                  function(result) {
                    //if( result === undefined )
                      //result = '';

                    if( !result.match(/(^| )homebridgeMapping\b/) ) {
                      var cmd = '{ addToAttrList( "homebridgeMapping:textField-long" ) }';
                      this.execute( cmd );
                      this.log.info( 'homebridgeMapping attribute created.' );
                    }

                    if( !result.match(/(^| )genericDeviceType\b/) ) {
                      var cmd = '{addToAttrList( "genericDeviceType:security,ignore,switch,outlet,light,blind,thermometer,thermostat,contact,garage,window,lock" ) }';
                      this.execute( cmd,
                                    function(result) {
                                        this.log.warn( 'genericDeviceType attribute was not known. please restart.' );
					if( FHEM_csrfToken[this.connection.base_url] )
                                          process.exit(0);
                                    }.bind(this) );
                    }

                  }.bind(this) );

    if( !this.siri_device );
      this.execute( 'jsonlist2 TYPE=siri',
                    function(result) {
                      try {
                        var d = JSON.parse( result );
                        if( d.totalResultsReturned === 1 ) {
                          this.siri_device = d.Results[0].Name;
                          this.log.info( 'siri device is ' + this.siri_device );
                          this.execute( '{$defs{'+ this.siri_device +'}->{"homebridge-fhem version"} = "'+ version +'"}' );
                        } else
                          this.log.warn( 'no siri device found. please define it.' );

                      } catch(err) {
                        this.log.error( 'failed to parse ' + result );
                      }
                    }.bind(this) );
  },

  accessories: function(callback) {
    var foundAccessories = [];

    //this.checkAndSetGenericDeviceType();
    if( !this.connection ) {
      callback(foundAccessories);
      return;
    }

    // mechanism to ensure callback is only executed once all requests complete
    var asyncCalls = 0;
    function callbackLater() { if (--asyncCalls == 0) callback(foundAccessories); }

    if( FHEM_csrfToken[this.connection.base_url] === undefined ) {
      if( this.connection.dead ) {
        callback(foundAccessories);
	return;
      }

      var timeout = 500;
      if( FHEM_longpoll[this.connection.base_url].disconnects )
        timeout = FHEM_longpoll[this.connection.base_url].disconnects * 1000;
      this.log.debug('FHEM csrfToken missing, retry in: ' + timeout + 'msec');
      setTimeout( function(){this.connection.fhem.accessories(callback)}.bind(this), timeout  );
      return;
    }

    this.log.info('Fetching FHEM devices...');

    var cmd = 'jsonlist2';
    if( this.filter )
      cmd += '%20' + encodeURIComponent(this.filter);
    if( FHEM_csrfToken[this.connection.base_url] )
      cmd += '&fwcsrf='+FHEM_csrfToken[this.connection.base_url];
    var url = this.connection.base_url + '?cmd=' + cmd + '&XHR=1';
    this.log.info( 'fetching: ' + url );

    asyncCalls++;

    this.connection.request.get( { url: url, json: true, gzip: true },
                 function(err, response, json) {
                   if( !err && response.statusCode == 200 && json ) {
//console.log("got json: " + util.inspect(json) );
                     this.log.info( 'got: ' + json['totalResultsReturned'] + ' results' );
                     if( json['totalResultsReturned'] ) {
                       var sArray=FHEM_sortByKey(json['Results'],'Name');
                       sArray.map( function(s) {

                         //FIXME: change to factory pattern
                         var accessory = new FHEMAccessory(this, s);
                         if( accessory && accessory.service_name ) {
                           accessory.fhem = this.connection.fhem;

                           if( !accessory.isInScope('siri') ) {
                             this.log.info( 'ignoring '+ accessory.name +' for siri' );
                             return;
                           }

                           foundAccessories.push(accessory);
                         } else {
                           this.log.info( 'no accessory created for ' + s.Internals.NAME + ' (' + s.Internals.TYPE + ')' );
                           return undefined;
                         }

                       }.bind(this) );
                     }

                     callback(foundAccessories);
                     //callbackLater();

                   } else {
                     this.log.error('There was a problem connecting to FHEM');
                     if( response )
                       this.log.error( '  ' + response.statusCode + ': ' + response.statusMessage );

                   }

                 }.bind(this) );
  }
}

class FHEMAccessory extends FhemAccessory {
  constructor(platform, s) {
    super(platform, s, state, FHEM_execute);
  }
}


//http server for debugging
function FHEMdebug_handleRequest(request, response){
  handleDebugRequest(request, response, state, FHEM_longpoll);
}

// the tests load this file many times in parallel and switch the server off
if( process.env.FHEM2HB_DEBUG_SERVER !== 'off' )
  startDebugServer( FHEMdebug_handleRequest );

// the plugin does not export its internals. the tests reach them through this.
export const __internals = {
  useHap: function(hap) {
    Accessory = hap.Accessory; Service = hap.Service; Characteristic = hap.Characteristic; UUIDGen = hap.uuid;
    Units = hap.Units; Formats = hap.Formats; Perms = hap.Perms;
    state = new PluginState(hap);
    return state;
  },
  useUser: function(user) { User = user },
  useFakeGato: function(service) { state.historyServiceClass = service },

  FHEMPlatform: FHEMPlatform,
  FHEMAccessory: FHEMAccessory,

  FHEM_longpoll: FHEM_longpoll,
  FHEM_csrfToken: FHEM_csrfToken,
  FHEM_platforms: FHEM_platforms,

  FHEM_subscribe: FHEM_subscribe,
  FHEM_unsubscribe: FHEM_unsubscribe,
  FHEM_isPublished: FHEM_isPublished,
  FHEM_update: FHEM_update,
  FHEM_reading2homekit: FHEM_reading2homekit,
  FHEM_startLongpoll: FHEM_startLongpoll,
  FHEM_execute: FHEM_execute,

  FHEM_sortByKey: FHEM_sortByKey,
  FHEM_rgb2hex: FHEM_rgb2hex,
  FHEM_hsv2rgb: FHEM_hsv2rgb,
  FHEM_ct2rgb: FHEM_ct2rgb,
  FHEM_xyY2rgb: FHEM_xyY2rgb,
  FHEM_rgb2hsv: FHEM_rgb2hsv,

  CustomUUIDs: CustomUUIDs,
  sanitizeHapName: sanitizeHapName,

  FHEM_hmccuReadings: hmccuReadings,
  FHEM_hmccuChannel: hmccuChannel,
  FHEM_hmccuReading: hmccuReading,
  FHEM_hmccuDatapoint: hmccuDatapoint,
  FHEM_hmccuScalesLevel: hmccuScalesLevel,
  FHEM_hmccuMappings: hmccuMappings,

  FHEMdebug_handleRequest: FHEMdebug_handleRequest,
};
